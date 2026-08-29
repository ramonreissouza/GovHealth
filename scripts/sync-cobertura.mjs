// scripts/sync-cobertura.mjs — GARANTE QUE CADA DIA FOI COLETADO, e recoleta o que faltou.
//
// POR QUE ISSO EXISTE (medido em 28/08/2026, não estimado).
//
// A base tinha 38,6h sem uma linha nova. Investigando, os dois alimentadores têm
// buracos que se somam justamente nos dias em que ninguém olha:
//
//   1) O CRON DA VERCEL roda 1x/dia (conta Hobby) e tem TETO ESTRUTURAL. Ele varre
//      `maxPaginasPorModalidade: 5` × 4 modalidades × 50 por página = 1.000 registros
//      brutos, dos quais ~12% são saúde → ~120 contratações/dia. E o PNCP publica de
//      750 a 880/dia. Os números do banco batem com a conta com uma fidelidade
//      constrangedora: 106, 124, 127, 109 novas por dia. Não é azar, é o teto.
//
//   2) O REFRESH LOCAL (etl-refresh-loop) é quem traz o volume de verdade, mas roda
//      a cada 3 dias e pode segurar a pista do PNCP por até 16h30. Nos dias entre
//      dois refreshes, o cron é o único alimentador — e ele cobre ~15%.
//
//   3) O PNCP tem JANELAS RUINS DE HORAS. Um tiro por dia às 00:33 que cai numa
//      janela ruim custa o dia inteiro, e nada reage. Foi o que aconteceu em 28/08:
//      o cron rodou (o carimbo em etl_checkpoint prova), trouxe 0, e pronto.
//
// A RESPOSTA NÃO É INSISTIR MAIS FORTE NA MESMA HORA. Janela ruim dura horas; retry
// dentro da mesma execução não vence isso. A resposta é PERGUNTAR AO BANCO quais dias
// ficaram para trás e ir buscar SÓ ESSES, várias vezes ao dia em horários espalhados —
// assim basta UM dos tiros pegar janela boa para o dia ser salvo.
//
// É deliberadamente LEVE (só cabeçalho, um dia por vez) para poder rodar 3x/dia sem
// virar o novo monopolizador da pista — o refresh pesado já ocupa esse papel e foi
// ele que matou o backfill de itens hoje.
//
// COMO DECIDE O QUE É BURACO. Compara cada dia com a MEDIANA dos dias do mesmo tipo
// (útil com útil, fim de semana com fim de semana). Mediana e não média porque um
// único dia zerado já puxaria a média para baixo e esconderia os outros. Dia útil e
// fim de semana separados porque sábado publica uma fração de uma terça — sem
// separar, todo fim de semana viraria falso buraco e todo dia útil ruim passaria.
// Os dois dias mais recentes entram SEMPRE, buraco ou não: são os que o usuário abre.
//
// A JANELA DA REFERÊNCIA É OUTRA, E MAIOR QUE A DO CONSERTO — e isso não é detalhe.
// A primeira versão media a referência na mesma janela de 10 dias que ia consertar.
// Rodei, e ela se auto-sabotou: com 5 dos 10 dias quebrados, a mediana de dia útil
// deu 56 contratações (o normal é ~800), e aí 25/08 com 127 e 24/08 com 109 —
// exatamente os dias em que só o cron alimentou — passaram como saudáveis. Uma régua
// feita do próprio estrago mede o estrago como se fosse o normal. A referência sai de
// REF_DIAS (45 por padrão), onde os dias sãos ainda são maioria.
//
// A RÉGUA NÃO ENXERGA DIA INTERROMPIDO PELA METADE — por isso existe a MARCA.
// Medido em 29/08/2026: uma execução foi morta no meio de 26/08, na 4ª de 27 UFs. O
// dia ficou com 436 contra referência 838, e o corte de 50% (419) o deixou passar
// como saudável — por 17 registros. Nenhuma régua estatística resolve isso, porque o
// dia REALMENTE parece plausível; quem sabe que ele está pela metade é quem o
// interrompeu. Então o script agora ANOTA, e a anotação entra na decisão junto com a
// referência: um dia marcado é recolhido mesmo estando acima do limiar.
//
// A marca é escrita ANTES de começar o dia e apagada DEPOIS que ele termina limpo —
// nunca o contrário. Marcar só na saída seria confiar num handler que justamente não
// roda nos casos que importam: SIGKILL, ExecutionTimeLimit do Task Scheduler, reboot.
// É a mesma lição que o pncp-lock.mjs já pagou para aprender ("lock que depende de
// faxina na saída é lock que um dia fica órfão"). Sendo assim, o pior caso é uma
// marca sobrando num dia que na verdade fechou — e o preço disso é uma recoleta a
// mais, que os checkpoints de página do etl-pncp tornam barata: em 29/08 a retomada
// de 26/08 custou 6min em vez do dia inteiro, porque só buscou o que faltava.
//
// Uso:
//   npm run sync:cobertura                    (relata e recoleta os buracos)
//   npm run sync:cobertura -- --ensaio        (só relata — não toca no PNCP nem no banco)
//   npm run sync:cobertura -- --dias=15 --limiar=0.6
//   npm run sync:cobertura -- --forcar=2026-08-27,2026-08-25
//
// Pensado para o Task Scheduler, 3x/dia em horários espalhados.

