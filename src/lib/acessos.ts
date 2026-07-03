// src/lib/acessos.ts — registro e consulta do log de acessos. Server-only.
// Geolocalização via headers da Vercel (produção): x-vercel-ip-city/country/
// country-region/latitude/longitude. Em localhost esses headers não existem →
// grava "local/dev" sem quebrar. (LGPD: IP+geo+hora de pessoa identificada é dado
// pessoal — há expurgo automático > 90 dias e acesso restrito ao master.)

import { query, queryOne } from '@/lib/db'

export interface GeoInfo {
  ip: string | null
  cidade: string | null
  regiao: string | null
  pais: string | null
  latitude: number | null
  longitude: number | null
  userAgent: string | null
}

// Extrai IP + geo de um getter de header (funciona com Headers.get e com objeto).
export function extrairGeo(get: (n: string) => string | null | undefined): GeoInfo {
  const g = (n: string) => (get(n) ?? null) as string | null
  const dec = (v: string | null) => { if (!v) return null; try { return decodeURIComponent(v) } catch { return v } }
  const ip = (g('x-forwarded-for')?.split(',')[0].trim()) || g('x-real-ip') || null
  const cidade = dec(g('x-vercel-ip-city'))
  const pais = g('x-vercel-ip-country')
  const lat = g('x-vercel-ip-latitude')
  const lng = g('x-vercel-ip-longitude')
  const semGeo = !cidade && !pais // sem headers da Vercel = ambiente local/dev
  return {
    ip,
    cidade: semGeo ? 'local/dev' : cidade,
    regiao: g('x-vercel-ip-country-region'),
    pais: semGeo ? null : pais,
    latitude: lat ? Number(lat) : null,
    longitude: lng ? Number(lng) : null,
    userAgent: g('user-agent'),
  }
}

