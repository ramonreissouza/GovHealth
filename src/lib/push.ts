// src/lib/push.ts — aviso no celular por Web Push (sem app nativo). O navegador da pessoa
// se inscreve (public/sw.js + /api/push) e o servidor manda o aviso pelo serviço de push
// do próprio navegador (Google, Apple, Mozilla, Microsoft), cifrado de ponta a ponta com
// as chaves da inscrição. Quem assina o envio é o par VAPID do servidor.
//
// Ambiente (servidor e worker): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e, opcional,
// VAPID_SUBJECT (mailto: de contato). Sem as chaves, push fica desligado e nada quebra:
// o e-mail continua sendo o canal. Gerar um par: npx web-push generate-vapid-keys.
//
// No iPhone, o push só existe com o site adicionado à Tela de Início (iOS 16.4+); a tela
// de configurações do Radar ensina isso.

import webpush from 'web-push'
import { query } from '@/lib/db'

export function chavePublicaPush(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null
}

export function pushConfigurado(): boolean {
  return !!(chavePublicaPush() && process.env.VAPID_PRIVATE_KEY?.trim())
}

/**
 * Só os serviços de push dos navegadores. A inscrição vem do cliente, e o servidor faz
 * POST no endpoint dela: sem esta lista, qualquer usuário logado faria o servidor
 * chamar uma URL que ele escolhesse.
 */
const SERVICOS_PUSH = [
  /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /(^|\.)push\.apple\.com$/,
]

export function endpointValido(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return false
  try {
    const u = new URL(endpoint)
    return u.protocol === 'https:' && SERVICOS_PUSH.some((re) => re.test(u.hostname))
  } catch { return false }
}

/** O que aparece na notificação. O service worker (public/sw.js) lê exatamente isto. */
export interface AvisoPush {
  titulo: string
  corpo: string
  /** Para onde o toque leva. */
  url: string
  /** Link assinado do "Vi": vira o botão da notificação (Android/desktop). */
  vi?: string | null
  /** Notificações com a mesma tag se substituem em vez de empilhar. */
  tag?: string
  /** Fica na tela até a pessoa mexer (convocação). */
  urgente?: boolean
}

interface Inscricao { endpoint: string; p256dh: string; auth: string }

let vapidPronto = false
function prepararVapid() {
  if (vapidPronto) return
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT?.trim() || 'mailto:contato@techealth.com.br',
    chavePublicaPush()!, process.env.VAPID_PRIVATE_KEY!.trim(),
  )
  vapidPronto = true
}

/**
 * Manda o aviso para todos os aparelhos de uma pessoa (pelo e-mail ou id da conta).
 * Inscrição vencida (404/410) é apagada; outra falha só conta, para a tela mostrar.
 * Nunca lança: push é canal a mais, não pode derrubar o envio do e-mail.
 */
export async function enviarPushPara(pessoa: string, aviso: AvisoPush): Promise<{ enviados: number; removidos: number; falhas: number }> {
  const r = { enviados: 0, removidos: 0, falhas: 0 }
  if (!pushConfigurado()) return r
  let inscricoes: Inscricao[]
  try {
    inscricoes = await query<Inscricao>(
      `SELECT p.endpoint, p.p256dh, p.auth
         FROM push_inscricoes p JOIN usuarios u ON u.id = p.user_id
        WHERE (lower(u.email) = lower($1) OR u.id = lower($1)) AND u.deleted_at IS NULL`,
      [pessoa],
    )
  } catch (e) {
    console.warn('[push] inscrições indisponíveis:', e instanceof Error ? e.message : e)
    return r
  }
  if (!inscricoes.length) return r
  prepararVapid()
  // O serviço de push limita o corpo a ~4 KB depois de cifrado.
  const corpo = JSON.stringify({ ...aviso, corpo: aviso.corpo.slice(0, 240) })
  for (const s of inscricoes) {
    try {
      // `webpush.sendNotification` (e não desestruturado): o teste troca o método.
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, corpo,
        { TTL: 6 * 3600, urgency: aviso.urgente ? 'high' : 'normal' },
      )
      r.enviados++
      await query(`UPDATE push_inscricoes SET ultimo_ok_em = now(), falhas = 0 WHERE endpoint = $1`, [s.endpoint])
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        r.removidos++
        await query(`DELETE FROM push_inscricoes WHERE endpoint = $1`, [s.endpoint]).catch(() => {})
      } else {
        r.falhas++
        console.warn('[push] falha no envio:', status ?? (e instanceof Error ? e.message : e))
        await query(`UPDATE push_inscricoes SET falhas = falhas + 1 WHERE endpoint = $1`, [s.endpoint]).catch(() => {})
      }
    }
  }
  return r
}