import fs from 'node:fs'
import pg from 'pg'
import { spawn } from 'node:child_process'
import { pegar, soltar, soltarNaSaida, estado } from './pncp-lock.mjs'

if (!process.env.DATABASE_URL) {
  try {
    const m = fs.readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m)
    if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* sem .env.local */ }
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const arg = (n, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${n}=`))
  return m ? m.slice(n.length + 3) : d
}
const DIAS = Number(arg('dias', '10'))
const REF_DIAS = Math.max(Number(arg('referencia-dias', '45')), DIAS)
const LIMIAR = Number(arg('limiar', '0.5'))
const PISO_REF = Number(arg('piso-ref', '20'))
const ORCAMENTO_MIN = Number(arg('orcamento', '50'))
const POR_DIA_MIN = Number(arg('por-dia', '20'))
const ESPERA_MAX_MIN = Number(arg('espera-max', '15'))
const MODALIDADES = arg('modalidades', '6,8')
const UF = arg('uf', 'SP,RJ,MG,RS,PR,BA,SC,GO,PE,CE,DF,ES,PA,MT,MS,AM,MA,RN,PB,PI,AL,SE,RO,TO,AC,AP,RR')
const DELAY = arg('delay', '400')
const FORCAR = String(arg('forcar', '')).split(',').map((s) => s.trim()).filter(Boolean)
const ENSAIO = process.argv.includes('--ensaio')
const SEM_LOCK = process.argv.includes('--sem-lock')

const FIM = Date.now() + ORCAMENTO_MIN * 60 * 1000
const restaMs = () => FIM - Date.now()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (m) => console.log(`[cobertura] ${m}`)
const ts = () => new Date().toLocaleString('pt-BR')

// ── DB ───────────────────────────────────────────────────────────────────────
// O listener de 'error' sozinho NÃO basta, e isso custou uma execução para aprender.
// Ele impede que o reset do PgBouncer derrube o processo — a doença silenciosa
// recorrente deste repositório — mas NÃO devolve o cliente ao estado utilizável: a
// próxima query morre com "Client has encountered a connection error and is not
// queryable". E este script segura a mesma conexão por até ORCAMENTO_MIN inteiros,
// quase todos ociosos enquanto o etl-pncp filho trabalha, que é exatamente o perfil
// que o PgBouncer recicla. Medido em 29/08/2026: a conexão morreu durante a coleta e
// o processo caiu no `limparInacabado` DEPOIS de ter coletado o dia inteiro — o pior
// lugar possível, porque o trabalho foi feito e a marca ficou dizendo que não.
//
// A resposta é a mesma do etl-pncp.mjs: cliente RECRIÁVEL e query que reconecta sob
// demanda. Um drop vira reconexão, não um crash.
function novoDb() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  c.on('error', (e) => console.warn(`[cobertura] evento de conexão: ${e.message} (reconecta sob demanda)`))
  return c
}
let client = novoDb()
await client.connect()

async function dbQuery(text, params, tent = 0) {
  try {
    return await client.query(text, params)
  } catch (e) {
    if (tent < 5) {
      console.warn(`[cobertura] query falhou (${e.message.slice(0, 50)}) — reconectando ${tent + 1}/5`)
      try { await client.end() } catch { /* noop */ }
      client = novoDb()
      try { await client.connect() } catch { /* tentará de novo no retry */ }
      await sleep(1500 * (tent + 1))
      return dbQuery(text, params, tent + 1)
    }
    throw e
  }
}

// ── 1. quanto cada dia tem hoje ──────────────────────────────────────────────
/** Contagem por dia de PUBLICAÇÃO na janela, com os dias ausentes preenchidos com 0
 *  (um dia que não existe na tabela é o buraco mais grave, e um GROUP BY sozinho o
 *  esconderia por omissão).
 *
 *  TODA a aritmética de data mora no SQL, ancorada em America/Sao_Paulo, e o dia sai
 *  como TEXTO. A primeira versão montava os dias em JavaScript e casava com
 *  `linha.dia.toISOString()`, o que parece inofensivo e não é: o driver devolve um
 *  DATE do Postgres como meia-noite LOCAL, e `toISOString()` reconverte para UTC —
 *  nesta máquina (UTC+2) isso joga a contagem inteira para o dia ANTERIOR. O sintoma
 *  foi um domingo com 764 contratações num banco onde a mediana de domingo é 7. Com o
 *  dia vindo pronto do banco, não há fuso para errar. */
async function cobertura(janela = DIAS) {
  const { rows } = await dbQuery(
    `WITH hoje AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date d),
          dias AS (SELECT gs::date dia
                     FROM hoje, generate_series(hoje.d - ($1::int - 1), hoje.d, '1 day') gs)
     SELECT to_char(dias.dia, 'YYYY-MM-DD') iso,
            extract(dow FROM dias.dia)::int dow,
            (hoje.d - dias.dia)::int idade,
            count(c.numero_controle_pncp)::int n
       FROM dias CROSS JOIN hoje
            LEFT JOIN contratacoes c ON c.data_publicacao = dias.dia
      GROUP BY 1, 2, 3
      ORDER BY 3`, [janela])
  return rows.map((r) => ({ iso: r.iso, n: r.n, idade: r.idade, fds: r.dow === 0 || r.dow === 6 }))
}

// ── 1b. a marca de dia inacabado ─────────────────────────────────────────────
// Mora em etl_checkpoint para não pedir migração: a tabela já é o caderno de estado
// do ETL, a chave é texto livre e a semântica bate ("por onde eu ia"). A EXISTÊNCIA
// da linha é a marca; `ultima_pagina` guarda quantas contratações o dia tinha quando
// a tentativa começou, que é o que se quer saber depois ("parou em 436").
const MARCA = (iso) => `cobertura:inacabado:${iso}`

async function marcarInacabado(iso, tinha) {
  await dbQuery(
    `INSERT INTO etl_checkpoint (chave, ultima_pagina) VALUES ($1, $2)
     ON CONFLICT (chave) DO UPDATE SET ultima_pagina = EXCLUDED.ultima_pagina, atualizado_em = now()`,
    [MARCA(iso), tinha])
}

async function limparInacabado(iso) {
  await dbQuery('DELETE FROM etl_checkpoint WHERE chave = $1', [MARCA(iso)])
}

/** A marca é ESCRITURAÇÃO, não o trabalho. Ela existe para a PRÓXIMA execução decidir
 *  melhor; deixar uma falha de escrituração derrubar a coleta inverteria a prioridade —
 *  e foi assim que a rodada de 29/08 morreu depois de já ter coletado o dia inteiro.
 *  Falhar aqui degrada para o comportamento antigo (a régua decide sozinha), que é
 *  ruim e conhecido, em vez de perder a coleta, que é pior. */
async function tentar(oQue, fn) {
  try { return await fn() } catch (e) { log(`aviso: ${oQue} falhou (${e.message.slice(0, 60)}) — sigo sem`) }
}

/** Data ISO de verdade, não só com cara de uma. `2026-13-99` casa com qualquer regex
 *  de formato e mesmo assim estoura num `::date` — validar forma não é validar data. */
const isoValido = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))

async function lerInacabados() {
  const { rows } = await dbQuery(
    `SELECT replace(chave, 'cobertura:inacabado:', '') iso, ultima_pagina tinha
       FROM etl_checkpoint WHERE chave LIKE 'cobertura:inacabado:%'`)
  return new Map(rows.filter((r) => isoValido(r.iso)).map((r) => [r.iso, r.tinha]))
}

/** Marca de dia que já saiu da janela nunca mais será olhada — vira lixo permanente
 *  na tabela. Poda pela janela da REFERÊNCIA (não a do conserto), que é a maior.
 *
 *  O RECORTE É FEITO EM JS, de propósito. Um `::date` em cima da chave derrubaria a
 *  RODADA INTEIRA por causa de uma linha de lixo — perder a coleta do dia para limpar
 *  a casa seria o pior negócio possível, e nem CASE resolve, porque uma chave pode ter
 *  forma de data e ainda assim não ser data. Aqui nada é convertido: o banco só diz
 *  qual é o corte (ancorado em São Paulo, como todo o resto), a comparação é entre
 *  textos ISO — que ordenam certo — e chave inválida cai fora por não ser data. */
async function podarInacabados() {
  const { rows } = await dbQuery(
    `SELECT chave, replace(chave, 'cobertura:inacabado:', '') iso,
            to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int, 'YYYY-MM-DD') limite
       FROM etl_checkpoint WHERE chave LIKE 'cobertura:inacabado:%'`, [REF_DIAS])
  const mortas = rows.filter((r) => !isoValido(r.iso) || r.iso < r.limite).map((r) => r.chave)
  if (!mortas.length) return
  await dbQuery('DELETE FROM etl_checkpoint WHERE chave = ANY($1)', [mortas])
  log(`${mortas.length} marca(s) de dia inacabado fora da janela ou malformada(s) — podadas`)
}

const mediana = (xs) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

function buracos(dias, referencia, inacabados) {
  // O dia de HOJE fica fora da régua: ele ainda está sendo publicado e entraria como
  // um zero permanente, puxando a mediana para baixo todo dia.
  const base = referencia.filter((d) => d.idade > 0)
  const refUtil = mediana(base.filter((d) => !d.fds).map((d) => d.n))
  const refFds = mediana(base.filter((d) => d.fds).map((d) => d.n))
  for (const d of dias) {
    d.ref = d.fds ? refFds : refUtil
    // Percentual em cima de número pequeno não quer dizer nada: um sábado com 3
    // contra referência 8 dispara "buraco de 62%" para uma diferença de 5 registros,
    // e pagaria uma varredura nacional de 20min por eles. Abaixo do piso só o zero
    // absoluto conta como buraco.
    const faltando = d.ref < PISO_REF ? d.n === 0 : d.n < LIMIAR * d.ref
    // A marca vence o limiar. Um dia que sabidamente ficou pela metade não precisa
    // convencer a régua: quem o interrompeu já sabe, e a régua nunca vai saber.
    d.inacabado = inacabados.has(d.iso)
    // Os dois mais novos entram sempre: são os que a tela mostra primeiro e o dia de
    // hoje, por definição, ainda está sendo publicado — nunca vai parecer completo.
    d.recolher = d.idade <= 1 || faltando || d.inacabado
    d.motivo = d.idade <= 1 ? 'recente'
      : faltando ? `${d.n} vs ref ${d.ref}`
      : d.inacabado ? `inacabado (parou em ${inacabados.get(d.iso) ?? '?'})`
      : null
  }
  return { refUtil, refFds }
}

const referencia = await cobertura(REF_DIAS)
const dias = referencia.slice(0, DIAS)
const inacabados = await lerInacabados()
const { refUtil, refFds } = buracos(dias, referencia, inacabados)

console.log(`\n[cobertura] ${ts()} — conserta ${DIAS}d · régua de ${REF_DIAS}d:`
  + ` dia útil ${refUtil}, fim de semana ${refFds}`)
console.table(dias.map((d) => ({
  dia: d.iso,
  tipo: d.fds ? 'fim de semana' : 'útil',
  contratações: d.n,
  referência: d.ref,
  recolher: !d.recolher ? '—'
    : d.motivo === 'recente' ? 'sim (recente)'
    : d.inacabado ? 'SIM — inacabado'
    : 'SIM — buraco',
})))

const alvo = FORCAR.length
  ? dias.filter((d) => FORCAR.includes(d.iso))
  : dias.filter((d) => d.recolher)

if (FORCAR.length && alvo.length !== FORCAR.length) {
  const faltando = FORCAR.filter((f) => !alvo.some((d) => d.iso === f))
  log(`aviso: ${faltando.join(', ')} está fora da janela de ${DIAS} dias — ignorado(s)`)
}

// Poda ANTES das saídas antecipadas. Uma marca fora da janela não vira alvo, então se
// a poda ficasse depois do `!alvo.length` ela nunca rodaria justamente nas rodadas em
// que não há o que fazer — que são as únicas em que sobra tempo para arrumar a casa.
if (!ENSAIO) await tentar('podar marcas', () => podarInacabados())

if (!alvo.length) {
  log('nenhum dia para recolher — cobertura está em dia.')
  await client.end(); process.exit(0)
}
log(`${alvo.length} dia(s) para recolher: ${alvo.map((d) => `${d.iso} (${d.motivo})`).join(' · ')}`)

if (ENSAIO) {
  log('ENSAIO — nada foi coletado.')
  await client.end(); process.exit(0)
}

// ── 2. a pista ───────────────────────────────────────────────────────────────
/** Mesma etiqueta dos outros consumidores pesados: espera educadamente e DESISTE em
 *  vez de atropelar. Desistir é barato aqui — a próxima execução (em horas) refaz a
 *  mesma pergunta ao banco e reencontra o mesmo buraco. A fila é a consulta. */
async function esperarPista() {
  if (SEM_LOCK) return true
  const inicio = Date.now()
  let n = 0
  while (estado().ocupado) {
    const e = estado()
    if (ESPERA_MAX_MIN && (Date.now() - inicio) / 60000 >= ESPERA_MAX_MIN) {
      log(`pista ainda ocupada por "${e.dono}" — desisto desta rodada,`
        + ' a próxima refaz a conta e retoma')
      return false
    }
    log(`pista ocupada por "${e.dono}" — espera ${++n}, novo teste em 5min`)
    await sleep(5 * 60 * 1000)
  }
  pegar('sync-cobertura'); soltarNaSaida(); return true
}
if (!(await esperarPista())) { await client.end(); process.exit(0) }

// ── 3. recolhe, um dia por vez, do mais novo para o mais velho ───────────────
// Do mais novo para o mais velho de propósito: se o orçamento acabar no meio, o que
// ficou de fora é o passado — que o refresh pesado ainda vai varrer de qualquer jeito.
const NOCAP = '99999999'

/** Roda o etl-pncp para UM dia, com corte de tempo próprio.
 *
 *  O corte não é luxo: o etl-pncp trata outage do PNCP esperando 60s e REPETINDO a
 *  mesma página para sempre (correto num job noturno de horas, fatal num job que
 *  precisa sair em 20min). Sem o kill, uma janela ruim prenderia esta rodada até o
 *  orçamento inteiro evaporar em espera. */
function recolherDia(iso) {
  const data = iso.replace(/-/g, '')
  const args = ['scripts/etl-pncp.mjs', `--uf=${UF}`, `--dataInicial=${data}`, `--dataFinal=${data}`,
    `--modalidades=${MODALIDADES}`, `--max=${NOCAP}`, `--delay=${DELAY}`, '--soCabecalho']
  const teto = Math.min(POR_DIA_MIN * 60 * 1000, Math.max(0, restaMs()))
  return new Promise((resolve) => {
    const p = spawn('node', args, { stdio: 'inherit' })
    let cortado = false
    const corte = setTimeout(() => { cortado = true; p.kill() }, teto)
    p.on('exit', (code) => { clearTimeout(corte); resolve({ code: code ?? 1, cortado }) })
    p.on('error', () => { clearTimeout(corte); resolve({ code: 1, cortado }) })
  })
}

const feitos = []
for (const d of alvo) {
  if (restaMs() <= 60_000) {
    log(`orçamento de ${ORCAMENTO_MIN}min acabou — ${alvo.length - feitos.length} dia(s) ficam para a próxima`)
    break
  }
  log(`\n── ${d.iso} (tinha ${d.n}) — até ${Math.round(Math.min(POR_DIA_MIN, restaMs() / 60000))}min`)
  // MARCA ANTES. Deste ponto até o fim limpo, o dia consta como inacabado — inclusive
  // se este processo levar SIGKILL agora, que é exatamente o caso que a marca cobre.
  await tentar(`marcar ${d.iso}`, () => marcarInacabado(d.iso, d.n))
  const { code, cortado } = await recolherDia(d.iso)
  const inteiro = code === 0 && !cortado
  if (inteiro) await tentar(`limpar a marca de ${d.iso}`, () => limparInacabado(d.iso))
  feitos.push({ ...d, code, cortado, inteiro })
  if (cortado) log(`${d.iso}: tempo esgotado no meio — marcado como inacabado;`
    + ' o checkpoint do etl-pncp guarda onde parou e a próxima execução retoma')
  else if (code !== 0) log(`${d.iso}: etl-pncp saiu com código ${code} — marcado como inacabado`)
}

// ── 4. fechamento que não esconde buraco ─────────────────────────────────────
// O relatório vale menos que a coleta e menos que soltar a pista. Se o banco não
// responder agora, o trabalho JÁ FOI FEITO e está gravado — perder o resumo é chato,
// deixar a pista trancada até o silêncio expirar (30min) atrasaria o próximo dono.
const depois = await tentar('reler a cobertura para o fechamento', () => cobertura())
if (!depois) {
  log(`fim SEM RELATÓRIO: ${feitos.length} dia(s) trabalhados — a coleta aconteceu e está`
    + ' gravada; só o resumo se perdeu. `--ensaio` mostra como a base ficou.')
  if (!SEM_LOCK) soltar()
  await client.end().catch(() => {})
  process.exit(0)
}
const porDia = new Map(depois.map((d) => [d.iso, d.n]))
let ganho = 0
console.log('')
console.table(feitos.map((f) => {
  const n = porDia.get(f.iso) ?? 0
  ganho += n - f.n
  return {
    dia: f.iso,
    antes: f.n,
    depois: n,
    ganho: n - f.n,
    referência: f.ref,
    situação: f.cortado ? 'cortado no tempo' : (f.code === 0 ? 'ok' : `saiu ${f.code}`),
    // O que importa não é ter rodado, é ter fechado: um dia que continua abaixo da
    // referência depois da coleta não foi resolvido, e dizer "ok" aqui seria mentir.
    // Passar no limiar TAMBÉM não basta — foi assim que 26/08 se declarou são com 436
    // de 838 depois de morrer na 4ª de 27 UFs. Quem não terminou não fechou.
    fechou: f.idade <= 1 ? '—'
      : !f.inteiro ? 'NÃO — ficou inacabado'
      : n >= LIMIAR * f.ref ? 'sim'
      : 'NÃO — segue em falta',
  }
}))
const emFalta = feitos.filter((f) => f.idade > 1
  && (!f.inteiro || (porDia.get(f.iso) ?? 0) < LIMIAR * f.ref))
log(`fim: ${feitos.length} dia(s) trabalhados · +${ganho} contratações · ${emFalta.length} ainda em falta`
  + ` · ${Math.round((ORCAMENTO_MIN * 60 * 1000 - restaMs()) / 60000)}min`)
if (emFalta.length) {
  // Os dois motivos pedem explicações diferentes: quem rodou inteiro e ficou curto
  // provavelmente pegou janela ruim do PNCP; quem não terminou tem a marca guardada e
  // volta na próxima execução independentemente do que a régua achar dele.
  const parou = emFalta.filter((f) => !f.inteiro).map((f) => f.iso)
  const curto = emFalta.filter((f) => f.inteiro).map((f) => f.iso)
  if (parou.length) log(`inacabado(s), marcado(s) para a próxima execução: ${parou.join(', ')}`)
  if (curto.length) log(`rodou inteiro e ainda ficou curto: ${curto.join(', ')} —`
    + ' provável janela ruim do PNCP; a próxima execução (outro horário) tenta de novo')
}
if (!SEM_LOCK) soltar()
await client.end().catch(() => { /* conexão já caiu; nada a fechar */ })
