// src/lib/seguranca.ts — SERVER-ONLY. 2FA por e-mail + sessão única.
//
// Kill-switches por env (padrão DESLIGADO — merge não muda o login em produção):
//   AUTH_2FA=on          → exige código de 6 dígitos por e-mail em todo login
//   AUTH_SESSAO_UNICA=on → bloqueia novo login enquanto houver sessão ativa
// O master (admin) é sempre isento das duas (evita lock-out operacional).

import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { query, queryOne } from '@/lib/db'
import { enviarCodigoAcesso } from '@/lib/email'

export const FLAG_2FA = process.env.AUTH_2FA === 'on'
export const FLAG_SESSAO_UNICA = process.env.AUTH_SESSAO_UNICA === 'on'

const OTP_TTL_MIN = 10
const OTP_MAX_TENTATIVAS = 5
const SESSAO_TTL_DIAS = 7
const JANELA_ATIVA_MIN = 10 // sessão é "ativa" se vista nos últimos 10 min

function codigo6(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

/** Gera, armazena (hash) e envia o OTP. Retorna se o e-mail saiu. */
export async function enviarOtp(user: { id: string; email: string; nome: string | null }): Promise<boolean> {
  const codigo = codigo6()
  const hash = await bcrypt.hash(codigo, 8)
  const expira = new Date(Date.now() + OTP_TTL_MIN * 60_000)
  await query(`UPDATE usuarios SET otp_hash=$2, otp_expira=$3, otp_tentativas=0 WHERE id=$1`, [user.id, hash, expira])
  const r = await enviarCodigoAcesso({ to: user.email, nome: user.nome, codigo })
  return r.enviado
}

/** Verifica o OTP; limpa em sucesso; conta tentativas (bloqueia após 5). */
export async function verificarOtp(userId: string, codigo: string): Promise<boolean> {
  const row = await queryOne<{ otp_hash: string | null; otp_expira: string | null; otp_tentativas: number | null }>(
    `SELECT otp_hash, otp_expira, otp_tentativas FROM usuarios WHERE id=$1`, [userId],
  )
  if (!row?.otp_hash || !row.otp_expira) return false
  if (new Date(row.otp_expira).getTime() < Date.now()) return false
  if ((row.otp_tentativas ?? 0) >= OTP_MAX_TENTATIVAS) return false
  const ok = await bcrypt.compare((codigo ?? '').trim(), row.otp_hash)
  if (!ok) {
    await query(`UPDATE usuarios SET otp_tentativas=COALESCE(otp_tentativas,0)+1 WHERE id=$1`, [userId])
    return false
  }
  await query(`UPDATE usuarios SET otp_hash=NULL, otp_expira=NULL, otp_tentativas=0 WHERE id=$1`, [userId])
  return true
}

/** Há sessão ativa (recente) em outro dispositivo? */
export async function sessaoAtiva(userId: string): Promise<boolean> {
  const row = await queryOne<{ sessao_id: string | null; sessao_expira: string | null; sessao_ultimo_visto: string | null }>(
    `SELECT sessao_id, sessao_expira, sessao_ultimo_visto FROM usuarios WHERE id=$1`, [userId],
  )
  if (!row?.sessao_id || !row.sessao_expira || !row.sessao_ultimo_visto) return false
  const agora = Date.now()
  if (new Date(row.sessao_expira).getTime() < agora) return false
  return agora - new Date(row.sessao_ultimo_visto).getTime() < JANELA_ATIVA_MIN * 60_000
}

/** Inicia uma sessão (novo id) e retorna o id. */
export async function iniciarSessao(userId: string): Promise<string> {
  const id = randomUUID()
  const expira = new Date(Date.now() + SESSAO_TTL_DIAS * 86_400_000)
  await query(`UPDATE usuarios SET sessao_id=$2, sessao_expira=$3, sessao_ultimo_visto=now() WHERE id=$1`, [userId, id, expira])
  return id
}

/** Heartbeat: mantém a sessão viva. Retorna false se esta sessão já não é a atual. */
export async function tocarSessao(userId: string, sessaoId: string): Promise<boolean> {
  const row = await queryOne<{ sessao_id: string | null }>(`SELECT sessao_id FROM usuarios WHERE id=$1`, [userId])
  if (!row || row.sessao_id !== sessaoId) return false
  await query(`UPDATE usuarios SET sessao_ultimo_visto=now() WHERE id=$1`, [userId])
  return true
}

/** Encerra a sessão (logout) — libera o assento p/ novo login. */
export async function encerrarSessao(userId: string): Promise<void> {
  await query(`UPDATE usuarios SET sessao_id=NULL, sessao_expira=NULL, sessao_ultimo_visto=NULL WHERE id=$1`, [userId])
}
