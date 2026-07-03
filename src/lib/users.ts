// src/lib/users.ts — usuários no banco (substitui o auth hardcoded). Server-only.
// Senhas em bcrypt. Login rejeita conta suspensa/excluída.

import bcrypt from 'bcryptjs'
import { query, queryOne } from '@/lib/db'

export type Role = 'master' | 'user'

export interface Usuario {
  id: string
  email: string
  nome: string | null
  role: Role
  empresa: string | null
  telefone: string | null
  plano: string | null
  status_assinatura: string | null
  expira_em: string | null
  suspenso: boolean
  deleted_at: string | null
  criado_em: string
  ultimo_acesso?: string | null
}

interface UsuarioComHash extends Usuario { senha_hash: string }

const norm = (email: string) => email.trim().toLowerCase()

/** Verifica login. Retorna o usuário (sem hash) ou um motivo de recusa. */
export async function verificarLogin(email: string, senha: string): Promise<{ user?: Usuario; motivo?: string }> {
  const row = await queryOne<UsuarioComHash>(
    `SELECT * FROM usuarios WHERE id = $1`, [norm(email)],
  )
  if (!row) return { motivo: 'credenciais' }
  if (row.deleted_at) return { motivo: 'excluida' }
  if (row.suspenso) return { motivo: 'suspensa' }
  const ok = await bcrypt.compare(senha, row.senha_hash)
  if (!ok) return { motivo: 'credenciais' }
  const { senha_hash: _omit, ...user } = row
  return { user: user as Usuario }
}

/** Lista usuários (não exclui deletados por padrão; filtros básicos). */
export async function listarUsuarios(opts: { busca?: string; status?: string; incluirExcluidos?: boolean } = {}): Promise<Usuario[]> {
  const where: string[] = []
  const params: unknown[] = []
  if (!opts.incluirExcluidos) where.push('u.deleted_at IS NULL')
  if (opts.busca) { params.push(`%${opts.busca}%`); where.push(`(u.email ILIKE $${params.length} OR u.nome ILIKE $${params.length} OR u.empresa ILIKE $${params.length})`) }
  if (opts.status === 'suspensa') where.push('u.suspenso = true')
  if (opts.status === 'ativa') where.push('u.suspenso = false AND u.deleted_at IS NULL')
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return query<Usuario>(
    `SELECT u.id, u.email, u.nome, u.role, u.empresa, u.telefone, u.plano, u.status_assinatura,
            to_char(u.expira_em,'YYYY-MM-DD') AS expira_em, u.suspenso,
            u.deleted_at, u.criado_em,
            (SELECT max(a.criado_em) FROM acessos a WHERE a.user_id = u.id AND a.evento='login') AS ultimo_acesso
     FROM usuarios u ${whereSql}
     ORDER BY u.criado_em DESC`,
    params,
  )
}

export async function buscarUsuario(id: string): Promise<Usuario | null> {
  return queryOne<Usuario>(
    `SELECT id,email,nome,role,empresa,telefone,plano,status_assinatura,
            to_char(expira_em,'YYYY-MM-DD') AS expira_em,suspenso,deleted_at,criado_em
     FROM usuarios WHERE id=$1`, [norm(id)],
  )
}

export async function emailExiste(email: string): Promise<boolean> {
  const r = await queryOne<{ e: string }>(`SELECT id AS e FROM usuarios WHERE id=$1`, [norm(email)])
  return !!r
}

/** Cria usuário com senha (gera hash). Retorna o usuário criado. */
export async function criarUsuario(data: {
  email: string; nome?: string; senha: string; role?: Role
  empresa?: string; telefone?: string; plano?: string; status_assinatura?: string; expira_em?: string | null
}): Promise<Usuario> {
  const id = norm(data.email)
  const hash = await bcrypt.hash(data.senha, 10)
  await query(
    `INSERT INTO usuarios (id,email,nome,senha_hash,role,empresa,telefone,plano,status_assinatura,expira_em)
     VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, data.nome ?? null, hash, data.role ?? 'user', data.empresa ?? null, data.telefone ?? null,
     data.plano ?? 'trial', data.status_assinatura ?? 'trial', data.expira_em ?? null],
  )
  return (await buscarUsuario(id))!
}

export async function atualizarUsuario(id: string, patch: Partial<Pick<Usuario, 'nome' | 'empresa' | 'telefone' | 'plano' | 'status_assinatura' | 'expira_em' | 'suspenso'>>): Promise<void> {
  const campos: string[] = []
  const params: unknown[] = []
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    params.push(v); campos.push(`${k} = $${params.length}`)
  }
  if (!campos.length) return
  params.push(norm(id))
  await query(`UPDATE usuarios SET ${campos.join(', ')}, atualizado_em=now() WHERE id=$${params.length}`, params)
}

/** Soft delete: marca deleted_at (nunca apaga a linha — preserva auditoria). */
export async function excluirUsuario(id: string): Promise<void> {
  await query(`UPDATE usuarios SET deleted_at=now(), suspenso=true, atualizado_em=now() WHERE id=$1`, [norm(id)])
}

/** KPIs do dashboard gerencial (dados reais). */
export async function kpisAdmin() {
  const [contas, ativos30, novasMes, acessosHoje, acessos7d, porPlano, expirando] = await Promise.all([
    queryOne<{ n: number }>(`SELECT count(*)::int n FROM usuarios WHERE deleted_at IS NULL`),
    queryOne<{ n: number }>(`SELECT count(DISTINCT user_id)::int n FROM acessos WHERE evento='login' AND criado_em > now()-interval '30 days'`),
    queryOne<{ n: number }>(`SELECT count(*)::int n FROM usuarios WHERE deleted_at IS NULL AND criado_em > date_trunc('month', now())`),
    queryOne<{ n: number }>(`SELECT count(*)::int n FROM acessos WHERE evento='login' AND criado_em::date = now()::date`),
    queryOne<{ n: number }>(`SELECT count(*)::int n FROM acessos WHERE evento='login' AND criado_em > now()-interval '7 days'`),
    query<{ plano: string; n: number }>(`SELECT COALESCE(plano,'—') plano, count(*)::int n FROM usuarios WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC`),
    query<{ id: string; email: string; expira_em: string }>(`SELECT id,email,to_char(expira_em,'YYYY-MM-DD') expira_em FROM usuarios WHERE deleted_at IS NULL AND expira_em IS NOT NULL AND expira_em < now()+interval '30 days' ORDER BY expira_em ASC LIMIT 10`),
  ])
  return {
    totalContas: contas?.n ?? 0,
    ativos30: ativos30?.n ?? 0,
    novasMes: novasMes?.n ?? 0,
    acessosHoje: acessosHoje?.n ?? 0,
    acessos7d: acessos7d?.n ?? 0,
    porPlano,
    expirando,
  }
}

/** Senha temporária legível (mostrada uma vez ao admin). */
export function gerarSenhaTemporaria(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let s = ''
  for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s + '!'
}
