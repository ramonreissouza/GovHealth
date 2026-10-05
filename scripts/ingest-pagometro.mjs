// scripts/ingest-pagometro.mjs — carga do PAGÔMETRO a partir da MSC do Siconfi (Tesouro).
//
//   npm run pagometro:ingest                       # últimos 3 meses fechados, só o que falta
//   npm run pagometro:ingest -- --meses 13         # o que o CronJob semanal roda
//   npm run pagometro:ingest -- --desde 2025-07    # histórico desde julho/2025
//   npm run pagometro:ingest -- --ufs BA,SE --limite 20 --dry
//   npm run pagometro:ingest -- --so-resumo        # só recalcula a tabela `pagometro`
//
// Para cada ente (município, estado, DF) e mês, lê a Matriz de Saldos Contábeis (classe 6,
// saldo final), soma as duas contas que importam — só compra de fornecedor — e grava uma
// linha em `pagometro_mensal`. No fim, recalcula o resumo de cada ente em `pagometro`,
// que é o que o app lê. O cálculo mora em src/lib/pagometro-calculo.mjs.
//
// SÓ O QUE FALTA. Um (ente, mês) que já está no banco não é buscado de novo. É isso que
// faz a carga retomar de onde parou depois de um corte, e é o que torna a rotina mensal
// barata: os meses de antes já estão lá. Use --forcar para rebuscar. Sobrando tempo, a
// rodada relê os meses gravados há mais tempo, para pegar MSC retificada.
//
// DEVAGAR DE PROPÓSITO. A API devolve 429 quando apertada (medido em 04/10/2026: ~60
// chamadas seguidas a ~1/s bastaram). Uma chamada por vez, pausa entre elas, e o 429
// aumenta a pausa e espera. Mês fechado: o mês M fica disponível até o fim de M+1, então
// o último mês pedido por padrão é o de dois meses atrás.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { novoPool } from './lib/pg-ssl.mjs'
import { somarMsc, resumirDias, normalizeKey } from '../src/lib/pagometro-calculo.mjs'
import { atualizarPagometroContratacoes } from './lib/pagometro-contratacoes.mjs'

if (!process.env.DATABASE_URL) {
  try { const env = fs.readFileSync('.env.local', 'utf8'); const m = env.match(/^DATABASE_URL=(.*)$/m); if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '') } catch {}
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const API = 'https://apidatalake.tesouro.gov.br/ords/siconfi/tt'
const UA = 'GovHealth/1.0 (pagometro; contato@techealth.com.br)'
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ── argumentos ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const arg = (nome) => { const i = argv.indexOf(nome); return i >= 0 ? argv[i + 1] : undefined }
const tem = (nome) => argv.includes(nome)
const DRY = tem('--dry')
const FORCAR = tem('--forcar')
const SO_RESUMO = tem('--so-resumo')
const SO_SCHEMA = tem('--so-schema')
const UFS = arg('--ufs')?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
const ENTES = arg('--entes')?.split(',').map((s) => s.trim()).filter(Boolean)
const LIMITE = Number(arg('--limite') ?? 0) || 0
const MAX_MIN = Number(arg('--max-min') ?? process.env.PAGOMETRO_MAX_MIN ?? 600)
let pausaMs = Number(arg('--pausa-ms') ?? process.env.PAGOMETRO_PAUSA_MS ?? 2000)

const ym =(s) => { const m = String(s ?? '').match(/^(\d{4})-(\d{2})$/); if (!m) throw new Error(`mês inválido: ${s} (use AAAA-MM)`); return { ano: +m[1], mes: +m[2] } }
const idx = ({ ano, mes }) => ano * 12 + (mes - 1)
const deIdx = (i) => ({ ano: Math.floor(i / 12), mes: (i % 12) + 1 })
const rot = ({ ano, mes }) => `${ano}-${String(mes).padStart(2, '0')}`

const hoje = new Date()
const ultimoFechado = deIdx(idx({ ano: hoje.getUTCFullYear(), mes: hoje.getUTCMonth() + 1 }) - 2)
const ate = arg('--ate') ? ym(arg('--ate')) : ultimoFechado
// --meses N: janela móvel dos N meses fechados mais recentes (o CronJob usa 13: os 12
// da média + o anterior, de onde sai o fluxo do primeiro). Sem nada, os últimos 3.
const MESES_JANELA = Number(arg('--meses') ?? 0) || 0
const desde = arg('--desde') ? ym(arg('--desde')) : deIdx(idx(ate) - ((MESES_JANELA || 3) - 1))
const MESES = []
for (let i = idx(desde); i <= idx(ate); i++) MESES.push(deIdx(i))
if (!MESES.length) { console.error(`ERRO: --desde ${rot(desde)} é depois de --ate ${rot(ate)}.`); process.exit(1) }

