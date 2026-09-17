// scripts/migrar-delta-radar.mjs — puxa para o banco NOVO o que ficou só no ANTIGO.
//
//   node --env-file=.env.local scripts/migrar-delta-radar.mjs --dry   # só mostra
//   node --env-file=.env.local scripts/migrar-delta-radar.mjs         # copia
//
// POR QUE EXISTE
//
// A migração para a VPS nova foi um dump: a partir do instante da cópia, o banco novo
// congelou, mas o coletor deste PC continuou escrevendo no ANTIGO por mais um dia.
// Tudo o que ele capturou nesse intervalo existe num lugar só.
//
// O CORTE NÃO É CHUTADO. Para cada tabela, ele é o `max()` da própria coluna de tempo
// NO DESTINO. Isso faz a ferramenta ser idempotente de graça: rodar duas vezes na
// segunda não acha nada, e se o túnel cair no meio, é só rodar de novo.
//
// TRÊS ARMADILHAS, todas medidas antes de escrever isto:
//
//   1) `radar_mensagens.id` é BIGINT GERADO PELO BANCO. Copiar o id cru encosta na
//      sequência do destino e cedo ou tarde colide com uma linha diferente. Então o id
//      NÃO é copiado: o destino gera o dele, e a identidade real da mensagem é o
//      `msg_hash` (UNIQUE), que é o mesmo dos dois lados. Mesma regra para
//      `radar_auditoria` e `acessos`.
//
//   2) `radar_notificacoes.mensagem_id` aponta para aquele id que acabou de mudar. Por
//      isso as mensagens vão primeiro e devolvem um mapa hash → id novo; a notificação
//      é reescrita com o id do destino. O `id` dela é texto montado pela aplicação
//      (`nm:<msgId>:email`), então ele TAMBÉM é remontado — senão a chave guarda um id
//      que não existe mais e a linha vira uma mentira consistente só por fora.
//
//   3) FK de processo. As mensagens apontam para `radar_processos`, e processo que não
//      existir no destino derruba o lote inteiro. Medido: os 40 processos envolvidos
//      são todos anteriores ao corte, ou seja, já vieram no dump. Ainda assim a
//      ferramenta CONFERE antes e deixa de fora (relatando) o que não encontrar, em
//      vez de abortar a migração inteira por causa de uma linha.
//
// NÃO DISPARA E-MAIL. As notificações pendentes são copiadas como estão, com o status
// que tinham. Hoje isso é inócuo porque ninguém agenda `/api/cron/radar-notify` — se
// um dia agendarem, os pendentes deste delta entram na fila junto com os do dia.

import pg from 'pg'
import { sslParaHost } from './lib/pg-ssl.mjs'

const DRY = process.argv.includes('--dry')
const LOTE = 200
// Sobrescreve o corte automatico. Serve para repuxar uma janela maior de proposito
// (e e o que permite exercitar a ferramenta em dry contra um banco so).
const iDesde = process.argv.indexOf('--desde')
const DESDE = iDesde >= 0 ? new Date(process.argv[iDesde + 1]) : null
if (DESDE && Number.isNaN(DESDE.getTime())) throw new Error('--desde precisa de uma data ISO valida')

const URL_DESTINO = process.env.DATABASE_URL
// O antigo continua no .env.local como DATABASE_URL_ORACLE (a VM que rodava produção).
const URL_ORIGEM = process.env.DATABASE_URL_ORIGEM || process.env.DATABASE_URL_ORACLE

if (!URL_DESTINO) throw new Error('DATABASE_URL (destino) ausente')
if (!URL_ORIGEM) throw new Error('DATABASE_URL_ORIGEM / DATABASE_URL_ORACLE (origem) ausente')
if (URL_DESTINO === URL_ORIGEM) throw new Error('origem e destino são o mesmo banco — nada a fazer')

const abrir = (u) => new pg.Pool({ connectionString: u, ssl: sslParaHost(u), max: 3, connectionTimeoutMillis: 15000 })
const origem = abrir(URL_ORIGEM)
const destino = abrir(URL_DESTINO)
const q = async (p, s, a = []) => (await p.query(s, a)).rows

