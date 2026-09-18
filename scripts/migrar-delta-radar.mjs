// scripts/migrar-delta-radar.mjs — puxa para o banco NOVO o que ficou só no ANTIGO.
//
//   npm run radar:delta                    # DRY: só mostra o que faria
//   npm run radar:delta:aplicar            # copia de verdade
//   node --env-file=.env.local scripts/migrar-delta-radar.mjs --aplicar --desde 2026-09-16T00:00:00Z
//
// POR QUE EXISTE
//
// A migração para a VPS nova foi um dump: a partir do instante da cópia, o banco novo
// congelou, mas o coletor deste PC continuou escrevendo no ANTIGO por mais um dia.
// Tudo o que ele capturou nesse intervalo existe num lugar só.
//
// O CORTE É O INSTANTE DO DUMP, NÃO O `max()` DO DESTINO
//
// A primeira versão calculava o corte como `max(coluna_de_tempo)` no destino, chamando
// isso de "idempotência de graça". Estava errado por dois motivos:
//
//   · o destino NÃO congelou — a app da VPS escreve. Uma escrita do destino às 10h
//     empurra o corte para 10h e apaga do escopo, em silêncio, tudo que a origem gravou
//     entre o dump e as 10h. Foi o que aconteceu com `radar_auditoria` e `acessos`, que
//     deram "0 candidatas" e foram lidas como "já estava tudo lá";
//   · a idempotência nunca veio do corte, e sim das CHAVES NATURAIS: `ON CONFLICT
//     (numero_controle_pncp)` e `ON CONFLICT (msg_hash)`. O `max()` só cobrava o preço.
//
// Então o corte é uma constante conhecida — o instante do dump — e rodar duas vezes
// continua sendo inofensivo porque quem protege é o `ON CONFLICT`.
//
// TRÊS ARMADILHAS DE CHAVE, todas medidas no banco real:
//
//   1) `radar_mensagens.id` é BIGINT GERADO PELO BANCO. Copiar o id cru encosta na
//      sequência do destino e cedo ou tarde colide com uma linha diferente. O id NÃO é
//      copiado: o destino gera o dele, e a identidade real da mensagem é o `msg_hash`
//      (UNIQUE), que é o mesmo dos dois lados.
//
//   2) `radar_notificacoes.mensagem_id` aponta para aquele id que acabou de mudar. O
//      mapa hash → id é resolvido SEMPRE consultando o destino — nunca a partir do que
//      o passo anterior inseriu. Isso é o que faz a retomada funcionar: se a execução
//      morrer entre as mensagens e as notificações, a segunda rodada reencontra os ids
//      pelo hash em vez de achar o mapa vazio e jogar tudo fora.
//
//   3) FK de processo: mensagem cujo `radar_processos` não existe no destino derrubaria
//      o lote inteiro. A ferramenta confere antes e deixa de fora, RELATANDO.
//
// O QUE ELA NÃO COPIA, DE PROPÓSITO — e isto é parte do contrato, não esquecimento:
//
//   · `itens` e `resultados`, filhas de `contratacoes`. As contratações chegam sem elas,
//     e como o produto deriva aberto/encerrado da presença em `resultados`, uma
//     contratação copiada aparece ABERTA mesmo que a origem já soubesse o contrário.
//   · `radar_processos`. Processo criado na origem depois do dump não é trazido; as
//     mensagens dele ficam de fora (item 3 acima), com aviso.
//   · `radar_auditoria` e `acessos`, salvo `--incluir-logs`. As duas são BIGSERIAL sem
//     chave natural: `ON CONFLICT DO NOTHING` nunca dispara nelas, então copiar NÃO é
//     idempotente e rodar duas vezes duplica. São log de auditoria e analytics de
//     página — o risco de duplicar vale mais do que o que se ganha. Com a flag, a
//     ferramenta avisa em voz alta antes de tocar nelas.
//
// NÃO DISPARA E-MAIL. As notificações vão com o status que tinham. Hoje isso é inócuo
// porque ninguém agenda `/api/cron/radar-notify`; se um dia agendarem, os pendentes
// deste delta entram na fila junto com os do dia.

