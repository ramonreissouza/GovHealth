// src/lib/radar/vi-token.ts — o link "Vi" dos avisos do Radar por e-mail. Quem recebe a
// convocação está no celular, fora do sistema: o link confirma a leitura sem login. Por
// isso ele é ASSINADO (HMAC com o NEXTAUTH_SECRET) e vale só para uma notificação e por
// VALIDADE_DIAS; quem tem o link pode confirmar aquele aviso, e mais nada.
//
// Formato: <id da notificação em base64url>.<expira em segundos, base 36>.<assinatura>

import { createHmac, timingSafeEqual } from 'node:crypto'

const VALIDADE_DIAS = 7

function segredo(): string {
  const s = process.env.NEXTAUTH_SECRET
  if (!s) throw new Error('NEXTAUTH_SECRET ausente: sem ele o link "Vi" não pode ser assinado')
  return s
}

const assinar = (corpo: string) => createHmac('sha256', segredo()).update(`radar-vi:${corpo}`).digest('base64url')

export function tokenVi(notificacaoId: string, agoraMs = Date.now()): string {
  const exp = Math.floor(agoraMs / 1000 + VALIDADE_DIAS * 86400).toString(36)
  const corpo = `${Buffer.from(notificacaoId, 'utf8').toString('base64url')}.${exp}`
  return `${corpo}.${assinar(corpo)}`
}

/** O id da notificação, ou null se o token for inválido, adulterado ou vencido. */
export function lerTokenVi(token: string | null | undefined, agoraMs = Date.now()): string | null {
  const partes = String(token ?? '').split('.')
  if (partes.length !== 3) return null
  const [id64, exp, sig] = partes
  const esperado = Buffer.from(assinar(`${id64}.${exp}`))
  const recebido = Buffer.from(sig)
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return null
  const expira = parseInt(exp, 36)
  if (!Number.isFinite(expira) || expira * 1000 < agoraMs) return null
  const id = Buffer.from(id64, 'base64url').toString('utf8')
  return id || null
}