/** Colunas reais da tabela no DESTINO, menos as que ele mesmo gera. */
async function colunasDe(tabela, excluir = []) {
  const rows = await q(destino, `
    SELECT column_name FROM information_schema.columns
     WHERE table_name = $1 AND is_generated = 'NEVER'
     ORDER BY ordinal_position`, [tabela])
  return rows.map((r) => r.column_name).filter((c) => !excluir.includes(c))
}

/** O corte: até onde o destino já sabe. */
async function corteDe(tabela, colTempo) {
  if (DESDE) return DESDE
  const [r] = await q(destino, `SELECT max(${colTempo}) AS t FROM ${tabela}`)
  return r?.t ?? new Date(0)
}

function insercao(tabela, colunas, linhas, conflito) {
  const cols = colunas.map((c) => `"${c}"`).join(', ')
  const valores = []
  const params = []
  let i = 1
  for (const l of linhas) {
    valores.push(`(${colunas.map(() => `$${i++}`).join(', ')})`)
    for (const c of colunas) params.push(l[c] ?? null)
  }
  return {
    sql: `INSERT INTO ${tabela} (${cols}) VALUES ${valores.join(', ')} ${conflito} RETURNING *`,
    params,
  }
}

async function emLotes(linhas, fn) {
  let n = 0
  for (let i = 0; i < linhas.length; i += LOTE) n += await fn(linhas.slice(i, i + LOTE))
  return n
}

console.log(DRY ? '— MODO DRY: nada será gravado —\n' : '— copiando de verdade —\n')
for (const [rotulo, p] of [['origem ', origem], ['destino', destino]]) {
  const [r] = await q(p, `SELECT current_database() d, inet_server_addr()::text h`)
  console.log(`  ${rotulo}: ${r.d} @ ${r.h}`)
}
console.log()

// ── 1. contratacoes (independente, chave natural) ───────────────────────────
{
  const corte = await corteDe('contratacoes', 'coletado_em')
  const cols = await colunasDe('contratacoes')
  const linhas = await q(origem, `SELECT * FROM contratacoes WHERE coletado_em > $1 ORDER BY coletado_em`, [corte])
  console.log(`contratacoes        corte ${new Date(corte).toISOString()} · ${linhas.length} candidata(s)`)
  if (linhas.length && !DRY) {
    const n = await emLotes(linhas, async (lote) => {
      const { sql, params } = insercao('contratacoes', cols, lote, 'ON CONFLICT (numero_controle_pncp) DO NOTHING')
      return (await destino.query(sql, params)).rowCount
    })
    console.log(`                    → ${n} inserida(s)`)
  }
}

// ── 2. radar_mensagens (id regerado; identidade = msg_hash) ─────────────────
const mapaHashId = new Map()
// Os hashes que o delta vai levar. Em DRY o mapa hash->id nao existe (nada e
// inserido), entao e este conjunto que responde "esta notificacao teria dona?" -
// sem ele o relatorio de dry acusa 100% de orfas, que e mentira.
const hashesDoDelta = new Set()
let msgsIgnoradas = 0
{
  const corte = await corteDe('radar_mensagens', 'capturado_em')
  const cols = await colunasDe('radar_mensagens', ['id'])
  let linhas = await q(origem, `SELECT * FROM radar_mensagens WHERE capturado_em > $1 ORDER BY capturado_em`, [corte])
  console.log(`radar_mensagens     corte ${new Date(corte).toISOString()} · ${linhas.length} candidata(s)`)

  // Armadilha 3: processo que não existe no destino derrubaria o lote inteiro.
  const idsProc = [...new Set(linhas.map((l) => l.processo_id).filter(Boolean))]
  const existem = new Set((await q(destino,
    `SELECT id FROM radar_processos WHERE id = ANY($1::text[])`, [idsProc])).map((r) => r.id))
  const faltando = idsProc.filter((id) => !existem.has(id))
  if (faltando.length) {
    const antes = linhas.length
    linhas = linhas.filter((l) => !l.processo_id || existem.has(l.processo_id))
    msgsIgnoradas = antes - linhas.length
    console.log(`                    ⚠ ${faltando.length} processo(s) ausente(s) no destino → ${msgsIgnoradas} mensagem(ns) fora`)
  }

  for (const l of linhas) if (l.msg_hash) hashesDoDelta.add(l.msg_hash)
  const guardar = (r) => { if (r.msg_hash) mapaHashId.set(r.msg_hash, r.id) }
  if (linhas.length && !DRY) {
    const n = await emLotes(linhas, async (lote) => {
      const { sql, params } = insercao('radar_mensagens', cols, lote, 'ON CONFLICT (msg_hash) DO NOTHING')
      const ins = (await destino.query(sql, params)).rows
      ins.forEach(guardar)
      return ins.length
    })
    // As que já existiam não voltam do RETURNING — o id delas vem de uma busca.
    const faltam = linhas.map((l) => l.msg_hash).filter((h) => h && !mapaHashId.has(h))
    if (faltam.length) {
      for (const r of await q(destino, `SELECT id, msg_hash FROM radar_mensagens WHERE msg_hash = ANY($1::text[])`, [faltam])) guardar(r)
    }
    console.log(`                    → ${n} inserida(s), ${linhas.length - n} já existia(m)`)
  }
}

