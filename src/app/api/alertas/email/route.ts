// src/app/api/alertas/email/route.ts
// POST — envia notificações de alerta por email via Resend
//
// Esta rota gasta um recurso EXTERNO e caro por request: um e-mail de verdade,
// saindo do nosso domínio, pela nossa quota no Resend. Então ela tem três travas
// independentes, cada uma cobrindo o que a outra não cobre:
//
//   1. DESTINATÁRIO da sessão (não do body) — impede usar o domínio como relay.
//   2. RATE LIMIT por USUÁRIO (não por IP) — impede queimar quota/reputação.
//   3. VALIDAÇÃO do corpo antes de chamar o fornecedor — impede mandar lixo.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Resend } from 'resend'
import { authOptions } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { buildAlertaDigestHtml, type NotificacaoEmail } from '@/lib/alerta-email'

export const runtime = 'nodejs'

// Régua BAIXA e por CONTA. O middleware limita por IP (150/min para APIs de dados) e
// isso não protege nada aqui: 150 requests é 150 e-mails saindo do nosso domínio em
// um minuto — quota do Resend queimada e reputação do domínio afetada para TODOS os
// clientes, com uma conta só e sem nada de anormal no log de tráfego. Mandar o resumo
// à mão é ação de gente olhando a tela, não de laço: 3 por 10 minutos é folgado para
// o uso real e fecha a porta. Por conta (não por IP) porque é a conta que responde
// pelo envio — e porque trocar de IP é trivial.
const ENVIOS_POR_JANELA = 3
const JANELA_MS = 10 * 60_000

// Volume: acima disto não é uso, é tentativa de usar a rota como canhão. O corte de
// 30 é o do próprio template (buildAlertaDigestHtml) — o payload pode ser maior que
// isso sem ser abusivo (o client manda todas as não lidas), então o excedente é
// CORTADO, não recusado; o que passa de MAX_PAYLOAD é recusado.
const MAX_PAYLOAD = 200
const MAX_NO_EMAIL = 30

// Comprimentos: o e-mail é um resumo, não um documento. Sem teto, um campo de 5 MB
// entra no HTML e o Resend recusa a mensagem inteira (ou aceita e entrega algo
// ilegível). Cortar é melhor que recusar: o usuário recebe o resumo utilizável.
const MAX_TITULO = 200
const MAX_DESCRICAO = 500
const MAX_ALERTA_NOME = 120
const MAX_UF = 20
const MAX_LINK = 500

const URGENCIAS = new Set(['alta', 'media', 'normal'])

const texto = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.slice(0, max) : ''

/**
 * Aceita só o que o template usa, no tipo que ele espera e no tamanho que ele
 * comporta. O escape de HTML (lib/alerta-email.ts) já impede injeção no corpo do
 * e-mail; isto impede o resto — tipo errado, campo gigante, link com esquema
 * esquisito e volume absurdo — ANTES de chamar o fornecedor.
 *
 * Recusa (null) o que está estruturalmente errado; trunca o que só está grande.
 */
function validarNotifs(bruto: unknown): { erro: string } | { notifs: NotificacaoEmail[] } {
  if (!Array.isArray(bruto) || bruto.length === 0) {
    return { erro: 'Nenhuma notificação fornecida' }
  }
  if (bruto.length > MAX_PAYLOAD) {
    return { erro: `Muitas notificações num envio (máx. ${MAX_PAYLOAD})` }
  }
  const notifs: NotificacaoEmail[] = []
  for (const item of bruto.slice(0, MAX_NO_EMAIL)) {
    if (typeof item !== 'object' || item === null) {
      return { erro: 'Notificação em formato inválido' }
    }
    const n = item as Record<string, unknown>
    const titulo = texto(n.titulo, MAX_TITULO).trim()
    if (!titulo) return { erro: 'Notificação sem título' }
    // Link: só caminho interno ou http(s). 'javascript:'/'data:' não viram âncora
    // no template, mas também não têm por que atravessar a validação.
    const link = texto(n.link, MAX_LINK)
    const linkOk = /^\/(?!\/)/.test(link) || /^https?:\/\//i.test(link)
    const urgencia = typeof n.urgencia === 'string' && URGENCIAS.has(n.urgencia)
      ? (n.urgencia as NotificacaoEmail['urgencia'])
      : 'normal'
    // Reconstruído campo a campo, de propósito: nada do body chega ao template por
    // carona (spread), só o que está listado aqui.
    notifs.push({
      titulo,
      descricao: texto(n.descricao, MAX_DESCRICAO),
      urgencia,
      alertaNome: texto(n.alertaNome, MAX_ALERTA_NOME) || 'monitor',
      ...(linkOk ? { link } : {}),
      ...(typeof n.uf === 'string' && n.uf ? { uf: texto(n.uf, MAX_UF) } : {}),
    })
  }
  return { notifs }
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'RESEND_API_KEY não configurada' },
      { status: 503 }
    )
  }

  // O destinatário é SEMPRE o e-mail da própria sessão — nunca um valor vindo do
  // client. Sem isto, qualquer conta autenticada podia mandar e-mail (com HTML
  // arbitrário nas notifs) para qualquer endereço, usando o domínio da empresa
  // como relay de phishing.
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }
  const to = session.user.email

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const validado = validarNotifs((body as { notifs?: unknown } | null)?.notifs)
  if ('erro' in validado) {
    return NextResponse.json({ error: validado.erro }, { status: 400 })
  }
  const { notifs } = validado

  // DEPOIS da validação, de propósito: o contador tem que medir envio, não request.
  // Se contasse antes, um bug no client (payload inválido em laço) gastaria as três
  // fichas do usuário sem nunca ter mandado um e-mail.
  const limite = await rateLimit(`alerta-email:${to.toLowerCase()}`, ENVIOS_POR_JANELA, JANELA_MS)
  if (!limite.ok) {
    return NextResponse.json(
      { error: 'Você já enviou os resumos permitidos nos últimos minutos. Tente de novo em instantes.' },
      { status: 429, headers: { 'Retry-After': String(limite.retryAfter) } },
    )
  }

  const from = process.env.RESEND_FROM_EMAIL ?? 'contato@techealth.com.br'

  const resend = new Resend(apiKey)

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: `GovHealth AI — ${notifs.length} nova${notifs.length !== 1 ? 's' : ''} notificação${notifs.length !== 1 ? 'ões' : ''} de alerta`,
      html: buildAlertaDigestHtml(notifs, to),
    })

    if (error) {
      console.error('[alertas/email]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, id: data?.id, destinatario: to, enviadas: notifs.length })
  } catch (err) {
    console.error('[alertas/email]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