// ── rede ─────────────────────────────────────────────────────────────────────────
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const INICIO = Date.now()
const minutos = () => (Date.now() - INICIO) / 60_000
const estourou = () => minutos() > MAX_MIN
const stats = { chamadas: 0, r429: 0, falhas: 0 }

async function getJson(caminho) {
  let tentativa = 0
  for (;;) {
    await dormir(pausaMs)
    stats.chamadas++
    let r
    try {
      r = await fetch(API + caminho, { signal: AbortSignal.timeout(180_000), headers: { 'user-agent': UA, accept: 'application/json' } })
    } catch (e) {
      if (++tentativa > 3) throw e
      await dormir(5000 * 2 ** (tentativa - 1))
      continue
    }
    if (r.status === 429) {
      stats.r429++
      if (++tentativa > 5) throw new Error('429 persistente')
      pausaMs = Math.min(10_000, Math.round(pausaMs * 1.5))
      const espera = 30_000 * 2 ** (tentativa - 1)
      console.log(`  … 429 do Siconfi: esperando ${espera / 1000}s; pausa entre chamadas agora ${pausaMs}ms`)
      await dormir(espera)
      continue
    }
    if (r.status >= 500) {
      if (++tentativa > 3) throw new Error(`HTTP ${r.status}`)
      await dormir(5000 * 2 ** (tentativa - 1))
      continue
    }
    if (!r.ok) throw new Error(`HTTP ${r.status} ${caminho}`)
    return r.json()
  }
}

/** Todas as páginas (a API corta em 5.000 linhas). */
async function mscDoMes(codigoIbge, { ano, mes }) {
  const itens = []
  for (let offset = 0; ; offset += 5000) {
    const j = await getJson(`/msc_orcamentaria?id_ente=${codigoIbge}&an_referencia=${ano}&me_referencia=${mes}&co_tipo_matriz=MSCC&classe_conta=6&id_tv=ending_balance&offset=${offset}&limit=5000`)
    itens.push(...(j.items ?? []))
    if (!j.hasMore) return itens
  }
}

// ── banco ────────────────────────────────────────────────────────────────────────
const pool = novoPool(process.env.DATABASE_URL, { max: 2, connectionTimeoutMillis: 20_000 })
const q = async (sql, params = []) => (await pool.query(sql, params)).rows

async function main() {
  // DRY não escreve nada, nem o schema: dá para rodar contra produção só para ver.
  if (!DRY) await q(fs.readFileSync(path.join(RAIZ, 'db', 'schema-pagometro.sql'), 'utf8'))
  if (SO_SCHEMA) { console.log('✓ schema do Pagômetro aplicado'); return }

  const lista = (await getJson('/entes')).items ?? []
  let entes = lista
    .filter((e) => ['M', 'E', 'D'].includes(e.esfera))
    .map((e) => ({
      codigo: String(e.cod_ibge),
      nome: e.ente,
      uf: String(e.uf).toUpperCase(),
      tipo: e.esfera === 'M' ? 'municipio' : 'estado',
      key: e.esfera === 'M' ? normalizeKey(e.ente) : '',
      populacao: Number(e.populacao) || 0,
    }))
    .sort((a, b) => b.populacao - a.populacao) // os grandes primeiro: são os que mais aparecem nos editais
  if (UFS) entes = entes.filter((e) => UFS.includes(e.uf))
  if (ENTES) entes = entes.filter((e) => ENTES.includes(e.codigo))
  if (LIMITE) entes = entes.slice(0, LIMITE)

  if (!SO_RESUMO) await coletar(entes)
  await resumir(lista)
  // O prazo novo vale para o score, o filtro e o e-mail só depois de gravado em cada
  // contratação (Fase 3).
  if (!DRY) await atualizarPagometroContratacoes(pool)
}