import { novoPool } from './lib/pg-ssl.mjs'

// GRAVAR É OPT-IN. Ferramenta que copia entre dois bancos e fica no repositório para
// alguém usar meses depois não pode ter a gravação como default.
const APLICAR = process.argv.includes('--aplicar')
const DRY = !APLICAR
const INCLUIR_LOGS = process.argv.includes('--incluir-logs')
const LOTE = 200

// O instante do dump para a VPS. Medido: era o `max(capturado_em)` do destino ANTES de
// qualquer cópia (2026-09-16T12:16:27Z). Sobrescreva com --desde para outra janela.
const iDesde = process.argv.indexOf('--desde')
const DESDE = iDesde >= 0
  ? new Date(process.argv[iDesde + 1])
  : new Date(process.env.DUMP_EM ?? '2026-09-16T12:16:27Z')
if (Number.isNaN(DESDE.getTime())) throw new Error('--desde precisa de uma data ISO válida')

const URL_DESTINO = process.env.DATABASE_URL
// O antigo continua no .env.local como DATABASE_URL_ORACLE (a VM que rodava produção).
const URL_ORIGEM = process.env.DATABASE_URL_ORIGEM || process.env.DATABASE_URL_ORACLE

if (!URL_DESTINO) throw new Error('DATABASE_URL (destino) ausente')
if (!URL_ORIGEM) throw new Error('DATABASE_URL_ORIGEM / DATABASE_URL_ORACLE (origem) ausente')
if (URL_DESTINO === URL_ORIGEM) throw new Error('origem e destino são o mesmo banco — nada a fazer')

const origem = novoPool(URL_ORIGEM, { max: 3, connectionTimeoutMillis: 15000 })
const destino = novoPool(URL_DESTINO, { max: 3, connectionTimeoutMillis: 15000 })
const q = async (p, s, a = []) => (await p.query(s, a)).rows

/**
 * Colunas de uma tabela, do schema CORRENTE.
 *
 * `table_schema` no filtro não é zelo: sem ele, um `staging.contratacoes` ou um schema
 * de backup esquecido faz `information_schema.columns` devolver as colunas das duas, e
 * o INSERT sai com coluna repetida — ou com a lista de outra tabela.
 */
async function colunasDe(pool, tabela, excluir = []) {
  const rows = await q(pool, `
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1 AND is_generated = 'NEVER'
     ORDER BY ordinal_position`, [tabela])
  return rows.map((r) => r.column_name).filter((c) => !excluir.includes(c))
}

/**
 * As colunas que dá para copiar: a INTERSEÇÃO dos dois bancos.
 *
 * A ferramenta liga bancos de instantes diferentes, então divergência de schema é o
 * caso esperado. Usar só as colunas do destino e preencher com `l[c] ?? null` grava
 * NULL EXPLÍCITO — e NULL explícito não aciona `DEFAULT`. Numa coluna `NOT NULL
 * DEFAULT` (há várias no schema do Radar) isso derruba o lote inteiro no meio da
 * migração. Fora da interseção, deixa o destino aplicar o default dele.
 */
async function colunasComuns(tabela, excluir = []) {
  const [noDestino, naOrigem] = await Promise.all([
    colunasDe(destino, tabela, excluir),
    colunasDe(origem, tabela, excluir),
  ])
  const naOrigemSet = new Set(naOrigem)
  const comuns = noDestino.filter((c) => naOrigemSet.has(c))
  const soDestino = noDestino.filter((c) => !naOrigemSet.has(c))
  const soOrigem = naOrigem.filter((c) => !noDestino.includes(c))
  if (soDestino.length) console.log(`                    · só no destino (default preservado): ${soDestino.join(', ')}`)
  if (soOrigem.length) console.log(`                    · só na origem (não copiada): ${soOrigem.join(', ')}`)
  return comuns
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
  return { sql: `INSERT INTO ${tabela} (${cols}) VALUES ${valores.join(', ')} ${conflito}`, params }
}

