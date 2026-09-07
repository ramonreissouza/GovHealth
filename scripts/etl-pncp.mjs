// scripts/etl-pncp.mjs — ETL de resultados homologados do PNCP → Postgres (Neon).
//
// Fluxo: contratações de saúde → itens → resultados (vencedores).
// Endpoints confirmados ao vivo:
//   itens:      /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{seq}/itens
//   resultados: /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{seq}/itens/{numeroItem}/resultados
//
// Uso (piloto): node scripts/etl-pncp.mjs --uf=CE --meses=3 --modalidades=6,8 --max=80
// Idempotente (UPSERT): pode reexecutar sem duplicar.

import fs from 'node:fs'
import pg from 'pg'
import { isSaude, categoria } from './saude-filter.mjs'
import { CODIGO_CEDER, devoCeder } from './pncp-prioridade.mjs'
import { podeEnriquecer, registrarSucesso, registrarFalha, resumo as resumoBreaker } from './pncp-breaker.mjs'

// ── env ──────────────────────────────────────────────────────────────────────
function loadEnv() {
  if (process.env.DATABASE_URL) return
  try {
    const env = fs.readFileSync('.env.local', 'utf8')
    const m = env.match(/^DATABASE_URL=(.*)$/m)
    if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* noop */ }
}
loadEnv()
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

// ── args ─────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=')
  return [k, v ?? true]
}))
const UF_LIST = String(args.uf ?? 'CE').toUpperCase().split(',').map((s) => s.trim()).filter(Boolean)
let UF = UF_LIST[0] // UF corrente (usada na desnormalização); reatribuída por iteração
const MESES = Number(args.meses ?? 3)
const DIAS = args.dias ? Number(args.dias) : null // janela em dias (modo incremental); sobrepõe --meses
const MODALIDADES = String(args.modalidades ?? '6,8').split(',').map(Number)
const MAX_CONTRATACOES = Number(args.max ?? 80)
// Cap por UF: --maxuf=SP:1500,MG:1500 sobrepõe o --max para UFs específicas.
const MAX_UF = Object.fromEntries(String(args.maxuf ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  .map((p) => { const [u, n] = p.split(':'); return [u.toUpperCase(), Number(n)] }))
const maxDaUf = (uf) => MAX_UF[uf] ?? MAX_CONTRATACOES
const DELAY = Number(args.delay ?? 400)
// Quem é o dono da pista NO PAI. Sem isto, este script não tem lock para ceder e não
// tenta — é o caso de quem roda `node scripts/etl-pncp.mjs` direto, na mão.
const DONO = args.dono ? String(args.dono) : (process.env.PNCP_DONO || null)
// Range de datas EXPLÍCITO (YYYYMMDD) — usado no backfill fatiado por ano; o PNCP
// limita a janela a ~1 ano por consulta. Sobrepõe --dias/--meses quando presente.
const DATA_INI = args.dataInicial ? String(args.dataInicial).replace(/-/g, '') : null
const DATA_FIM = args.dataFinal ? String(args.dataFinal).replace(/-/g, '') : null
// Teto de páginas por UF/modalidade (paginação profunda). Configurável p/ varrer
// anos inteiros de estados grandes (ex.: SP/2024 tem ~1.400 páginas).
const MAXPAG = Number(args.maxpag ?? 400)
// Modo LEVE: grava só o cabeçalho da contratação (+ as 3 datas de proposta, que vêm
// na listagem) e PULA itens/resultados. 1 chamada por página de 50 → varredura muito
// mais leve, permitindo paralelizar UFs sem estourar o rate-limit do PNCP. O
// enriquecimento (itens/resultados) fica para um passe posterior sem a flag.
const SO_CABECALHO = args.soCabecalho === true || args.soCabecalho === '1' || process.env.ETL_SO_CABECALHO === '1'

const CONSULTA = 'https://pncp.gov.br/api/consulta/v1'
const PNCP = 'https://pncp.gov.br/api/pncp/v1'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const yyyymmdd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '')

const hoje = new Date()
let dataInicial, dataFinal
if (DATA_INI && DATA_FIM) {
  dataInicial = DATA_INI; dataFinal = DATA_FIM // range explícito (backfill por ano)
} else {
  const inicio = new Date(hoje)
  if (DIAS) inicio.setDate(hoje.getDate() - DIAS)
  else inicio.setMonth(hoje.getMonth() - MESES)
  dataInicial = yyyymmdd(inicio)
  dataFinal = yyyymmdd(hoje)
}