async function coletar(entes) {
  console.log(`[pagometro] ${entes.length} entes × ${MESES.length} meses (${rot(MESES[0])} a ${rot(MESES[MESES.length - 1])})${DRY ? ' — DRY, nada gravado' : ''}`)
  const ja = new Set()
  if (!FORCAR) {
    const rows = await q(
      `SELECT codigo_ibge, ano, mes FROM pagometro_mensal WHERE (ano * 12 + mes - 1) BETWEEN $1 AND $2`,
      [idx(MESES[0]), idx(MESES[MESES.length - 1])],
    ).catch((e) => { if (DRY) return []; throw e }) // DRY sem a tabela: tudo conta como faltando
    for (const r of rows) ja.add(`${r.codigo_ibge}:${r.ano}:${r.mes}`)
  }
  let gravados = 0, semEntrega = 0, pulados = 0, erros = 0, feitos = 0
  // Lê e grava um (ente, mês). true = havia MSC; false = o ente ainda não entregou.
  async function buscar(e, m) {
    const itens = await mscDoMes(e.codigo, m)
    if (!itens.length) return false
    const s = somarMsc(itens)
    if (DRY) {
      if (gravados < 5) console.log(`  ${e.nome}/${e.uf} ${rot(m)}: a pagar ${s.aPagar.toFixed(0)} · pago acum. ${s.pagoAcumulado.toFixed(0)} · Saúde ${s.aPagarSaude.toFixed(0)} / ${s.pagoAcumuladoSaude.toFixed(0)}`)
      return true
    }
    await q(
      `INSERT INTO pagometro_mensal (codigo_ibge, ano, mes, ente_tipo, uf, municipio_key, a_pagar, pago_acumulado, a_pagar_saude, pago_acumulado_saude, linhas_msc, coletado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
       ON CONFLICT (codigo_ibge, ano, mes) DO UPDATE SET
         a_pagar = EXCLUDED.a_pagar, pago_acumulado = EXCLUDED.pago_acumulado,
         a_pagar_saude = EXCLUDED.a_pagar_saude, pago_acumulado_saude = EXCLUDED.pago_acumulado_saude,
         linhas_msc = EXCLUDED.linhas_msc, coletado_em = now()`,
      [e.codigo, m.ano, m.mes, e.tipo, e.uf, e.key, s.aPagar, s.pagoAcumulado, s.aPagarSaude, s.pagoAcumuladoSaude, s.linhas],
    )
    return true
  }

  // 1) O que falta. O teto é conferido a cada mês, não só a cada ente: com 429 em
  // sequência um ente sozinho pode levar meia hora, e passar do teto do Job mata a
  // rodada antes do resumo.
  for (const e of entes) {
    if (estourou()) break
    for (const m of MESES) {
      if (ja.has(`${e.codigo}:${m.ano}:${m.mes}`)) { pulados++; continue }
      if (estourou()) break
      try {
        if (await buscar(e, m)) gravados++
        else semEntrega++ // ainda não entregou: a próxima rodada tenta de novo
      } catch (err) {
        erros++
        console.warn(`  ✗ ${e.nome}/${e.uf} ${rot(m)}: ${String(err?.message ?? err).slice(0, 160)}`)
      }
    }
    feitos++
    if (feitos % 50 === 0) {
      console.log(`[pagometro] ${feitos}/${entes.length} entes · ${gravados} meses gravados · ${semEntrega} sem entrega · ${stats.chamadas} chamadas · ${stats.r429}×429 · ${minutos().toFixed(0)} min`)
    }
  }
  if (estourou()) console.log(`[pagometro] teto de ${MAX_MIN} min atingido — ${entes.length - feitos} entes ficam para a próxima rodada`)

  // 2) Com o que sobrar do tempo, relê o que já está no banco, do mais antigo para o mais
  // novo: o ente pode retificar a MSC de um mês já entregue, e sem isto a primeira versão
  // ficaria para sempre. Rodada após rodada, cada (ente, mês) da janela volta a ser lido.
  let relidos = 0
  if (!FORCAR && !DRY && !estourou()) {
    const porCodigo = new Map(entes.map((e) => [e.codigo, e]))
    // Só o que foi lido antes desta rodada: o que acabou de entrar não precisa de releitura.
    const antigos = await q(
      `SELECT codigo_ibge, ano, mes FROM pagometro_mensal
        WHERE (ano * 12 + mes - 1) BETWEEN $1 AND $2 AND coletado_em < $3
        ORDER BY coletado_em LIMIT 20000`,
      [idx(MESES[0]), idx(MESES[MESES.length - 1]), new Date(INICIO)],
    )
    for (const r of antigos) {
      if (estourou()) break
      const e = porCodigo.get(r.codigo_ibge)
      if (!e) continue // fora do filtro desta rodada (--ufs/--entes/--limite)
      try {
        if (await buscar(e, { ano: r.ano, mes: r.mes })) relidos++
      } catch (err) {
        erros++
        console.warn(`  ✗ releitura ${e.nome}/${e.uf} ${r.ano}-${r.mes}: ${String(err?.message ?? err).slice(0, 160)}`)
      }
    }
  }
  console.log(`[pagometro] coleta: ${gravados} meses ${DRY ? 'lidos' : 'gravados'}, ${pulados} já estavam no banco, ${relidos} relidos, ${semEntrega} ainda sem entrega, ${erros} erros, ${stats.chamadas} chamadas, ${stats.r429}×429`)
  if (erros && !gravados && !pulados) process.exitCode = 1
}

