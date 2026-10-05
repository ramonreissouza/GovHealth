// src/app/api/edital/peca/route.ts
// Peças jurídicas além da impugnação (que sai junto da análise, em /api/edital/analise):
// pedido de esclarecimento, recurso e contrarrazões. O prazo e a lista de artigos saem
// prontos de lib/pecas-juridicas.ts; o modelo só redige, e a minuta é conferida depois.
//
// Esta rota gasta quota do provedor de IA e segura a conexão por até 5 minutos. O
// middleware só limita por IP (150/min) e não trava API para trial vencido, então
// ela tem as próprias travas, por CONTA:
//   1. assinatura que permite uso (trial vencido, cancelada ou expirada: não);
//   2. cota por janela (GERACOES_POR_JANELA);
//   3. uma redação por vez (vaga com TTL, liberada no fim).

import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { IA_HABILITADA } from '@/lib/features'
import { getLLM, hojeBR, LLM_MODEL, llmConfigurado } from '@/lib/llm'
import { assinaturaPermiteUso } from '@/lib/plano-gating'
import { liberarVaga, ocuparVaga, rateLimit } from '@/lib/rate-limit'
import {
  fontesDaEntrada, normalizarPeca, prazoDaPeca, promptDaPeca, sanearEntrada, validarEntrada,
  type EntradaPeca, type PrazoPeca,
} from '@/lib/pecas-juridicas'

export const runtime = 'nodejs'
// Medido com o GLM gratuito: 47 s (esclarecimento) a 2,3 min (recurso). A peça é
// longa e o modelo escreve devagar; 60 s cortaria o recurso no meio.
export const maxDuration = 300

// Uso real: algumas peças por pregão, cada uma levando 1 a 2 minutos. 10 por hora é
// folgado para quem está na mesa e corta um laço que queimaria a quota de todos.
const GERACOES_POR_JANELA = 10
const JANELA_MS = 60 * 60_000
// A vaga vence sozinha um pouco depois do maxDuration, se a instância morrer no meio.
const VAGA_TTL_MS = 330_000

// Mesma defesa da análise: modelos às vezes cercam o JSON com ```json ou texto.
function extrairJson(s: string): string {
  const t = s.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const i = t.indexOf('{')
  const j = t.lastIndexOf('}')
  return i >= 0 && j > i ? t.slice(i, j + 1) : t
}

type UsuarioSessao = { id?: string; email?: string | null; role?: string; status?: string | null; expiraEm?: string | null }

export async function POST(req: NextRequest) {
  let vaga: string | null = null
  try {
    if (!IA_HABILITADA) {
      return NextResponse.json({ error: 'Recurso de IA temporariamente desativado.' }, { status: 503 })
    }
    if (!llmConfigurado()) {
      return NextResponse.json({ error: 'A IA não está configurada neste ambiente.' }, { status: 503 })
    }

    const session = await getServerSession(authOptions)
    const u = session?.user as UsuarioSessao | undefined
    const conta = (u?.id || u?.email || '').toLowerCase()
    if (!conta) return NextResponse.json({ error: 'Entre na sua conta para gerar a peça.' }, { status: 401 })
    if (!assinaturaPermiteUso({ role: u?.role, status: u?.status, expiraEm: u?.expiraEm })) {
      return NextResponse.json({ error: 'Sua assinatura não está ativa. Renove o plano para gerar peças.' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 })
    const parcial = sanearEntrada(body as Record<string, unknown>)
    const invalido = validarEntrada(parcial)
    if (invalido) return NextResponse.json({ error: invalido }, { status: 400 })
    const entrada = parcial as EntradaPeca
    // AAAA-MM-DD: abertura (esclarecimento), ata/intimação (recurso) ou divulgação do recurso (contrarrazões).
    const dataBase = typeof (body as { dataBase?: unknown }).dataBase === 'string' ? (body as { dataBase: string }).dataBase : ''

    // Resolvida por requisição: a instância da função vive além de um dia.
    const hoje = hojeBR()
    let prazo: PrazoPeca | null = null
    if (dataBase) {
      const p = prazoDaPeca(entrada.tipo, dataBase, hoje.iso)
      if ('erro' in p) return NextResponse.json({ error: p.erro }, { status: 400 })
      prazo = p
    }

    // Depois da validação, como no e-mail de alertas: a cota mede geração, não pedido
    // malformado.
    const limite = await rateLimit(`peca:${conta}`, GERACOES_POR_JANELA, JANELA_MS)
    if (!limite.ok) {
      return NextResponse.json(
        { error: `Você já gerou ${GERACOES_POR_JANELA} peças na última hora. Tente de novo em ${Math.ceil(limite.retryAfter / 60)} min.` },
        { status: 429, headers: { 'Retry-After': String(limite.retryAfter) } },
      )
    }
    if (!(await ocuparVaga(`peca:${conta}`, 1, VAGA_TTL_MS))) {
      return NextResponse.json(
        { error: 'Já há uma peça sendo redigida nesta conta. Espere ela terminar.' },
        { status: 429, headers: { 'Retry-After': '60' } },
      )
    }
    vaga = `peca:${conta}`

    const { system, user } = promptDaPeca(entrada, prazo, hoje)
    const completion = await getLLM().chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 6000,
      temperature: 0.2,
    })

    const raw = completion.choices[0]?.message?.content ?? '{}'
    let bruto: unknown
    try {
      bruto = JSON.parse(extrairJson(raw))
    } catch {
      return NextResponse.json({ error: 'A resposta da IA não pôde ser lida. Tente gerar de novo.' }, { status: 502 })
    }
    const peca = normalizarPeca(entrada.tipo, bruto, {
      prazo, intencaoManifestada: entrada.intencaoManifestada, fontes: fontesDaEntrada(entrada), hojeIso: hoje.iso,
    })
    if (!peca) {
      return NextResponse.json({ error: 'A IA devolveu uma peça incompleta. Tente gerar de novo.' }, { status: 502 })
    }
    return NextResponse.json({ peca })
  } catch (error) {
    // O erro do SDK pode trazer endpoint, ids do provedor e configuração: fica no log,
    // e o cliente recebe só um código para achar a linha.
    const ref = randomUUID().slice(0, 8)
    console.error(`[edital/peca] ref=${ref}`, error)
    return NextResponse.json({ error: `Não foi possível gerar a peça agora. Tente de novo em instantes (código ${ref}).` }, { status: 500 })
  } finally {
    if (vaga) await liberarVaga(vaga)
  }
}