// Retorna o JSON, ou null SÓ quando o servidor responde 404 (recurso inexistente).
// Erros transitórios (rede, timeout, 429, 5xx) são retentados com backoff; se
// esgotarem as tentativas, lança — o chamador decide se aborta ou tolera.
async function fetchJson(url, tentativa = 0) {
  const MAX = 5
  try {
    // PNCP às vezes deixa a conexão pendurada sem responder; sem timeout o fetch
    // trava pra sempre e congela o ETL. AbortSignal.timeout aborta → vira retry.
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
    // 404 = inexistente; 204 = SEM conteúdo (página além do fim dos dados). Ambos → null:
    // o chamador trata null/[] como "fim", encerra a modalidade e segue — não é falha.
    if (res.status === 404 || res.status === 204) return null
    if ((res.status === 429 || res.status >= 500) && tentativa < MAX) {
      console.warn(`  [rate-limit] HTTP ${res.status} — retry ${tentativa + 1}/${MAX} em ${2 * (tentativa + 1)}s`)
      await sleep(2000 * (tentativa + 1)); return fetchJson(url, tentativa + 1)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    // Corpo vazio (ex.: 200 sem body) também é fim-de-dados, não erro de parse.
    const txt = await res.text()
    return txt ? JSON.parse(txt) : null
  } catch (e) {
    if (tentativa < MAX) { await sleep(2000 * (tentativa + 1)); return fetchJson(url, tentativa + 1) }
    throw new Error(`falha após ${MAX} tentativas em ${url}: ${e.message}`)
  }
}
// Variante tolerante: usada em chamadas onde um null transitório só perde 1 item.
async function fetchJsonSafe(url) { try { return await fetchJson(url) } catch { return null } }
// Variante do ENRIQUECIMENTO: igual à tolerante, mas relata o desfecho ao disjuntor.
// `fetchJson` devolve null SEM lançar em 404/204 — isso é serviço vivo e sem conteúdo,
// e conta como sucesso. Só o throw (as 5 tentativas esgotadas) é falha de verdade.
// Era exatamente essa distinção que se perdia quando "sem itens" e "serviço fora"
// voltavam os dois como null pelo mesmo caminho.
async function fetchJsonEnriq(url) {
  try { const j = await fetchJson(url); registrarSucesso(); return j }
  catch {
    if (registrarFalha()) {
      const { limite, esperaMin } = resumoBreaker()
      console.warn(`  [enriquecimento] ${limite} falhas seguidas em ${PNCP} — DESLIGANDO itens/resultados por ${esperaMin}min`)
      console.warn('  [enriquecimento] a coleta segue pela lista; o item entra depois pelo backfill-itens')
    }
    return null
  }
}
// Canário barato (1 tentativa, timeout curto): a página 1 daquela UF/modalidade
// responde? Serve para distinguir outage global do PNCP de página profunda quebrada.
async function pncpVivo(mod, uf) {
  try {
    const sp = new URLSearchParams({ dataInicial, dataFinal, codigoModalidadeContratacao: String(mod), uf, pagina: '1', tamanhoPagina: '10' })
    const res = await fetch(`${CONSULTA}/contratacoes/publicacao?${sp}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
    return res.ok
  } catch { return false }
}

// ── DB ───────────────────────────────────────────────────────────────────────
// Neon (serverless) derruba conexões ociosas; sem tratamento, o evento 'error'
// do pg.Client encerra o processo. Aqui o cliente é recriável e dbQuery reconecta
// sob demanda — assim um drop vira uma reconexão, não um crash + restart.
function novoDb() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  c.on('error', (e) => console.warn(`  [db] evento de erro de conexão: ${e.message} (reconecta sob demanda)`))
  return c
}
let db = novoDb()
await db.connect()

async function dbQuery(text, params, tent = 0) {
  try {
    return await db.query(text, params)
  } catch (e) {
    if (tent < 5) {
      console.warn(`  [db] query falhou (${e.message.slice(0, 50)}) — reconectando ${tent + 1}/5`)
      try { await db.end() } catch { /* noop */ }
      db = novoDb()
      try { await db.connect() } catch { /* tentará de novo no retry */ }
      await sleep(1500 * (tent + 1))
      return dbQuery(text, params, tent + 1)
    }
    throw e
  }
}

async function upsertContratacao(c) {
  // `linkSistemaOrigem` é a URL do PORTAL em que a sessão do pregão realmente roda
  // (Licitanet, BNC, BLL, Compras.gov, Licitações-e, portais municipais…). O PNCP é
  // só o agregador nacional. Guardamos em `link_externo` — coluna que já existia e
  // que as telas preferem à URL canônica do PNCP — para que "Acessar local da disputa"
  // leve ao portal certo e o selo do portal deixe de dizer Compras.gov para tudo.
  // O PNCP não manda esse campo em ~metade dos registros; nesses fica NULL e a
  // identificação cai no marcador "[PORTAL] - ..." do objeto (ver lib/portais.ts).
  const linkOrigem = (c.linkSistemaOrigem ?? '').trim() || null
  // `usuarioNome` é o SISTEMA que publicou (IPM, Betha, BLL, Licitanet…) e vem na
  // MESMA resposta de lista, em ~100% dos registros — contra ~44% do link. Só não
  // era gravado aqui, e por isso o harvest-portais.mjs precisava reler o passado
  // inteiro: em 13/08/2026 tínhamos link em 42,9% e nome do sistema em 0,6%.
  // Gravando na coleta, a fila do harvest para de crescer sozinha.
  const sistemaOrigem = (c.usuarioNome ?? '').trim() || null
  await dbQuery(
    `INSERT INTO contratacoes (numero_controle_pncp, cnpj_orgao, razao_social_orgao, municipio, uf,
       modalidade_nome, objeto_compra, ano_compra, sequencial_compra, valor_total_estimado,
       data_publicacao, data_abertura_proposta, data_encerramento_proposta, situacao_id, categoria_saude,
       link_externo, usuario_nome)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (numero_controle_pncp) DO UPDATE SET
       -- COALESCE pelo mesmo motivo do link_externo abaixo, e a lição custou caro:
       -- a listagem às vezes devolve valorTotalEstimado nulo para um registro que
       -- JÁ tem valor na base (recuperado pelo enriquecedor ou pelo backfill de
       -- valores). Sem o COALESCE, toda re-varredura de um período antigo desfaz
       -- esse trabalho em silêncio — foi o que 7.263 nulos custaram para virar 907.
       -- Valor novo e presente ainda ganha do antigo; só o nulo é que não apaga.
       valor_total_estimado = COALESCE(EXCLUDED.valor_total_estimado, contratacoes.valor_total_estimado),
       data_abertura_proposta = EXCLUDED.data_abertura_proposta,
       data_encerramento_proposta = EXCLUDED.data_encerramento_proposta,
       situacao_id = EXCLUDED.situacao_id,
       categoria_saude = EXCLUDED.categoria_saude,
       -- COALESCE: nunca apaga um link que já temos se a releitura vier sem ele.
       link_externo = COALESCE(EXCLUDED.link_externo, contratacoes.link_externo),
       usuario_nome = COALESCE(EXCLUDED.usuario_nome, contratacoes.usuario_nome)`,
    [c.numeroControlePNCP, c.orgaoEntidade?.cnpj ?? '', c.orgaoEntidade?.razaoSocial ?? null,
     c.unidadeOrgao?.municipioNome ?? null, c.unidadeOrgao?.ufSigla ?? UF, c.modalidadeNome ?? null,
     c.objetoCompra ?? null, c.anoCompra ?? null, c.sequencialCompra ?? null, c.valorTotalEstimado ?? null,
     (c.dataPublicacaoPncp ?? '').slice(0, 10) || null,
     (c.dataAberturaProposta ?? '').slice(0, 10) || null,
     (c.dataEncerramentoProposta ?? '').slice(0, 10) || null,
     c.situacaoCompraId ?? null, categoria(c.objetoCompra), linkOrigem, sistemaOrigem],
  )
}

async function upsertItem(numeroControle, it) {
  await dbQuery(
    `INSERT INTO itens (numero_controle_pncp, numero_item, descricao, codigo_catmat, nome_catmat,
       quantidade, valor_unitario_estimado, situacao_item_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (numero_controle_pncp, numero_item) DO UPDATE SET
       situacao_item_id = EXCLUDED.situacao_item_id`,
    [numeroControle, it.numeroItem, it.descricao ?? null, it.catalogoCodigoItem ?? null,
     it.descricao ?? null, it.quantidade ?? null, it.valorUnitarioEstimado ?? null, it.situacaoCompraItem ?? null],
  )
}

async function upsertResultado(c, it, r) {
  if (!r.niFornecedor) return
  await dbQuery(
    `INSERT INTO resultados (numero_controle_pncp, numero_item, ni_fornecedor, nome_fornecedor,
       quantidade_homologada, valor_unitario_homologado, valor_total_homologado, data_resultado,
       ordem_classificacao_srp, porte_fornecedor, uf, codigo_catmat, nome_catmat, ano)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (numero_controle_pncp, numero_item, ni_fornecedor) DO UPDATE SET
       valor_total_homologado = EXCLUDED.valor_total_homologado,
       nome_fornecedor = EXCLUDED.nome_fornecedor`,
    [c.numeroControlePNCP, it.numeroItem, r.niFornecedor, r.nomeRazaoSocialFornecedor ?? null,
     r.quantidadeHomologada ?? null, r.valorUnitarioHomologado ?? null, r.valorTotalHomologado ?? null,
     (r.dataResultado ?? r.dataInclusao ?? '').slice(0, 10) || null, r.ordemClassificacaoSrp ?? null,
     r.porteFornecedorNome ?? null, c.unidadeOrgao?.ufSigla ?? UF, it.catalogoCodigoItem ?? null,
     it.descricao ?? null, c.anoCompra ?? null],
  )
}

// ── checkpoint / resumo ──────────────────────────────────────────────────────
async function jaProcessada(num) {
  const r = await dbQuery('SELECT 1 FROM itens WHERE numero_controle_pncp = $1 LIMIT 1', [num])
  return r.rowCount > 0
}
async function lerCheckpoint(chave) {
  const r = await dbQuery('SELECT ultima_pagina FROM etl_checkpoint WHERE chave = $1', [chave])
  return r.rows[0]?.ultima_pagina ?? 0
}
async function salvarCheckpoint(chave, pagina) {
  await dbQuery(`INSERT INTO etl_checkpoint (chave, ultima_pagina) VALUES ($1,$2)
    ON CONFLICT (chave) DO UPDATE SET ultima_pagina = EXCLUDED.ultima_pagina, atualizado_em = now()`, [chave, pagina])
}

// ── páginas abandonadas ─────────────────────────────────────────────────────
// Quando o ETL desiste de uma página, o checkpoint avança por cima dela. Sem estas
// três funções a página some para sempre e ninguém fica sabendo — medido em 05-06/09/2026,
// uma página perdida em CADA um dos dois mutirões (20 contratações), achadas só porque
// alguém leu o stderr e caçou o buraco na sequência de páginas à mão.
//
// NÃO avançar o checkpoint seria pior: uma página permanentemente quebrada travaria toda
// execução futura nela. Com a lista, o checkpoint avança (progresso durável) e a página
// fica anotada para a próxima passada por aquela UF/modalidade revisitar.
// Requer `npm run checkpoint:migrate`.
const TETO_PENDENTES = 100
async function lerPuladas(chave) {
  const r = await dbQuery('SELECT paginas_puladas FROM etl_checkpoint WHERE chave = $1', [chave])
  return r.rows[0]?.paginas_puladas ?? []
}
async function marcarPulada(chave, pagina) {
  // O teto existe para o caso patológico (paginação profunda inteira morta): a lista
  // pararia de crescer em vez de virar uma fila de milhares que nunca esvazia.
  await dbQuery(`INSERT INTO etl_checkpoint (chave, ultima_pagina, paginas_puladas)
    VALUES ($1, $2, ARRAY[$2::int])
    ON CONFLICT (chave) DO UPDATE SET
      paginas_puladas = CASE
        WHEN cardinality(etl_checkpoint.paginas_puladas) >= ${TETO_PENDENTES}
          THEN etl_checkpoint.paginas_puladas
        ELSE (SELECT array_agg(DISTINCT p ORDER BY p)
                FROM unnest(etl_checkpoint.paginas_puladas || ARRAY[$2::int]) p)
      END`, [chave, pagina])
}
async function limparPulada(chave, pagina) {
  await dbQuery('UPDATE etl_checkpoint SET paginas_puladas = array_remove(paginas_puladas, $2::int) WHERE chave = $1',
    [chave, pagina])
}

// ── pipeline ─────────────────────────────────────────────────────────────────
let totC = 0, totI = 0, totR = 0, totSkip = 0
// Página perdida não pode depender de alguém ler o stderr: estes três viram uma linha
// no resumo final, no stdout, junto com o resto.
let totPuladas = 0, totRecuperadas = 0, totPend = 0
console.log(`[ETL] UFs=${UF_LIST.join(',')} janela=${dataInicial}→${dataFinal} modalidades=${MODALIDADES} max/UF=${MAX_CONTRATACOES} delay=${DELAY}ms`)

for (const ufAtual of UF_LIST) {
  UF = ufAtual
  // Cap PERSISTENTE: já contabiliza o que existe no banco p/ esta UF, então a
  // amostra de MAX_CONTRATACOES é por UF "no total" e sobrevive a restarts —
  // uma UF já saturada é pulada na hora em vez de reabrir o orçamento.
  const capUF = maxDaUf(UF)
  const jaNoBanco = await dbQuery('SELECT count(*)::int n FROM contratacoes WHERE uf = $1', [UF])
  let nContrat = jaNoBanco.rows[0].n
  if (nContrat >= capUF) { console.log(`\n── UF ${UF} ── já saturada (${nContrat} ≥ ${capUF}) — pulando`); continue }
  console.log(`\n── UF ${UF} ── (${nContrat} já no banco · alvo ${capUF})`)

  for (const mod of MODALIDADES) {
    // Checkpoint isolado por JANELA para não herdar paginação de outra profundidade:
    //  - incremental (--dias): chave por data inicial (uf:UF:mod:M:dYYYYMMDD)
    //  - histórico (--meses): chave por profundidade em meses (uf:UF:mod:M:mNN),
    //    estável entre dias (o dataInicial só desliza 1 dia/dia — irrelevante no
    //    backfill; UPSERT/jaProcessada cobrem a sobreposição).
    const chave = (DATA_INI && DATA_FIM) ? `uf:${UF}:mod:${mod}:r${dataInicial}_${dataFinal}`
      : DIAS ? `uf:${UF}:mod:${mod}:d${dataInicial}` : `uf:${UF}:mod:${mod}:m${MESES}`
    let sequencial = (await lerCheckpoint(chave)) + 1
    if (sequencial > 1) console.log(`  retomando ${UF}/mod${mod} da página ${sequencial}`)

    // Primeiro as páginas que ficaram para trás numa execução anterior, depois a
    // sequência normal. As duas usam o MESMO corpo de laço — o que muda é que revisita
    // não mexe no checkpoint nem testa fim de sequência (a página 14 de 47 voltando
    // com menos de 50 registros não significa que a modalidade acabou).
    const pendentes = await lerPuladas(chave)
    if (pendentes.length) {
      console.log(`  ${UF}/mod${mod}: ${pendentes.length} página(s) pendente(s) de antes `
        + `(${pendentes.join(', ')}) — revisitando antes de seguir`)
      totPend += pendentes.length
    }
    let revisita = pendentes.length > 0
    let pagina = revisita ? pendentes[0] : sequencial
    // Sai da revisita para a sequência. Falha em revisita NÃO remove da lista: a página
    // continua pendente e volta a ser tentada na próxima rodada.
    const proximaRevisita = () => {
      pendentes.shift()
      revisita = pendentes.length > 0
      pagina = revisita ? pendentes[0] : sequencial
    }

    let falhasSeguidas = 0
    for (;;) {
      if (!revisita && pagina > MAXPAG) break
      const sp = new URLSearchParams({ dataInicial, dataFinal, codigoModalidadeContratacao: String(mod), uf: UF, pagina: String(pagina), tamanhoPagina: '50' })
      let resp
      try {
        resp = await fetchJson(`${CONSULTA}/contratacoes/publicacao?${sp}`)
        falhasSeguidas = 0
      } catch (e) {
        // Dois cenários ao falhar uma página de listagem:
        //  (a) OUTAGE global do PNCP (até a página 1 falha): esperar e repetir a
        //      MESMA página, sem avançar o checkpoint — não perde dados e retoma
        //      a coleta quando o PNCP voltar (essencial p/ rodar overnight).
        //  (b) Paginação profunda quebrada (pág 1 responde, mas a atual não):
        //      pular a página; após 3 seguidas, circuit breaker → próxima
        //      modalidade/UF, para não gastar horas em páginas mortas.
        if (!(await pncpVivo(mod, UF))) {
          console.warn(`  [outage] PNCP indisponível (pág 1 também falha) — aguardando 60s e repetindo ${UF}/mod${mod} pág ${pagina}`)
          await sleep(60000)
          // NÃO mexer em `pagina`: o laço não incrementa mais no cabeçalho, então
          // continuar já repete a MESMA página. (Antes era `pagina--` para compensar o
          // `pagina++` do `for`; mantido assim, andaria para TRÁS a cada queda do PNCP.)
          // Checkpoint NÃO avança: queda global não é página perdida, é espera.
          falhasSeguidas = 0
          continue
        }
        // Revisita que falha de novo continua pendente e não conta para o disjuntor:
        // são páginas velhas e já problemáticas, e deixá-las derrubar a modalidade
        // impediria o trabalho NOVO de acontecer. O número de tentativas por rodada já
        // é limitado pelo tamanho da lista.
        if (revisita) {
          console.warn(`  [skip] ${UF}/mod${mod} pág ${pagina} (revisita) falhou de novo — segue pendente`)
          proximaRevisita()
          continue
        }
        falhasSeguidas++
        console.warn(`  [skip] ${UF}/mod${mod} pág ${pagina} falhou (${falhasSeguidas}x seguidas) — ${e.message.slice(0, 40)}`)
        // A ORDEM IMPORTA: anota a página ANTES de avançar o checkpoint por cima dela.
        // Se o processo morrer entre as duas, a página fica anotada e será revisitada —
        // o inverso perderia a página exatamente como antes deste conserto.
        await marcarPulada(chave, pagina)
        totPuladas++
        await salvarCheckpoint(chave, pagina)
        pagina++
        if (falhasSeguidas >= 3) { console.warn(`  [circuit-breaker] ${UF}/mod${mod}: ${falhasSeguidas} páginas seguidas falhando (pág 1 ok) — paginação profunda degradada; encerrando modalidade`); break }
        continue
      }
      if (!resp || (resp.data ?? []).length === 0) {
        // Página pendente que hoje vem vazia não tem o que recuperar (a janela encolheu,
        // ou o PNCP repaginou). Tira da lista para não virar pendência eterna.
        if (revisita) { await limparPulada(chave, pagina); proximaRevisita(); continue }
        break
      }
      const lista = resp.data.filter((c) => isSaude(c.objetoCompra))

      let hitMax = false
      for (const c of lista) {
        if (nContrat >= capUF) { hitMax = true; break }
        await upsertContratacao(c); totC++

        // Modo leve: cabeçalho + datas já gravados no upsert acima; pula enriquecimento.
        if (SO_CABECALHO) continue

        // Resumo barato: se a contratação já tem itens no banco, pula chamadas caras.
        // Não conta no cap (nContrat) — assim a retomada avança para as novas.
        if (await jaProcessada(c.numeroControlePNCP)) { totSkip++; continue }
        nContrat++ // só conta contratações efetivamente processadas nesta rodada

        // Disjuntor: com a API de itens fora, CADA chamada custa 30s de espera e são
        // 50 por página. Enquanto ele estiver aberto, a contratação entra só com o
        // cabeçalho — que o upsert acima já gravou — e o item vem depois.
        let itensResp = null
        if (podeEnriquecer()) {
          itensResp = await fetchJsonEnriq(`${PNCP}/orgaos/${c.orgaoEntidade?.cnpj}/compras/${c.anoCompra}/${c.sequencialCompra}/itens?pagina=1&tamanhoPagina=100`)
          await sleep(DELAY)
        }
        const itens = Array.isArray(itensResp) ? itensResp : (itensResp?.data ?? [])
        for (const it of itens) {
          await upsertItem(c.numeroControlePNCP, it); totI++
          if (it.temResultado || it.situacaoCompraItem === 2) {
            if (!podeEnriquecer()) continue
            const resArr = await fetchJsonEnriq(`${PNCP}/orgaos/${c.orgaoEntidade?.cnpj}/compras/${c.anoCompra}/${c.sequencialCompra}/itens/${it.numeroItem}/resultados?pagina=1&tamanhoPagina=20`)
            await sleep(DELAY)
            for (const r of (Array.isArray(resArr) ? resArr : (resArr?.data ?? []))) { await upsertResultado(c, it, r); totR++ }
          }
        }
      }

      if (hitMax) { console.log(`  max/UF (${capUF}) atingido em ${UF}`); break }

      // REVISITA: a página foi recuperada. Não toca no checkpoint (ele já está à frente
      // desta página) e não testa fim de sequência — quem termina a modalidade é a
      // sequência normal, que ainda nem começou.
      if (revisita) {
        await limparPulada(chave, pagina)
        totRecuperadas++
        console.log(`  ${UF}/mod${mod} pág ${pagina} RECUPERADA: +${lista.length} saúde — acum ${totC}c/${totI}i/${totR}r`)
        proximaRevisita()
        // Também aqui: a lista pendente vive no BANCO, e a página que acabou de entrar
        // já saiu dela. Sair agora não perde nem repete — sem este teste, uma lista de
        // até 100 páginas pendentes seguraria a pista inteira sem ceder.
        if (DONO && devoCeder(DONO)) {
          console.log(`  cedendo a pista a pedido — revisita de ${UF}/mod${mod}; o pai retoma daqui`)
          try { await db.end() } catch { /* fechar é cortesia; o processo vai sair de todo jeito */ }
          process.exit(CODIGO_CEDER)
        }
        continue
      }

      await salvarCheckpoint(chave, pagina) // página inteira concluída → checkpoint
      console.log(`  ${UF}/mod${mod} pág ${pagina}: +${lista.length} saúde — acum ${totC}c/${totI}i/${totR}r (skip ${totSkip})`)

      // CEDER A PISTA — só quando um pai me disse quem ele é (`--dono=`). Rodando
      // sozinho, este script não tem lock nenhum para ceder e o teste é ignorado.
      // O lugar é este e não outro: o checkpoint da linha acima ACABOU de gravar, então
      // sair aqui não perde nem repete página. Sair antes dela repetiria a página.
      if (DONO && devoCeder(DONO)) {
        console.log(`  cedendo a pista a pedido — checkpoint em ${UF}/mod${mod} pág ${pagina}; o pai retoma daqui`)
        try { await db.end() } catch { /* fechar é cortesia; o processo vai sair de todo jeito */ }
        process.exit(CODIGO_CEDER)
      }
      if (resp.data.length < 50 || pagina >= (resp.totalPaginas ?? 1)) break
      pagina++
    }
    if (nContrat >= capUF) break
  }
  console.log(`  ✓ ${UF}: ${nContrat} contratações nesta rodada`)
}

console.log(`\n[ETL] concluído: ${totC} contratações · ${totI} itens · ${totR} resultados · ${totSkip} já processadas (puladas)`)
if (totRecuperadas) console.log(`[ETL] ${totRecuperadas} página(s) pendente(s) RECUPERADA(S) nesta rodada`)
if (totPuladas) console.log(`[ETL] ${totPuladas} página(s) abandonada(s) e anotada(s) — a próxima rodada revisita`)
// No STDOUT de propósito: enriquecimento desligado é perda silenciosa por natureza —
// a rodada termina "com sucesso", cheia de contratações e sem um item. Quem lê só o
// stdout tem que ver isso sem precisar caçar no stderr.
const brk = resumoBreaker()
if (brk.desligamentos) {
  console.log(`[ETL] enriquecimento DESLIGADO ${brk.desligamentos}x (${brk.limite} falhas seguidas) — ${brk.puladas} chamada(s) de item/resultado puladas`)
  console.log(`[ETL] ${brk.religamentos} religamento(s); ao fim da rodada estava ${brk.aberto ? 'DESLIGADO' : 'ligado'}`)
  console.log('[ETL] as contratações entraram; os itens ficam para o backfill-itens (npm run backfill:itens)')
}
const aindaPend = totPend - totRecuperadas + totPuladas
if (aindaPend > 0) {
  console.log(`[ETL] ${aindaPend} página(s) seguem pendentes. Para ver quais:`)
  console.log(`      SELECT chave, paginas_puladas FROM etl_checkpoint WHERE cardinality(paginas_puladas) > 0;`)
}
await db.end()
