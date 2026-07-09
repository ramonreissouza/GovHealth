// src/lib/seguranca.ts — SERVER-ONLY. 2FA por e-mail + sessão única.
//
// Kill-switches por env (padrão DESLIGADO — merge não muda o login em produção):
//   AUTH_2FA=on          → exige código de 6 dígitos por e-mail em todo login
//   AUTH_SESSAO_UNICA=on → bloqueia novo login enquanto houver sessão ativa
// O master (admin) é sempre isento das duas (evita lock-out operacional).

import bcrypt from 'bcryptjs'
import { randomUUID, randomBytes } from 'node:crypto'
import { query, queryOne } from '@/lib/db'
import { enviarCodigoAcesso, enviarRedefinicaoSenha } from '@/lib/email'
import { senhaForteOk } from '@/lib/users'
import { appUrl } from '@/lib/stripe'

export const FLAG_2FA = process.env.AUTH_2FA === 'on'
export const FLAG_SESSAO_UNICA = process.env.AUTH_SESSAO_UNICA === 'on'

const OTP_TTL_MIN = 10
const OTP_MAX_TENTATIVAS = 5
const SESSAO_TTL_DIAS = 7
const JANELA_ATIVA_MIN = 10 // sessão é "ativa" se vista nos últimos 10 min
const RESET_TTL_MIN = 30    // validade do link de redefinição de senha

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

// ── Redefinição de senha ("esqueci minha senha") ─────────────────────────────

/**
 * Gera um token de redefinição, guarda só o HASH (bcrypt) com validade curta e
 * envia o link por e-mail (best-effort). NÃO revela se a conta existe — sempre
 * seguro chamar (anti-enumeração); a rota responde igual em qualquer caso.
 * Conta suspensa/excluída é tratada como inexistente.
 */
export async function solicitarResetSenha(email: string): Promise<void> {
  const id = (email ?? '').trim().toLowerCase()
  if (!id) return
  const row = await queryOne<{ id: string; email: string; nome: string | null }>(
    `SELECT id, email, nome FROM usuarios WHERE id=$1 AND deleted_at IS NULL AND suspenso=false`, [id])
  if (!row) return
  const token = randomBytes(32).toString('base64url')
  const hash = await bcrypt.hash(token, 10)
  const expira = new Date(Date.now() + RESET_TTL_MIN * 60_000)
  await query(`UPDATE usuarios SET reset_hash=$2, reset_expira=$3, atualizado_em=now() WHERE id=$1`, [id, hash, expira])
  const link = `${appUrl()}/redefinir-senha?token=${encodeURIComponent(token)}&e=${encodeURIComponent(id)}`
  await enviarRedefinicaoSenha({ to: row.email, nome: row.nome, link })
}

/**
 * Redefine a senha usando o token do e-mail. Valida token, expiração e força da
 * nova senha; ao concluir, limpa o token, o OTP e ENCERRA a sessão ativa (força
 * novo login em todos os dispositivos). Token é de uso único.
 */
export async function redefinirSenhaComToken(params: { email: string; token: string; novaSenha: string })
  : Promise<{ ok: true } | { ok: false; erro: 'invalido' | 'expirado' | 'senha_fraca' }> {
  const id = (params.email ?? '').trim().toLowerCase()
  const token = (params.token ?? '').trim()
  if (!id || !token) return { ok: false, erro: 'invalido' }
  const row = await queryOne<{ reset_hash: string | null; reset_expira: string | null }>(
    `SELECT reset_hash, reset_expira FROM usuarios WHERE id=$1 AND deleted_at IS NULL AND suspenso=false`, [id])
  if (!row?.reset_hash || !row.reset_expira) return { ok: false, erro: 'invalido' }
  if (new Date(row.reset_expira).getTime() < Date.now()) return { ok: false, erro: 'expirado' }
  const confere = await bcrypt.compare(token, row.reset_hash)
  if (!confere) return { ok: false, erro: 'invalido' }
  if (!senhaForteOk(params.novaSenha)) return { ok: false, erro: 'senha_fraca' }
  const hash = await bcrypt.hash(params.novaSenha.trim(), 10)
  await query(
    `UPDATE usuarios
        SET senha_hash=$2, reset_hash=NULL, reset_expira=NULL,
            otp_hash=NULL, otp_expira=NULL, otp_tentativas=0,
            sessao_id=NULL, sessao_expira=NULL, sessao_ultimo_visto=NULL,
            atualizado_em=now()
      WHERE id=$1`, [id, hash])
  return { ok: true }
}