async function emLotes(linhas, fn) {
  let n = 0
  for (let i = 0; i < linhas.length; i += LOTE) n += await fn(linhas.slice(i, i + LOTE))
  return n
}

console.log(DRY ? '— MODO DRY: nada será gravado (use --aplicar para copiar) —\n' : '— copiando de verdade —\n')
for (const [rotulo, p] of [['origem ', origem], ['destino', destino]]) {
  const [r] = await q(p, `SELECT current_database() d, inet_server_addr()::text h`)
  console.log(`  ${rotulo}: ${r.d} @ ${r.h}`)
}
console.log(`  corte  : ${DESDE.toISOString()}\n`)

// ── 1. contratacoes (chave natural) ─────────────────────────────────────────
{
  console.log(`contratacoes`)
  const cols = await colunasComuns('contratacoes')
  const linhas = await q(origem, `SELECT * FROM contratacoes WHERE coletado_em > $1 ORDER BY coletado_em`, [DESDE])
  console.log(`                    ${linhas.length} candidata(s)`)
  if (linhas.length && APLICAR) {
    const n = await emLotes(linhas, async (lote) => {
      const { sql, params } = insercao('contratacoes', cols, lote, 'ON CONFLICT (numero_controle_pncp) DO NOTHING')
      return (await destino.query(sql, params)).rowCount
    })
    console.log(`                    → ${n} inserida(s), ${linhas.length - n} já existia(m)`)
    console.log(`                    ⚠ sem itens nem resultados: aparecem como ABERTAS até o ETL alcançá-las`)
  }
}

// ── 2. radar_mensagens (id regerado; identidade = msg_hash) ─────────────────
{
  console.log(`\nradar_mensagens`)
  const cols = await colunasComuns('radar_mensagens', ['id'])
  let linhas = await q(origem, `SELECT * FROM radar_mensagens WHERE capturado_em > $1 ORDER BY capturado_em`, [DESDE])
  console.log(`                    ${linhas.length} candidata(s)`)

  // FK: processo ausente no destino derrubaria o lote inteiro.
  const idsProc = [...new Set(linhas.map((l) => l.processo_id).filter(Boolean))]
  const existem = new Set((await q(destino,
    `SELECT id FROM radar_processos WHERE id = ANY($1::text[])`, [idsProc])).map((r) => r.id))
  const faltando = idsProc.filter((id) => !existem.has(id))
  if (faltando.length) {
    const antes = linhas.length
    linhas = linhas.filter((l) => !l.processo_id || existem.has(l.processo_id))
    console.log(`                    ⚠ ${faltando.length} processo(s) ausente(s) no destino → ${antes - linhas.length} mensagem(ns) fora`)
    console.log(`                      (radar_processos não é copiada — ver o cabeçalho)`)
  }

  if (linhas.length && APLICAR) {
    const n = await emLotes(linhas, async (lote) => {
      const { sql, params } = insercao('radar_mensagens', cols, lote, 'ON CONFLICT (msg_hash) DO NOTHING')
      return (await destino.query(sql, params)).rowCount
    })
    console.log(`                    → ${n} inserida(s), ${linhas.length - n} já existia(m)`)
  }
}

