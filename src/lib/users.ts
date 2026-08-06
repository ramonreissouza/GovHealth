// src/lib/users.ts — usuários no banco (substitui o auth hardcoded). Server-only.
// Senhas em bcrypt. Login rejeita conta suspensa/excluída.

import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { query, queryOne } from '@/lib/db'

export type Role = 'master' | 'user'

export interface Usuario {
  id: string
  email: string
  nome: string | null
  role: Role
  empresa: string | null
  telefone: string | null
  instituicao: string | null
  endereco: string | null
  cpf: string | null
  cnpj: string | null
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
    `SELECT u.id, u.email, u.nome, u.role, u.empresa, u.telefone, u.instituicao, u.endereco,
            u.cpf, u.cnpj, u.plano, u.status_assinatura,
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
    `SELECT id,email,nome,role,empresa,telefone,instituicao,endereco,cpf,cnpj,plano,status_assinatura,
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
  empresa?: string; telefone?: string; instituicao?: string; endereco?: string; cpf?: string; cnpj?: string
  plano?: string; status_assinatura?: string; expira_em?: string | null
}): Promise<Usuario> {
  const id = norm(data.email)
  const hash = await bcrypt.hash(data.senha.trim(), 10)
  await query(
    `INSERT INTO usuarios (id,email,nome,senha_hash,role,empresa,telefone,instituicao,endereco,cpf,cnpj,plano,status_assinatura,expira_em)
     VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, data.nome ?? null, hash, data.role ?? 'user', data.empresa ?? null, data.telefone ?? null,
     data.instituicao ?? null, data.endereco ?? null, data.cpf ?? null, data.cnpj ?? null,
     data.plano ?? 'trial', data.status_assinatura ?? 'trial', data.expira_em ?? null],
  )
  return (await buscarUsuario(id))!
}

export async function atualizarUsuario(id: string, patch: Partial<Pick<Usuario, 'nome' | 'empresa' | 'telefone' | 'instituicao' | 'endereco' | 'cpf' | 'cnpj' | 'plano' | 'status_assinatura' | 'expira_em' | 'suspenso'>>): Promise<void> {
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

/**
 * LGPD (Art. 18, direito à eliminação): anonimiza o titular. Não apaga a linha
 * (preserva integridade referencial e trilha de auditoria), mas remove TODO dado
 * que identifica a pessoa — em `usuarios` e nas satélites com PII (acessos,
 * feedback_issues). A conta fica inutilizável (senha zerada, suspensa, soft-deletada).
 * Após isto o registro é anônimo e sai do escopo da LGPD.
 *
 * ⚠️ Limitação conhecida: `id` == e-mail (chave legada referenciada por FKs não
 * enforçadas). O e-mail é substituído por um marcador derivado do hash na COLUNA
 * `email`, mas persiste como `id`. Erasure total exige migração para chave
 * substituta (surrogate) — follow-up. Requer a coluna `anonimizado_em`
 * (npm run lgpd:migrate).
 */
export async function anonimizarUsuario(id: string): Promise<void> {
  const alvo = norm(id)
  await query(
    `UPDATE usuarios SET
       email = 'anon+' || left(md5(id), 16) || '@anonimizado.local',
       nome = NULL, empresa = NULL, telefone = NULL, instituicao = NULL,
       endereco = NULL, cpf = NULL, cnpj = NULL,
       senha_hash = '', suspenso = true, deleted_at = COALESCE(deleted_at, now()),
       anonimizado_em = now(), atualizado_em = now()
     WHERE id = $1`,
    [alvo],
  )
  // Satélites com PII — best-effort (não falha a operação principal).
  try {
    await query(
      `UPDATE acessos SET nome=NULL, email=NULL, ip=NULL, cidade=NULL, regiao=NULL,
              pais=NULL, latitude=NULL, longitude=NULL, user_agent=NULL WHERE user_id=$1`,
      [alvo],
    )
  } catch (e) { console.warn('[lgpd] acessos:', e) }
  try {
    await query(
      `UPDATE feedback_issues SET user_email=NULL, user_nome=NULL, empresa=NULL WHERE user_id=$1`,
      [alvo],
    )
  } catch (e) { console.warn('[lgpd] feedback_issues:', e) }
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

/**
 * Provisiona/atualiza a conta ao ativar uma assinatura paga (webhook Stripe).
 * - Conta nova: cria com senha temporária (retornada p/ envio ao cliente).
 * - Conta existente: só atualiza plano/status/expiração (mantém a senha).
 * Nunca mexe em conta master. Idempotente.
 */
export async function provisionarPorAssinatura(data: {
  email: string; nome?: string | null; plano: string; empresa?: string | null
  telefone?: string | null; instituicao?: string | null; stripeCustomerId?: string | null
  expira_em?: string | null
}): Promise<{ criada: boolean; senhaTemporaria?: string }> {
  const id = norm(data.email)
  const existente = await queryOne<{ role: Role }>(`SELECT role FROM usuarios WHERE id=$1`, [id])

  if (existente) {
    // Não rebaixa nem toca no master; reativa e atualiza o plano.
    await query(
      `UPDATE usuarios
          SET plano=$2, status_assinatura='ativa', suspenso=false, deleted_at=NULL,
              expira_em=COALESCE($3::date, expira_em),
              stripe_customer_id=COALESCE($4, stripe_customer_id), atualizado_em=now()
        WHERE id=$1`,
      [id, data.plano, data.expira_em ?? null, data.stripeCustomerId ?? null],
    )
    return { criada: false }
  }

  const senha = gerarSenhaTemporaria()
  const hash = await bcrypt.hash(senha, 10)
  await query(
    `INSERT INTO usuarios (id,email,nome,senha_hash,role,empresa,telefone,instituicao,plano,status_assinatura,expira_em,stripe_customer_id)
     VALUES ($1,$1,$2,$3,'user',$4,$5,$6,$7,'ativa',$8,$9)`,
    [id, data.nome ?? null, hash, data.empresa ?? null, data.telefone ?? null, data.instituicao ?? null,
     data.plano, data.expira_em ?? null, data.stripeCustomerId ?? null],
  )
  return { criada: true, senhaTemporaria: senha }
}

/** Marca status da conta pela assinatura (inadimplente/cancelada) sem excluir. */
export async function marcarStatusAssinatura(email: string, status: 'ativa' | 'inadimplente' | 'cancelada'): Promise<void> {
  const suspende = status === 'cancelada'
  await query(
    `UPDATE usuarios SET status_assinatura=$2, suspenso=$3, atualizado_em=now()
      WHERE id=$1 AND role<>'master'`,
    [norm(email), status, suspende],
  )
}

/**
 * Reivindica (atomicamente) os trials que expiram AMANHÃ e ainda não receberam o
 * lembrete — marca trial_lembrete_em=now() e retorna os dados p/ envio do e-mail.
 * Marcar antes de enviar evita reenvio em execuções concorrentes/retries do cron.
 */
export async function reivindicarLembretesTrial(): Promise<Array<{ id: string; email: string; nome: string | null; plano: string | null; expira_em: string }>> {
  return query(
    `UPDATE usuarios
        SET trial_lembrete_em = now()
      WHERE status_assinatura = 'trial'
        AND role <> 'master'
        AND deleted_at IS NULL
        AND suspenso = false
        AND trial_lembrete_em IS NULL
        AND expira_em = (CURRENT_DATE + 1)
      RETURNING id, email, nome, plano, to_char(expira_em,'YYYY-MM-DD') AS expira_em`,
  )
}

/**
 * Reivindica os trials que EXPIRARAM recentemente (nos últimos 3 dias) e ainda não
 * receberam o e-mail de "teste acabou". A janela de 3 dias evita disparo em massa para
 * trials antigos quando a coluna é criada. Marca `trial_expirado_em` (idempotente).
 */
export async function reivindicarExpiradosTrial(): Promise<Array<{ id: string; email: string; nome: string | null; plano: string | null; expira_em: string }>> {
  return query(
    `UPDATE usuarios
        SET trial_expirado_em = now()
      WHERE status_assinatura = 'trial'
        AND role <> 'master'
        AND deleted_at IS NULL
        AND suspenso = false
        AND trial_expirado_em IS NULL
        AND expira_em < CURRENT_DATE
        AND expira_em >= (CURRENT_DATE - 3)
      RETURNING id, email, nome, plano, to_char(expira_em,'YYYY-MM-DD') AS expira_em`,
  )
}

// ── Equipe / assentos (N usuários por CNPJ) ──────────────────────────────────
// O titular é a conta que assinou (titular_id NULL) e detém os `assentos`. Os
// membros têm titular_id = id do titular e herdam plano/CNPJ. Cada um tem senha
// própria (nunca compartilhada).

const COLS_USER = `id,email,nome,role,empresa,telefone,instituicao,endereco,cpf,cnpj,plano,status_assinatura,
  to_char(expira_em,'YYYY-MM-DD') AS expira_em,suspenso,deleted_at,criado_em`

/** Resolve o titular de uma conta (ele mesmo, ou o titular do membro). */
export async function resolverTitular(userId: string): Promise<string> {
  const u = await queryOne<{ titular_id: string | null }>(`SELECT titular_id FROM usuarios WHERE id=$1`, [norm(userId)])
  return u?.titular_id ?? norm(userId)
}

/** Assentos mínimos garantidos pelo plano (a coluna `assentos` só serve para subir). */
const PISO_ASSENTOS: Record<string, number> = { empresa: 5 }

export interface EquipeInfo {
  titularId: string
  souTitular: boolean
  assentos: number
  membros: Usuario[]
  convitesPendentes: { id: string; email: string; expira_em: string; token: string }[]
  vagas: number
}

export async function equipeInfo(userId: string): Promise<EquipeInfo> {
  const id = norm(userId)
  const titularId = await resolverTitular(id)
  const tit = await queryOne<{ assentos: number | null; plano: string | null }>(
    `SELECT assentos, plano FROM usuarios WHERE id=$1`, [titularId])
  // `assentos` é preenchido à mão por conta, e nasce em 1. Uma conta Empresa criada
  // sem esse ajuste mostrava "1 assento · 0 vagas · sem vagas disponíveis no plano" —
  // contradizendo o próprio plano, que vende "Equipe: vários usuários / assentos"
  // (lib/planos.ts), e travando o convite. O piso por plano evita depender da memória
  // de quem cria a conta; para vender mais assentos, basta subir a coluna.
  const assentos = Math.max(tit?.assentos ?? 1, PISO_ASSENTOS[tit?.plano ?? ''] ?? 1)
  const membros = await query<Usuario>(
    `SELECT ${COLS_USER} FROM usuarios WHERE (id=$1 OR titular_id=$1) AND deleted_at IS NULL ORDER BY criado_em`, [titularId])
  const convitesPendentes = await query<{ id: string; email: string; expira_em: string; token: string }>(
    `SELECT id, email, token, to_char(expira_em,'YYYY-MM-DD') AS expira_em FROM convites
      WHERE titular_id=$1 AND aceito_em IS NULL AND expira_em > now() ORDER BY criado_em`, [titularId])
  return { titularId, souTitular: titularId === id, assentos, membros, convitesPendentes,
    vagas: Math.max(assentos - membros.length - convitesPendentes.length, 0) }
}

/** Cria um convite (titular). Retorna o token para o link do e-mail. */
export async function criarConvite(params: { userId: string; email: string }): Promise<{ ok: true; token: string; email: string } | { ok: false; erro: string }> {
  const titularId = await resolverTitular(params.userId)
  const info = await equipeInfo(titularId)
  if (info.vagas <= 0) return { ok: false, erro: 'sem_vagas' }
  const email = norm(params.email)
  if (!/.+@.+\..+/.test(email)) return { ok: false, erro: 'email_invalido' }
  if (await emailExiste(email)) return { ok: false, erro: 'email_existe' }
  const jaConv = await queryOne<{ id: string }>(
    `SELECT id FROM convites WHERE titular_id=$1 AND lower(email)=$2 AND aceito_em IS NULL AND expira_em>now()`, [titularId, email])
  if (jaConv) return { ok: false, erro: 'ja_convidado' }
  const tit = await queryOne<{ cnpj: string | null; plano: string | null }>(`SELECT cnpj, plano FROM usuarios WHERE id=$1`, [titularId])
  const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
  await query(
    `INSERT INTO convites (id, titular_id, cnpj, email, token, plano, expira_em)
     VALUES ($1,$2,$3,$4,$5,$6, now() + interval '7 days')`,
    [randomUUID(), titularId, tit?.cnpj ?? null, email, token, tit?.plano ?? null])
  return { ok: true, token, email }
}

/** Dados de um convite válido (para a tela de aceite). */
export async function buscarConvite(token: string): Promise<{ email: string; empresa: string | null } | null> {
  const row = await queryOne<{ email: string; titular_id: string }>(
    `SELECT email, titular_id FROM convites WHERE token=$1 AND aceito_em IS NULL AND expira_em>now()`, [token])
  if (!row) return null
  const tit = await queryOne<{ empresa: string | null }>(`SELECT empresa FROM usuarios WHERE id=$1`, [row.titular_id])
  return { email: row.email, empresa: tit?.empresa ?? null }
}

/** Aceita o convite: cria o usuário-membro com senha própria. */
export async function aceitarConvite(params: { token: string; senha: string; nome: string }): Promise<{ ok: true; email: string } | { ok: false; erro: string }> {
  const conv = await queryOne<{ id: string; email: string; titular_id: string; cnpj: string | null; plano: string | null }>(
    `SELECT id, email, titular_id, cnpj, plano FROM convites WHERE token=$1 AND aceito_em IS NULL AND expira_em>now()`, [params.token])
  if (!conv) return { ok: false, erro: 'invalido' }
  if (params.senha.trim().length < 6) return { ok: false, erro: 'senha_curta' }
  const email = norm(conv.email)
  if (await emailExiste(email)) return { ok: false, erro: 'email_existe' }
  // Capacidade no aceite: comparar MEMBROS reais com os assentos — este convite já
  // está "reservado" (conta em convitesPendentes), então não usamos `vagas` aqui,
  // senão o último convite que preenche o plano nunca poderia ser aceito.
  const eq = await equipeInfo(conv.titular_id)
  if (eq.membros.length >= eq.assentos) return { ok: false, erro: 'sem_vagas' }
  const hash = await bcrypt.hash(params.senha.trim(), 10)
  const tit = await queryOne<{ empresa: string | null }>(`SELECT empresa FROM usuarios WHERE id=$1`, [conv.titular_id])
  await query(
    `INSERT INTO usuarios (id,email,nome,senha_hash,role,empresa,cnpj,plano,status_assinatura,titular_id,assentos)
     VALUES ($1,$1,$2,$3,'user',$4,$5,$6,'ativa',$7,0)`,
    [email, params.nome?.trim() || null, hash, tit?.empresa ?? null, conv.cnpj, conv.plano, conv.titular_id])
  await query(`UPDATE convites SET aceito_em=now() WHERE id=$1`, [conv.id])
  return { ok: true, email }
}

/** Remove um MEMBRO da equipe (soft-delete): a conta não loga mais e o assento é
 * liberado. Só o titular remove; não é possível remover a si mesmo nem o titular. */
export async function removerMembro(params: { titularId: string; membroId: string }): Promise<{ ok: true } | { ok: false; erro: string }> {
  const titularId = await resolverTitular(params.titularId)
  const membroId = norm(params.membroId)
  if (membroId === titularId) return { ok: false, erro: 'nao_pode_remover_titular' }
  const membro = await queryOne<{ id: string }>(
    `SELECT id FROM usuarios WHERE id=$1 AND titular_id=$2 AND deleted_at IS NULL`, [membroId, titularId])
  if (!membro) return { ok: false, erro: 'membro_invalido' }
  // Soft-delete + encerra a sessão do membro (libera o assento imediatamente).
  await query(
    `UPDATE usuarios SET deleted_at=now(), sessao_id=NULL, sessao_expira=NULL, sessao_ultimo_visto=NULL WHERE id=$1`, [membroId])
  return { ok: true }
}

/** Cancela um convite pendente (titular). */
export async function cancelarConvite(params: { titularId: string; conviteId: string }): Promise<{ ok: true } | { ok: false; erro: string }> {
  const titularId = await resolverTitular(params.titularId)
  const apagados = await query<{ id: string }>(
    `DELETE FROM convites WHERE id=$1 AND titular_id=$2 AND aceito_em IS NULL RETURNING id`, [params.conviteId, titularId])
  if (apagados.length === 0) return { ok: false, erro: 'convite_invalido' }
  return { ok: true }
}

// ── Minha Conta (área do próprio usuário logado) ─────────────────────────────

/** Regra de senha forte: mín. 8 caracteres, com pelo menos uma letra e um número. */
export function senhaForteOk(senha: string): boolean {
  const s = (senha ?? '').trim()
  return s.length >= 8 && /[A-Za-z]/.test(s) && /[0-9]/.test(s)
}

/**
 * Troca a senha do próprio usuário: confere a senha atual, valida a força da nova
 * e grava o novo hash. Nunca expõe o hash.
 */
export async function alterarSenha(
  id: string, senhaAtual: string, novaSenha: string,
): Promise<{ ok: true } | { ok: false; erro: 'conta' | 'credenciais' | 'senha_fraca' }> {
  const uid = norm(id)
  const row = await queryOne<{ senha_hash: string; deleted_at: string | null; suspenso: boolean }>(
    `SELECT senha_hash, deleted_at, suspenso FROM usuarios WHERE id=$1`, [uid])
  if (!row || row.deleted_at || row.suspenso) return { ok: false, erro: 'conta' }
  const confere = await bcrypt.compare((senhaAtual ?? '').trim(), row.senha_hash)
  if (!confere) return { ok: false, erro: 'credenciais' }
  if (!senhaForteOk(novaSenha)) return { ok: false, erro: 'senha_fraca' }
  const hash = await bcrypt.hash(novaSenha.trim(), 10)
  await query(`UPDATE usuarios SET senha_hash=$1, atualizado_em=now() WHERE id=$2`, [hash, uid])
  return { ok: true }
}

export interface ContaResumo {
  id: string; email: string; nome: string | null; role: Role
  empresa: string | null; telefone: string | null; instituicao: string | null
  endereco: string | null; cpf: string | null; cnpj: string | null
  plano: string | null; status_assinatura: string | null; expira_em: string | null
  /** Há um cliente Stripe vinculado (cartão gerenciado no portal de cobrança). */
  temPagamento: boolean
}

/** Dados da conta do próprio usuário para a tela "Minha Conta". */
export async function contaResumo(id: string): Promise<ContaResumo | null> {
  const row = await queryOne<ContaResumo & { stripe_customer_id: string | null }>(
    `SELECT id,email,nome,role,empresa,telefone,instituicao,endereco,cpf,cnpj,plano,status_assinatura,
            to_char(expira_em,'YYYY-MM-DD') AS expira_em, stripe_customer_id
       FROM usuarios WHERE id=$1 AND deleted_at IS NULL`, [norm(id)])
  if (!row) return null
  const { stripe_customer_id, ...rest } = row
  return { ...rest, temPagamento: !!stripe_customer_id }
}

/** Customer do Stripe vinculado à conta (para abrir o portal de cobrança). */
export async function stripeCustomerIdDe(id: string): Promise<string | null> {
  const r = await queryOne<{ c: string | null }>(
    `SELECT stripe_customer_id AS c FROM usuarios WHERE id=$1`, [norm(id)])
  return r?.c ?? null
}

/** Senha temporária legível (mostrada uma vez ao admin). */
export function gerarSenhaTemporaria(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let s = ''
  for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s + '!'
}