// ── 3. radar_notificacoes (mensagem_id e id remapeados) ─────────────────────
{
  const corte = await corteDe('radar_notificacoes', 'criado_em')
  const cols = await colunasDe('radar_notificacoes')
  const linhas = await q(origem, `
    SELECT n.*, m.msg_hash FROM radar_notificacoes n
      JOIN radar_mensagens m ON m.id = n.mensagem_id
     WHERE n.criado_em > $1 ORDER BY n.criado_em`, [corte])
  console.log(`radar_notificacoes  corte ${new Date(corte).toISOString()} · ${linhas.length} candidata(s)`)

  const prontas = []
  let semMapa = 0
  for (const l of linhas) {
    const novoId = mapaHashId.get(l.msg_hash)
    // Em DRY o id novo ainda nao existe: o que da para afirmar e se a mensagem dona
    // faz parte do delta que seria copiado.
    if (DRY) { if (hashesDoDelta.has(l.msg_hash)) prontas.push(l); else semMapa++; continue }
    if (!novoId) { semMapa++; continue }
    const idAntigo = String(l.id)
    prontas.push({ ...l, mensagem_id: novoId, id: idAntigo.replace(/^nm:\d+:/, `nm:${novoId}:`) })
  }
  if (semMapa) console.log(`                    ⚠ ${semMapa} sem mensagem correspondente → fora`)
  if (DRY) console.log(`                    → ${prontas.length} seria(m) copiada(s)`)
  if (prontas.length && !DRY) {
    const n = await emLotes(prontas, async (lote) => {
      const { sql, params } = insercao('radar_notificacoes', cols, lote, 'ON CONFLICT (id) DO NOTHING')
      return (await destino.query(sql, params)).rowCount
    })
    console.log(`                    → ${n} inserida(s)`)
  }
}

// ── 4. auditoria e acessos (id gerado pelo destino) ─────────────────────────
for (const [tabela, colTempo] of [['radar_auditoria', 'criado_em'], ['acessos', 'criado_em']]) {
  const corte = await corteDe(tabela, colTempo)
  const cols = await colunasDe(tabela, ['id'])
  const linhas = await q(origem, `SELECT * FROM ${tabela} WHERE ${colTempo} > $1 ORDER BY ${colTempo}`, [corte])
  console.log(`${tabela.padEnd(19)} corte ${new Date(corte).toISOString()} · ${linhas.length} candidata(s)`)
  if (linhas.length && !DRY) {
    const n = await emLotes(linhas, async (lote) => {
      const { sql, params } = insercao(tabela, cols, lote, 'ON CONFLICT DO NOTHING')
      return (await destino.query(sql, params)).rowCount
    })
    console.log(`                    → ${n} inserida(s)`)
  }
}

console.log(DRY ? '\n— dry: nada foi gravado —' : '\n— fim —')
await origem.end()
await destino.end()
