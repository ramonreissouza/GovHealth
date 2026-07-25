// src/lib/emendas-ingest.ts — GRAVAÇÃO e LEITURA do cache local de emendas de saúde.
//
// Porquê: o Radar de Verba precisa das ~1.200+ emendas de saúde/ano, mas puxá-las ao
// vivo estoura o timeout de 30s da rota + o rate-limit do Portal. O cron sync-emendas
// varre tudo (codigoFuncao=10) e grava aqui; a rota /api/radar-verba lê do banco.
//
// A tabela guarda os valores CRUS (string BR do Portal). O score/temperatura é
// calculado só na leitura (src/lib/radar-verba.ts, fonte única) — este módulo não
// sabe nada de score. Idempotente por codigo_emenda.

import { query } from '@/lib/db'
import { buscarEmendas, CODIGO_FUNCAO_SAUDE, type EmendaParlamentar } from '@/lib/emendas'

export interface IngestEmendasResumo {
  ano: number
  paginas: number
  recebidas: number
  gravadas: number
  falhas: number
  truncadoPorTempo: boolean
}

// Puxa um ano inteiro de emendas de saúde (filtro no servidor) e faz UPSERT em lote.
// budgetMs protege o tempo da função serverless; maxPaginas é o teto duro de segurança.
export async function ingestEmendasSaudeAno(
  ano: number,
  opts: { maxPaginas?: number; delayMs?: number; budgetMs?: number } = {},
): Promise<IngestEmendasResumo> {
  const maxPaginas = opts.maxPaginas ?? 300
  const delayMs = opts.delayMs ?? 200
  const budgetMs = opts.budgetMs ?? Infinity
  const inicio = Date.now()

  let recebidas = 0
  let gravadas = 0
  let falhas = 0
  let paginas = 0
  let truncadoPorTempo = false

  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    if (Date.now() - inicio > budgetMs) { truncadoPorTempo = true; break }
    const lote = await buscarEmendas({ ano, pagina, codigoFuncao: CODIGO_FUNCAO_SAUDE })
    if (lote.length === 0) break
    paginas = pagina
    recebidas += lote.length
    // Concorrência limitada (Pool do Neon max=5).
    const res = await Promise.allSettled(lote.map((e) => upsertEmenda(e)))
    for (const r of res) r.status === 'fulfilled' ? gravadas++ : falhas++
    await new Promise((r) => setTimeout(r, delayMs))
  }

  return { ano, paginas, recebidas, gravadas, falhas, truncadoPorTempo }
}

async function upsertEmenda(e: EmendaParlamentar): Promise<void> {
  await query(
    `INSERT INTO emendas_saude (codigo_emenda, numero_emenda, ano, autor, tipo_emenda,
       funcao, subfuncao, localidade_gasto, valor_empenhado, valor_liquidado, valor_pago, coletado_em)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
     ON CONFLICT (codigo_emenda) DO UPDATE SET
       numero_emenda    = EXCLUDED.numero_emenda,
       ano              = EXCLUDED.ano,
       autor            = EXCLUDED.autor,
       tipo_emenda      = EXCLUDED.tipo_emenda,
       funcao           = EXCLUDED.funcao,
       subfuncao        = EXCLUDED.subfuncao,
       localidade_gasto = EXCLUDED.localidade_gasto,
       valor_empenhado  = EXCLUDED.valor_empenhado,
       valor_liquidado  = EXCLUDED.valor_liquidado,
       valor_pago       = EXCLUDED.valor_pago,
       coletado_em      = now()`,
    [
      e.codigoEmenda,
      e.numeroEmenda ?? null,
      e.ano ?? null,
      e.autor ?? null,
      e.tipoEmenda ?? null,
      e.funcao ?? null,
      e.subfuncao ?? null,
      e.localidadeDoGasto ?? null,
      e.valorEmpenhado ?? null,
      e.valorLiquidado ?? null,
      e.valorPago ?? null,
    ],
  )
}

interface EmendaRow {
  codigo_emenda: string
  numero_emenda: string | null
  ano: number | null
  autor: string | null
  tipo_emenda: string | null
  funcao: string | null
  subfuncao: string | null
  localidade_gasto: string | null
  valor_empenhado: string | null
  valor_liquidado: string | null
  valor_pago: string | null
}

// Reconstrói o EmendaParlamentar cru a partir da linha do banco. Preserva a
// distinção "não informado" (null) vs "informado" (string) que o radar usa.
function rowToEmenda(r: EmendaRow): EmendaParlamentar {
  return {
    codigoEmenda: r.codigo_emenda,
    numeroEmenda: r.numero_emenda ?? '',
    ano: r.ano ?? 0,
    tipoEmenda: r.tipo_emenda ?? '',
    autor: r.autor ?? '',
    localidadeDoGasto: r.localidade_gasto ?? '',
    funcao: r.funcao ?? '',
    subfuncao: r.subfuncao ?? '',
    valorEmpenhado: r.valor_empenhado ?? '',
    valorLiquidado: r.valor_liquidado ?? '',
    valorPago: r.valor_pago ?? '',
  }
}

// Lê as emendas ESTADUAIS de saúde (portais de transparência estaduais; piloto BA).
// Complementa o Radar de Verba com um lead que o Portal federal não tem.
export interface EmendaEstadualRow {
  num_codigo: string; ano: number | null; autor: string; orgao: string; acao: string
  uf: string; empenhado: number; liquidado: number; pago: number
}
export async function lerEmendasEstaduais(ufs?: string[]): Promise<EmendaEstadualRow[]> {
  try {
    const base = `SELECT num_codigo, ano, autor, orgao, acao, uf,
        empenhado::float8 AS empenhado, liquidado::float8 AS liquidado, pago::float8 AS pago
      FROM emendas_estaduais WHERE categoria_saude = true`
    return ufs?.length
      ? await query<EmendaEstadualRow>(`${base} AND uf = ANY($1::text[])`, [ufs.map((u) => u.toUpperCase())])
      : await query<EmendaEstadualRow>(base)
  } catch (e) {
    console.warn('[emendas-estaduais] indisponível:', e instanceof Error ? e.message : e)
    return []
  }
}

// Lê do cache as emendas de saúde dos anos pedidos. Retorna as cruas (a rota aplica
// score/filtros/ordenação) e o ano mais recente que tem dados.
export async function lerEmendasSaude(anos: number[]): Promise<{ brutas: EmendaParlamentar[]; anoUsado: number }> {
  const rows = await query<EmendaRow>(
    `SELECT codigo_emenda, numero_emenda, ano, autor, tipo_emenda, funcao, subfuncao,
            localidade_gasto, valor_empenhado, valor_liquidado, valor_pago
       FROM emendas_saude
      WHERE ano = ANY($1::int[])`,
    [anos],
  )
  const brutas = rows.map(rowToEmenda)
  const anosComDados = new Set(brutas.map((e) => e.ano))
  const anoUsado = anos.find((a) => anosComDados.has(a)) ?? anos[0]
  return { brutas, anoUsado }
}