async function resumir(lista) {
  if (DRY) return
  const nomes = new Map(lista.map((e) => [String(e.cod_ibge), e.ente]))
  // 14 meses para trás do último: 12 de janela + o anterior de cada um, para o fluxo.
  const rows = await q(
    `SELECT codigo_ibge, ano, mes, ente_tipo, uf, municipio_key,
            a_pagar::float8 AS a_pagar, pago_acumulado::float8 AS pago_acumulado,
            a_pagar_saude::float8 AS a_pagar_saude, pago_acumulado_saude::float8 AS pago_acumulado_saude
       FROM pagometro_mensal
      WHERE (ano * 12 + mes - 1) >= (SELECT max(ano * 12 + mes - 1) - 13 FROM pagometro_mensal)`,
  )
  const porEnte = new Map()
  for (const r of rows) {
    const k = r.codigo_ibge
    if (!porEnte.has(k)) porEnte.set(k, { ...r, serie: [] })
    porEnte.get(k).serie.push({ ano: r.ano, mes: r.mes, aPagar: r.a_pagar, pagoAcumulado: r.pago_acumulado, aPagarSaude: r.a_pagar_saude, pagoAcumuladoSaude: r.pago_acumulado_saude })
  }
  let comDias = 0, comSaude = 0
  for (const [codigo, e] of porEnte) {
    const s = resumirDias(e.serie)
    if (s.dias != null) comDias++
    if (s.diasSaude != null) comSaude++
    await q(
      `INSERT INTO pagometro (ente_tipo, uf, municipio_key, municipio_nome, codigo_ibge, dias, dias_saude, meses, mes_inicio, mes_fim, pago_periodo, pago_periodo_saude, atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
       ON CONFLICT (ente_tipo, uf, municipio_key) DO UPDATE SET
         municipio_nome = EXCLUDED.municipio_nome, codigo_ibge = EXCLUDED.codigo_ibge, dias = EXCLUDED.dias,
         dias_saude = EXCLUDED.dias_saude, meses = EXCLUDED.meses, mes_inicio = EXCLUDED.mes_inicio,
         mes_fim = EXCLUDED.mes_fim, pago_periodo = EXCLUDED.pago_periodo,
         pago_periodo_saude = EXCLUDED.pago_periodo_saude, atualizado_em = now()`,
      [e.ente_tipo, e.uf, e.municipio_key, nomes.get(codigo) ?? null, codigo, s.dias, s.diasSaude, s.meses, s.inicio, s.fim, s.pagoPeriodo, s.pagoPeriodoSaude],
    )
  }
  // Quem saiu da janela (parou de entregar a MSC) sai do resumo: sem isto a tela
  // mostraria para sempre a média de um ano que já passou. Sem nada na janela, não
  // apaga nada — tabela vazia não é motivo para limpar o resumo.
  let removidos = 0
  if (porEnte.size) {
    const del = await pool.query(`DELETE FROM pagometro WHERE codigo_ibge <> ALL($1::text[])`, [[...porEnte.keys()]])
    removidos = del.rowCount ?? 0
  }
  console.log(`[pagometro] resumo: ${porEnte.size} entes; ${comDias} com dias; ${comSaude} com dias da Saúde; ${removidos} fora da janela removidos`)
}

try { await main() } catch (e) {
  console.error('[pagometro] falhou:', e)
  process.exitCode = 1
} finally {
  await pool.end()
}