// ── 3. radar_notificacoes ───────────────────────────────────────────────────
{
  console.log(`\nradar_notificacoes`)
  const cols = await colunasComuns('radar_notificacoes')
  // LEFT JOIN, não JOIN. `mensagem_id` é NULL no evento `nova_licitacao` (a seleção as
  // insere sem a coluna), e o JOIN interno as descartava ANTES do SELECT: não entravam
  // nem em "candidatas" nem no aviso de órfãs. Sumiam sem deixar rastro no relatório.
  const linhas = await q(origem, `
    SELECT n.*, m.msg_hash FROM radar_notificacoes n
      LEFT JOIN radar_mensagens m ON m.id = n.mensagem_id
     WHERE n.criado_em > $1 ORDER BY n.criado_em`, [DESDE])
  const semMensagem = linhas.filter((l) => l.mensagem_id == null).length
  console.log(`                    ${linhas.length} candidata(s) — ${semMensagem} sem mensagem (nova_licitacao), ${linhas.length - semMensagem} de mensagem`)

  // O mapa hash → id vem SEMPRE do destino, com os hashes destas notificações em mãos.
  // É isto que faz a retomada funcionar: não depende de o passo 2 ter rodado agora.
  const hashes = [...new Set(linhas.map((l) => l.msg_hash).filter(Boolean))]
  const mapaHashId = new Map()
  if (hashes.length) {
    for (const r of await q(destino,
      `SELECT id, msg_hash FROM radar_mensagens WHERE msg_hash = ANY($1::text[])`, [hashes])) {
      mapaHashId.set(r.msg_hash, r.id)
    }
  }

  const prontas = []
  let semDona = 0
  const foraDoPadrao = []
  for (const l of linhas) {
    // nova_licitacao: nada a remapear, o id dela não referencia mensagem.
    if (l.mensagem_id == null) { prontas.push(l); continue }

    const novoId = mapaHashId.get(l.msg_hash)
    if (!novoId) { semDona++; continue }

    // `String.replace` que não casa devolve a string INTACTA — um id fora do padrão
    // entrava com o id velho e o mensagem_id novo, que é exatamente a linha
    // consistente-só-por-fora que esta ferramenta diz evitar. E o `ON CONFLICT (id) DO
    // NOTHING` transformaria a colisão em silêncio. Melhor contar e não copiar.
    const m = /^nm:(\d+):(.+)$/.exec(String(l.id))
    if (!m) { foraDoPadrao.push(String(l.id)); continue }
    prontas.push({ ...l, mensagem_id: novoId, id: `nm:${novoId}:${m[2]}` })
  }
  if (semDona) console.log(`                    ⚠ ${semDona} sem a mensagem dona no destino → fora`)
  if (foraDoPadrao.length) {
    console.log(`                    ⚠ ${foraDoPadrao.length} com id fora do padrão nm:<n>: → fora (ex.: ${foraDoPadrao[0]})`)
  }
  console.log(`                    ${APLICAR ? '→' : '→ seria(m)'} ${prontas.length} copiada(s)`)
  if (prontas.length && APLICAR) {
    const n = await emLotes(prontas, async (lote) => {
      const { sql, params } = insercao('radar_notificacoes', cols, lote, 'ON CONFLICT (id) DO NOTHING')
      return (await destino.query(sql, params)).rowCount
    })
    console.log(`                    → ${n} inserida(s), ${prontas.length - n} já existia(m)`)
  }
}

// ── 4. auditoria e acessos — só com --incluir-logs ──────────────────────────
if (!INCLUIR_LOGS) {
  console.log(`\nradar_auditoria / acessos  — FORA (use --incluir-logs)`)
  console.log(`                    as duas são BIGSERIAL sem chave natural: ON CONFLICT não`)
  console.log(`                    dispara, então copiar NÃO é idempotente e rodar duas`)
  console.log(`                    vezes duplica.`)
} else {
  for (const [tabela, colTempo] of [['radar_auditoria', 'criado_em'], ['acessos', 'criado_em']]) {
    console.log(`\n${tabela}`)
    console.log(`                    ⚠ SEM chave natural — esta cópia NÃO é idempotente.`)
    const cols = await colunasComuns(tabela, ['id'])
    const linhas = await q(origem, `SELECT * FROM ${tabela} WHERE ${colTempo} > $1 ORDER BY ${colTempo}`, [DESDE])
    console.log(`                    ${linhas.length} candidata(s)`)
    if (linhas.length && APLICAR) {
      const n = await emLotes(linhas, async (lote) => {
        const { sql, params } = insercao(tabela, cols, lote, '')
        return (await destino.query(sql, params)).rowCount
      })
      console.log(`                    → ${n} inserida(s)`)
    }
  }
}

console.log(DRY ? '\n— dry: nada foi gravado. `npm run radar:delta:aplicar` para copiar —' : '\n— fim —')
await origem.end()
await destino.end()
