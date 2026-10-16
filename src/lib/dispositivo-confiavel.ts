// src/lib/dispositivo-confiavel.ts — SERVER-ONLY. "Lembrar este dispositivo" do 2FA.
//
// Depois de um código certo, o navegador recebe um cookie assinado que dispensa o código
// NAQUELE navegador por DISPOSITIVO_DIAS. É por dispositivo, não por conta: quem tem a
// senha mas está em outra máquina continua precisando do código — liberar a conta inteira
// por uma semana anularia o 2FA justamente no caso que ele existe para barrar.
//
// O cookie carrega { conta, validade, versão da senha } assinados com HMAC do
// NEXTAUTH_SECRET. Trocar ou redefinir a senha muda usuarios.senha_alterada_em e invalida
// todos os dispositivos lembrados. Suspensão/exclusão já barram antes, no verificarLogin.

import { createHmac, timingSafeEqual } from 'node:crypto'

export const DISPOSITIVO_DIAS = 7
export const COOKIE_DISPOSITIVO = 'gh-dispositivo-2fa'

interface Carga { u: string; exp: number; s: number }

function assinar(carga: string): string {
  const segredo = process.env.NEXTAUTH_SECRET
  if (!segredo) throw new Error('NEXTAUTH_SECRET ausente')
  // Prefixo separa este uso do segredo de qualquer outra assinatura com ele.
  return createHmac('sha256', segredo).update(`dispositivo-2fa:${carga}`).digest('base64url')
}

/** Versão da senha: o instante da última troca (0 = nunca trocada desde a migration). */
function versaoSenha(senhaAlteradaEm: string | Date | null | undefined): number {
  return senhaAlteradaEm ? new Date(senhaAlteradaEm).getTime() : 0
}

/** Valor do cookie para `userId`, válido por DISPOSITIVO_DIAS. */
export function emitirDispositivo(userId: string, senhaAlteradaEm: string | Date | null | undefined): { valor: string; maxAge: number } {
  const maxAge = DISPOSITIVO_DIAS * 86_400
  const carga: Carga = { u: userId, exp: Date.now() + maxAge * 1000, s: versaoSenha(senhaAlteradaEm) }
  const b64 = Buffer.from(JSON.stringify(carga)).toString('base64url')
  return { valor: `${b64}.${assinar(b64)}`, maxAge }
}

/** O cookie dispensa o código para este usuário agora? */
export function dispositivoConfiavel(
  valor: string | undefined, userId: string, senhaAlteradaEm: string | Date | null | undefined,
): boolean {
  if (!valor) return false
  const [b64, assinatura] = valor.split('.')
  if (!b64 || !assinatura) return false
  const esperada = Buffer.from(assinar(b64))
  const recebida = Buffer.from(assinatura)
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return false
  try {
    const c = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as Carga
    return c.u === userId && c.exp > Date.now() && c.s === versaoSenha(senhaAlteradaEm)
  } catch {
    return false
  }
}

/** Opções do cookie. `secure` só fora de localhost (o teste local roda em http). */
export function opcoesCookieDispositivo(maxAge: number) {
  const https = (process.env.NEXTAUTH_URL ?? '').startsWith('https://')
  return { httpOnly: true, sameSite: 'lax' as const, secure: https, path: '/', maxAge }
}