export async function registrarAcesso(dados: {
  userId?: string | null; nome?: string | null; email?: string | null
  evento: 'login' | 'page_view'; rota?: string | null; geo: GeoInfo
}): Promise<void> {
  const { geo } = dados
  await query(
    `INSERT INTO acessos (user_id,nome,email,evento,rota,ip,cidade,regiao,pais,latitude,longitude,user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [dados.userId ?? null, dados.nome ?? null, dados.email ?? null, dados.evento, dados.rota ?? null,
     geo.ip, geo.cidade, geo.regiao, geo.pais, geo.latitude, geo.longitude, geo.userAgent],
  )
}

export interface AcessoRow {
  id: number; user_id: string | null; nome: string | null; email: string | null
  evento: string; rota: string | null; ip: string | null
  cidade: string | null; regiao: string | null; pais: string | null
  latitude: number | null; longitude: number | null; user_agent: string | null; criado_em: string
}

export async function listarAcessos(opts: { busca?: string; evento?: string; dias?: number; limit?: number; offset?: number } = {}): Promise<{ linhas: AcessoRow[]; total: number }> {
  const where: string[] = []
  const params: unknown[] = []
  if (opts.busca) { params.push(`%${opts.busca}%`); where.push(`(email ILIKE $${params.length} OR nome ILIKE $${params.length} OR ip ILIKE $${params.length} OR cidade ILIKE $${params.length})`) }
  if (opts.evento && opts.evento !== 'todos') { params.push(opts.evento); where.push(`evento = $${params.length}`) }
  if (opts.dias) { params.push(opts.dias); where.push(`criado_em > now() - ($${params.length} || ' days')::interval`) }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const limit = Math.min(opts.limit ?? 50, 200)
  const offset = opts.offset ?? 0
  const [linhas, totalRow] = await Promise.all([
    query<AcessoRow>(
      `SELECT id,user_id,nome,email,evento,rota,ip,cidade,regiao,pais,
              latitude::float8 AS latitude, longitude::float8 AS longitude, user_agent,
              to_char(criado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em
       FROM acessos ${whereSql} ORDER BY criado_em DESC LIMIT ${limit} OFFSET ${offset}`, params),
    queryOne<{ n: number }>(`SELECT count(*)::int n FROM acessos ${whereSql}`, params),
  ])
  return { linhas, total: totalRow?.n ?? 0 }
}

// Pontos com coordenadas para o mapa (agrupa por cidade/coordenada).
export async function pontosMapa(opts: { dias?: number; userId?: string } = {}): Promise<{ latitude: number; longitude: number; cidade: string | null; pais: string | null; n: number; ultimo: string }[]> {
  const where: string[] = ['latitude IS NOT NULL', 'longitude IS NOT NULL']
  const params: unknown[] = []
  if (opts.dias) { params.push(opts.dias); where.push(`criado_em > now() - ($${params.length} || ' days')::interval`) }
  if (opts.userId) { params.push(opts.userId); where.push(`user_id = $${params.length}`) }
  return query(
    `SELECT round(latitude::numeric,3)::float8 AS latitude, round(longitude::numeric,3)::float8 AS longitude,
            max(cidade) AS cidade, max(pais) AS pais, count(*)::int AS n,
            to_char(max(criado_em),'YYYY-MM-DD"T"HH24:MI') AS ultimo
     FROM acessos WHERE ${where.join(' AND ')}
     GROUP BY 1,2 ORDER BY n DESC LIMIT 500`, params,
  )
}

/**
 * Análise de acessos para o dashboard do admin: quem acessa e o que é mais
 * acessado, com filtro por período e por estado (UF = coluna regiao).
 */
export interface AnaliseAcessos {
  kpis: { total: number; unicos: number; logins: number; pageviews: number }
  serie: { dia: string; logins: number; pageviews: number }[]
  porUf: { uf: string; n: number }[]
  topRotas: { rota: string; n: number }[]
  topUsuarios: { email: string | null; nome: string | null; n: number }[]
  topCidades: { cidade: string; n: number }[]
  dispositivos: { tipo: string; n: number }[]
  ufs: string[]
}

export async function analiseAcessos(opts: { dias?: number; uf?: string } = {}): Promise<AnaliseAcessos> {
  const dias = Math.min(Math.max(opts.dias ?? 30, 1), 365)
  const uf = opts.uf && opts.uf !== 'todos' ? opts.uf : null

  // Conjunto filtrado (período + UF opcional) — usado na maioria das agregações.
  const wf = `criado_em > now() - ($1 || ' days')::interval` + (uf ? ` AND regiao = $2` : '')
  const pf: unknown[] = uf ? [dias, uf] : [dias]
  // Conjunto só por período (para a distribuição por UF e o seletor de estados).
  const wp = `criado_em > now() - ($1 || ' days')::interval`
  const pp: unknown[] = [dias]

  const [kpisR, serie, porUf, topRotas, topUsuarios, topCidades, dispositivos, ufsR] = await Promise.all([
    queryOne<{ total: number; unicos: number; logins: number; pageviews: number }>(
      `SELECT count(*)::int total, count(DISTINCT coalesce(user_id, ip))::int unicos,
              count(*) FILTER (WHERE evento='login')::int logins,
              count(*) FILTER (WHERE evento='page_view')::int pageviews
       FROM acessos WHERE ${wf}`, pf),
    query<{ dia: string; logins: number; pageviews: number }>(
      `SELECT to_char(date_trunc('day', criado_em),'YYYY-MM-DD') dia,
              count(*) FILTER (WHERE evento='login')::int logins,
              count(*) FILTER (WHERE evento='page_view')::int pageviews
       FROM acessos WHERE ${wf} GROUP BY 1 ORDER BY 1`, pf),
    query<{ uf: string; n: number }>(
      `SELECT regiao uf, count(*)::int n FROM acessos
       WHERE ${wp} AND regiao IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 27`, pp),
    query<{ rota: string; n: number }>(
      `SELECT rota, count(*)::int n FROM acessos
       WHERE ${wf} AND evento='page_view' AND rota IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 12`, pf),
    query<{ email: string | null; nome: string | null; n: number }>(
      `SELECT email, max(nome) nome, count(*)::int n FROM acessos
       WHERE ${wf} AND email IS NOT NULL GROUP BY email ORDER BY n DESC LIMIT 10`, pf),
    query<{ cidade: string; n: number }>(
      `SELECT cidade, count(*)::int n FROM acessos
       WHERE ${wf} AND cidade IS NOT NULL AND cidade <> 'local/dev' GROUP BY 1 ORDER BY n DESC LIMIT 8`, pf),
    query<{ tipo: string; n: number }>(
      `SELECT CASE
                WHEN user_agent ~* 'bot|crawl|spider|http' THEN 'bot'
                WHEN user_agent ~* 'Mobile|Android|iPhone|iPad' THEN 'mobile'
                WHEN user_agent IS NULL THEN 'desconhecido'
                ELSE 'desktop' END tipo,
              count(*)::int n
       FROM acessos WHERE ${wf} GROUP BY 1 ORDER BY n DESC`, pf),
    query<{ regiao: string }>(
      `SELECT DISTINCT regiao FROM acessos WHERE ${wp} AND regiao IS NOT NULL ORDER BY 1`, pp),
  ])

  return {
    kpis: kpisR ?? { total: 0, unicos: 0, logins: 0, pageviews: 0 },
    serie, porUf, topRotas, topUsuarios, topCidades, dispositivos,
    ufs: ufsR.map((r) => r.regiao),
  }
}

/** Expurgo LGPD: remove acessos com mais de 90 dias. Retorna quantos removeu. */
export async function expurgarAcessosAntigos(dias = 90): Promise<number> {
  const r = await query<{ id: number }>(`DELETE FROM acessos WHERE criado_em < now() - ($1 || ' days')::interval RETURNING id`, [dias])
  return r.length
}
