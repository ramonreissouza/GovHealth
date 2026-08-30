// src/lib/acessos.ts — registro e consulta do log de acessos. Server-only.
// Geolocalização via headers da Vercel (produção): x-vercel-ip-city/country/
// country-region/latitude/longitude. Em localhost esses headers não existem →
// grava "local/dev" sem quebrar. (LGPD: IP+geo+hora de pessoa identificada é dado
// pessoal — há expurgo automático > 90 dias e acesso restrito ao master.)

import { query, queryOne } from '@/lib/db'

// A sessão do Postgres roda em UTC (medido: current_setting('TimeZone') = 'Etc/UTC'),
// então TODA hora mostrada ao admin precisa ser convertida — sem isso o painel exibe
// BRT+3 e um acesso das 21h de terça é contado (e exibido) como quarta-feira.
// Constante, nunca vem do usuário: entra por interpolação, não por parâmetro.
const TZ = 'America/Sao_Paulo'

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

export async function listarAcessos(opts: { busca?: string; evento?: string; dias?: number; uf?: string; email?: string; limit?: number; offset?: number } = {}): Promise<{ linhas: AcessoRow[]; total: number }> {
  const where: string[] = []
  const params: unknown[] = []
  if (opts.busca) { params.push(`%${opts.busca}%`); where.push(`(email ILIKE $${params.length} OR nome ILIKE $${params.length} OR ip ILIKE $${params.length} OR cidade ILIKE $${params.length})`) }
  if (opts.evento && opts.evento !== 'todos') { params.push(opts.evento); where.push(`evento = $${params.length}`) }
  if (opts.dias) { params.push(opts.dias); where.push(`criado_em > now() - ($${params.length} || ' days')::interval`) }
  if (opts.uf && opts.uf !== 'todos') { params.push(opts.uf); where.push(`regiao = $${params.length}`) }
  // Igualdade exata, não o ILIKE da busca: o seletor de usuário do dashboard
  // manda o e-mail inteiro e não pode arrastar homônimos parciais junto.
  if (opts.email && opts.email !== 'todos') { params.push(opts.email); where.push(`email = $${params.length}`) }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const limit = Math.min(opts.limit ?? 50, 200)
  const offset = opts.offset ?? 0
  const [linhas, totalRow] = await Promise.all([
    query<AcessoRow>(
      `SELECT id,user_id,nome,email,evento,rota,ip,cidade,regiao,pais,
              latitude::float8 AS latitude, longitude::float8 AS longitude, user_agent,
              to_char(criado_em AT TIME ZONE '${TZ}','YYYY-MM-DD"T"HH24:MI:SS') AS criado_em
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
 * acessado, com filtro por período, por estado (UF = coluna regiao) e por
 * usuário (e-mail). Com um usuário selecionado a resposta ganha a linha do
 * tempo dele — que página, em que dia e a que horas.
 */
export interface AnaliseAcessos {
  kpis: { total: number; unicos: number; logins: number; pageviews: number }
  serie: { dia: string; logins: number; pageviews: number }[]
  porUf: { uf: string; n: number }[]
  topRotas: { rota: string; n: number }[]
  topUsuarios: { email: string | null; nome: string | null; n: number }[]
  topCidades: { cidade: string; n: number }[]
  dispositivos: { tipo: string; n: number }[]
  /** Distribuição por hora do dia (0–23, horário de Brasília). */
  porHora: { hora: number; n: number }[]
  ufs: string[]
  /** Todo mundo que apareceu no período — alimenta o seletor de usuário. */
  usuarios: { email: string; nome: string | null; n: number }[]
  /** Linha do tempo do usuário selecionado; vazia quando não há um. */
  visitas: { criado_em: string; evento: string; rota: string | null; cidade: string | null; regiao: string | null }[]
  /** Retrato do usuário selecionado; null quando não há um. */
  resumo: { primeiro: string; ultimo: string; diasAtivos: number; total: number } | null
}

/** Teto da linha do tempo. Acima disso a tela avisa que está truncada. */
const LIMITE_VISITAS = 300

export async function analiseAcessos(opts: { dias?: number; uf?: string; usuario?: string } = {}): Promise<AnaliseAcessos> {
  const dias = Math.min(Math.max(opts.dias ?? 30, 1), 365)
  const uf = opts.uf && opts.uf !== 'todos' ? opts.uf : null
  const usuario = opts.usuario && opts.usuario !== 'todos' ? opts.usuario : null

  // Cada gráfico é filtrado por tudo MENOS a sua própria dimensão — senão o
  // seletor se apaga ao ser usado: filtrar por MG deixaria o gráfico de estados
  // com uma barra só, e filtrar por um usuário esvaziaria o "quem mais acessa",
  // impedindo trocar de usuário pelo próprio gráfico.
  const filtro = (comUf: boolean, comUsuario: boolean) => {
    const params: unknown[] = [dias]
    let sql = `criado_em > now() - ($1 || ' days')::interval`
    if (comUf && uf) { params.push(uf); sql += ` AND regiao = $${params.length}` }
    if (comUsuario && usuario) { params.push(usuario); sql += ` AND email = $${params.length}` }
    return { sql, params }
  }
  const f = filtro(true, true)            // tudo — KPIs, série, rotas, cidades…
  const fSemUf = filtro(false, true)      // distribuição por estado
  const fSemUsuario = filtro(true, false) // ranking de usuários
  const fPeriodo = filtro(false, false)   // listas dos dois seletores

  const [kpisR, serie, porUf, topRotas, topUsuarios, topCidades, dispositivos, porHora, ufsR, usuarios, visitas, resumo] = await Promise.all([
    queryOne<{ total: number; unicos: number; logins: number; pageviews: number }>(
      `SELECT count(*)::int total, count(DISTINCT coalesce(user_id, ip))::int unicos,
              count(*) FILTER (WHERE evento='login')::int logins,
              count(*) FILTER (WHERE evento='page_view')::int pageviews
       FROM acessos WHERE ${f.sql}`, f.params),
    query<{ dia: string; logins: number; pageviews: number }>(
      `SELECT to_char(date_trunc('day', criado_em AT TIME ZONE '${TZ}'),'YYYY-MM-DD') dia,
              count(*) FILTER (WHERE evento='login')::int logins,
              count(*) FILTER (WHERE evento='page_view')::int pageviews
       FROM acessos WHERE ${f.sql} GROUP BY 1 ORDER BY 1`, f.params),
    query<{ uf: string; n: number }>(
      `SELECT regiao uf, count(*)::int n FROM acessos
       WHERE ${fSemUf.sql} AND regiao IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 27`, fSemUf.params),
    query<{ rota: string; n: number }>(
      `SELECT rota, count(*)::int n FROM acessos
       WHERE ${f.sql} AND evento='page_view' AND rota IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 12`, f.params),
    query<{ email: string | null; nome: string | null; n: number }>(
      `SELECT email, max(nome) nome, count(*)::int n FROM acessos
       WHERE ${fSemUsuario.sql} AND email IS NOT NULL GROUP BY email ORDER BY n DESC LIMIT 10`, fSemUsuario.params),
    query<{ cidade: string; n: number }>(
      `SELECT cidade, count(*)::int n FROM acessos
       WHERE ${f.sql} AND cidade IS NOT NULL AND cidade <> 'local/dev' GROUP BY 1 ORDER BY n DESC LIMIT 8`, f.params),
    query<{ tipo: string; n: number }>(
      `SELECT CASE
                WHEN user_agent ~* 'bot|crawl|spider|http' THEN 'bot'
                WHEN user_agent ~* 'Mobile|Android|iPhone|iPad' THEN 'mobile'
                WHEN user_agent IS NULL THEN 'desconhecido'
                ELSE 'desktop' END tipo,
              count(*)::int n
       FROM acessos WHERE ${f.sql} GROUP BY 1 ORDER BY n DESC`, f.params),
    query<{ hora: number; n: number }>(
      `SELECT extract(hour FROM criado_em AT TIME ZONE '${TZ}')::int hora, count(*)::int n
       FROM acessos WHERE ${f.sql} GROUP BY 1 ORDER BY 1`, f.params),
    query<{ regiao: string }>(
      `SELECT DISTINCT regiao FROM acessos WHERE ${fPeriodo.sql} AND regiao IS NOT NULL ORDER BY 1`, fPeriodo.params),
    query<{ email: string; nome: string | null; n: number }>(
      `SELECT email, max(nome) nome, count(*)::int n FROM acessos
       WHERE ${fPeriodo.sql} AND email IS NOT NULL GROUP BY email ORDER BY n DESC LIMIT 200`, fPeriodo.params),
    // As duas últimas só fazem sentido com um usuário escolhido.
    usuario
      ? query<{ criado_em: string; evento: string; rota: string | null; cidade: string | null; regiao: string | null }>(
        `SELECT to_char(criado_em AT TIME ZONE '${TZ}','YYYY-MM-DD"T"HH24:MI') criado_em,
                evento, rota, cidade, regiao
         FROM acessos WHERE ${f.sql}
         ORDER BY criado_em DESC LIMIT ${LIMITE_VISITAS}`, f.params)
      : Promise.resolve([]),
    usuario
      ? queryOne<{ primeiro: string; ultimo: string; diasAtivos: number; total: number }>(
        `SELECT to_char(min(criado_em) AT TIME ZONE '${TZ}','YYYY-MM-DD"T"HH24:MI') primeiro,
                to_char(max(criado_em) AT TIME ZONE '${TZ}','YYYY-MM-DD"T"HH24:MI') ultimo,
                count(DISTINCT date_trunc('day', criado_em AT TIME ZONE '${TZ}'))::int "diasAtivos",
                count(*)::int total
         FROM acessos WHERE ${f.sql}`, f.params)
      : Promise.resolve(null),
  ])

  return {
    kpis: kpisR ?? { total: 0, unicos: 0, logins: 0, pageviews: 0 },
    serie, porUf, topRotas, topUsuarios, topCidades, dispositivos,
    // Hora sem acesso não volta do banco; o gráfico precisa das 24 para a forma
    // do dia fazer sentido (uma lacuna às 3h não pode virar "colado no 2h").
    porHora: Array.from({ length: 24 }, (_, h) => ({ hora: h, n: porHora.find((r) => r.hora === h)?.n ?? 0 })),
    ufs: ufsR.map((r) => r.regiao),
    usuarios, visitas,
    // Sem nenhum acesso no período o agregado volta com tudo nulo — isso não é
    // um resumo, é um usuário que não apareceu; a tela precisa saber a diferença.
    resumo: resumo && resumo.total > 0 ? resumo : null,
  }
}

/** Expurgo LGPD: remove acessos com mais de 90 dias. Retorna quantos removeu. */
export async function expurgarAcessosAntigos(dias = 90): Promise<number> {
  const r = await query<{ id: number }>(`DELETE FROM acessos WHERE criado_em < now() - ($1 || ' days')::interval RETURNING id`, [dias])
  return r.length
}
