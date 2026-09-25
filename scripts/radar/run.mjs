// scripts/radar/run.mjs — orquestrador do Radar (WORKER de captura).
// Roda FORA da Vercel (Task Scheduler), como o ETL PNCP. Para cada credencial ativa:
//   decifra credenciais → roda o conector → normaliza/dedup/classifica → grava
//   mensagens + enfileira notificações + atualiza saúde do conector + audita.
// Idempotente (UNIQUE msg_hash + ON CONFLICT DO NOTHING). Nunca dá falso "ok".
//
// Uso:
//   node scripts/radar/run.mjs                 # captura real (sessao + portais publicos)
//   node scripts/radar/run.mjs --publico-only  # só os portais publicos (PCP, BLL, BNC)
//   node scripts/radar/run.mjs --urgentes      # só processos com sessão à porta (roda a cada 20 min)
//   node scripts/radar/run.mjs --simulado      # fixtures, sem browser (grava)
//   node scripts/radar/run.mjs --simulado --dry # fixtures, sem gravar (só imprime)

import fs from 'node:fs'
import { coordenarColeta, transacaoPublica } from './publico-lease.mjs'
import { gravarMensagens as persistirMensagens } from './mensagens-persistencia.mjs'
import crypto from 'node:crypto'
import { conectorSync } from './registry.mjs'
import { PORTAIS_PUBLICOS } from './portais.mjs'
import { rotacionar, proximoOffset, chaveRodizio, explicarRodizio } from './rodizio.mjs'
import { avancarVolta, chavesVolta, explicarVolta, VOLTA_NOVA } from './ciclo-cobertura.mjs'
import { resolverUrlPublicaPCP, PCP_BASE_PROCESSOS } from './pcp-resolver.mjs'
import { sessaoTemCredencial } from './capture.mjs'
import { novoPool } from '../lib/pg-ssl.mjs'
import { consultar } from './banco-resiliente.mjs'
import { auditarBypassSso } from './sessao-escopo.mjs'

// ── env ────────────────────────────────────────────────────────────────────
function loadEnv() {
  try {
    const env = fs.readFileSync('.env.local', 'utf8')
    for (const key of ['DATABASE_URL', 'RADAR_CRED_KEY']) {
      if (process.env[key]) continue
      const m = env.match(new RegExp(`^${key}=(.*)$`, 'm'))
      if (m) process.env[key] = m[1].trim().replace(/^["']|["']$/g, '')
    }
  } catch { /* sem .env.local */ }
}
loadEnv()
if (process.argv.includes('--assistido')) process.env.RADAR_PUBLICO_ASSISTIDO = '1'

const DRY = process.argv.includes('--dry')
const gravarMensagens = (banco, ctx, mensagens) => persistirMensagens(banco, ctx, mensagens, { dry: DRY })
const SIMULADO = process.argv.includes('--simulado')
// Pula o laço de credenciais e roda só o passo público (PCP, BLL, BNC). O nome antigo
// (--pcp-only) continua valendo: era o único portal público quando a flag nasceu.
const ONLY_PUBLICO = process.argv.includes('--publico-only') || process.argv.includes('--pcp-only') || process.argv.includes('--comprasgov-publico')
// PASSADA DE URGÊNCIA (a cada 20 min, contra as 2 h da passada completa).
// Só processos com sessão à porta: é quando o chat ferve (convocação, diligência com
// prazo de horas, intenção de recurso) e 2 h de atraso custa o certame.
const URGENTES = process.argv.includes('--urgentes')
const argVal = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def }
const LIMIT = Number(argVal('limit', '0')) || 0 // 0 = sem limite; N = no máx. N processos PCP públicos

if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

// RECORTE DA PASSADA DE URGÊNCIA
// A data da sessão não está em radar_processos; vem de `contratacoes` pelo
// numero_controle_pncp. Duas limitações que este SQL não esconde:
//  · as colunas são DATE, sem hora — "próximas 24 h" vira ontem/hoje/amanhã. Ontem
//    entra porque disputa que começou à tarde atravessa a noite, e sem horário não
//    dá para saber se já acabou;
//  · processo que não casa com `contratacoes` (metade deles, medido) não tem data e
//    NUNCA entra aqui — segue coberto pela passada completa de 2 h, e só por ela.
const FILTRO_URGENTE = `
      AND EXISTS (
        SELECT 1 FROM contratacoes c
         WHERE c.numero_controle_pncp = p.licitacao_id
           AND (c.data_encerramento_proposta BETWEEN current_date - 1 AND current_date + 1
             OR c.data_abertura_proposta     BETWEEN current_date - 1 AND current_date + 1))`
const filtro = URGENTES ? FILTRO_URGENTE : ''

// ── cofre (mesmo algoritmo de src/lib/radar/crypto.ts) ───────────────────────
function decrypt(blob) {
  const raw = process.env.RADAR_CRED_KEY
  if (!raw) throw new Error('RADAR_CRED_KEY não configurada')
  const key = Buffer.from(raw.trim(), 'hex')
  const [iv, tag, ct] = blob.split(':')
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8')
}

// ── PCP público: resolve a URL pública de cada processo (manual > auto-resolver) ─
// link_portal já apontando p/ /processos do PCP = link colado pelo cliente (fallback).
// Sem link → tenta o auto-resolver e, se achar com confiança, CACHEIA em link_portal.
async function resolverUrlsPCP(banco, processos, dry) {
  const mapaUrl = new Map()
  for (const p of processos) {
    const manual = (p.link_portal || '').includes('portaldecompraspublicas.com.br/processos') ? p.link_portal : null
    if (manual) { mapaUrl.set(p.licitacao_id, manual); continue }
    try {
      const achado = await resolverUrlPublicaPCP({ titulo: p.titulo, uf: p.uf })
      if (achado?.url) {
        mapaUrl.set(p.licitacao_id, achado.url)
        console.log(`    ↳ PCP resolvido (conf ${achado.confianca}) p/ "${(p.titulo || p.licitacao_id).slice(0, 50)}": ${achado.candidato.numero}/${achado.candidato.uf}`)
        if (!dry) await banco.query(`UPDATE radar_processos SET link_portal = $2, atualizado_em = now() WHERE id = $1`, [p.id, achado.url])
      } else {
        console.log(`    ↳ PCP sem match confiável p/ "${(p.titulo || p.licitacao_id).slice(0, 50)}" — precisa do link manual (${PCP_BASE_PROCESSOS})`)
      }
    } catch (e) { console.warn(`    ↳ PCP resolver falhou: ${e?.message ?? e}`) }
  }
  return mapaUrl
}

// ── main ─────────────────────────────────────────────────────────────────────
// POOL, e não `pg.Client` — pelo MESMO motivo já documentado em connect-service.mjs
// em 20/08/2026, que na época foi corrigido lá e não aqui.
//
// O PgBouncer derruba conexão ociosa. Num `pg.Client` sem handler de 'error', esse
// ECONNRESET vira exceção NÃO TRATADA e o Node ENCERRA O PROCESSO no meio da passada:
//
//   node:events:486   throw er; // Unhandled 'error' event
//   Error: Connection terminated unexpectedly   (pg/lib/banco.js:204)
//
// Aconteceu 12 vezes no radar.log. E a passada é SEQUENCIAL, então morrer no meio não
// atrasa um conector: apaga todos os que ainda não tiveram vez. Era isso que deixava
// BLL, Licitanet e PCP com "sem verificar há 21 h" enquanto o BNC estava verde — eles
// não falhavam, eles nunca chegavam a ser tentados.
//
// O pool troca a conexão morta por outra sozinho; o handler abaixo impede que o evento
// suba. `max: 3` porque a passada é sequencial — não há o que paralelizar aqui.
//
// O handler cobre SÓ a conexão ociosa. A que cai com uma consulta EM CURSO rejeita a
// promise, e sem mais nada isso subia ao catch global e apagava a fila do mesmo jeito.
// Por isso, além dele: `consultar` (retry curto no que é idempotente, ver
// banco-resiliente.mjs) e um try/catch por conector nos dois laços abaixo.
const banco = novoPool(process.env.DATABASE_URL, { max: 3, idleTimeoutMillis: 10_000 })
banco.on('error', (e) => console.error('aviso: conexao do pool caiu e foi descartada:', e?.message ?? e))

let totalMsgs = 0, novasMsgs = 0, emailsMsgs = 0, contidasMsgs = 0, conectores = 0
try {
  const { rows: creds } = await consultar(banco,
    `SELECT c.id, c.titular_id, c.user_id, c.conector_id, c.cnpj, c.login, c.cred_cipher, c.storage_state
       FROM radar_credenciais c
       LEFT JOIN radar_saude s ON s.credencial_id = c.id
      WHERE c.ativo = true
        ${SIMULADO ? '' : `AND c.conector_id <> 'comprasgov'`}
        -- Na passada de 20 min, credencial que já pede intervenção humana fica de fora:
        -- insistir no login a cada 20 min não resolve CAPTCHA nem sessão expirada, e
        -- ainda arrisca bloqueio da conta no portal. A passada de 2 h continua tentando.
        ${URGENTES ? `AND coalesce(s.status, '') NOT IN ('captcha_2fa', 'sessao_expirada')` : ''}`,
  )
  console.log(`→ ${creds.length} credencial(is) ativa(s)${SIMULADO ? ' [SIMULADO]' : ''}${DRY ? ' [DRY]' : ''}${ONLY_PUBLICO ? ' [PUBLICO-ONLY]' : ''}${URGENTES ? ' [URGENTES]' : ''}${LIMIT ? ` [LIMIT ${LIMIT}]` : ''}`)

  // Passada de urgência com fila vazia é o caso NORMAL — a maioria das rodadas de 20
  // min não tem sessão à porta. Sai antes de qualquer navegador subir.
  if (URGENTES) {
    const { rows: [{ n }] } = await consultar(banco,
      `SELECT count(*)::int n FROM radar_processos p
        WHERE p.status = 'ativo' AND p.mutado = false${FILTRO_URGENTE}`)
    if (!n) {
      console.log('✓ Radar urgente: nenhum processo com sessão entre ontem e amanhã. Nada a fazer.')
      await banco.end()
      process.exit(0)
    }
    console.log(`→ ${n} processo(s) com sessão à porta`)
  }

  for (const cred of (ONLY_PUBLICO ? [] : creds)) {
    try {
      conectores++
      const inicio = Date.now()

      // Processos ativos (não silenciados) do tenant p/ este conector.
      const { rows: processos } = await consultar(banco,
        `SELECT p.id, p.licitacao_id, p.titulo, p.uf, p.link_portal FROM radar_processos p
          WHERE p.titular_id = $1 AND p.conector_id = $2 AND p.status = 'ativo' AND p.mutado = false${filtro}`,
        [cred.titular_id, cred.conector_id],
      )
      const mapa = new Map(processos.map((p) => [p.licitacao_id, p]))

      // Nada urgente para esta credencial: não abre navegador nem toca no portal. Só na
      // passada de urgência — na completa, rodar com lista vazia ainda serve para
      // atualizar a saúde do conector.
      if (URGENTES && !processos.length) {
        console.log(`  · ${cred.conector_id}/${cred.cnpj}: nenhum processo com sessão à porta — pulando`)
        continue
      }

      // PCP: resolve a URL pública de cada processo (manual > auto), p/ o modo público.
      const urlPublicaPorLic = cred.conector_id === 'pcp' ? await resolverUrlsPCP(banco, processos, DRY) : new Map()

      // Regras do tenant (+ globais) e destinatário dos alertas.
      const { rows: regras } = await consultar(banco,
        `SELECT tipo, padrao, ativo FROM radar_regras WHERE titular_id = $1 OR titular_id IS NULL`,
        [cred.titular_id],
      )
      const { rows: [tit] } = await consultar(banco, `SELECT email FROM usuarios WHERE id = $1`, [cred.titular_id])
      const destinatario = tit?.email ?? cred.titular_id

      // Decifra e roda o conector.
      let resultado
      try {
        // Modelo padrão = sessão capturada (storage_state). `cred_cipher` (senha) é
        // legado/opcional e pode ser NULL — só decifra se existir.
        const credencial = SIMULADO
          ? { login: cred.login }
          : {
              login: cred.login,
              senha: cred.cred_cipher ? decrypt(cred.cred_cipher) : undefined,
              storageState: cred.storage_state ? decrypt(cred.storage_state) : undefined,
            }
        const sync = conectorSync(cred.conector_id)
        if (!sync) {
          resultado = { status: 'falha', detalhe: `conector desconhecido: ${cred.conector_id}`, mensagens: [] }
        } else {
          resultado = await sync({
            credencial,
            processos: processos.map((p) => ({ licitacaoId: p.licitacao_id, titulo: p.titulo, uf: p.uf, urlPublica: urlPublicaPorLic.get(p.licitacao_id) })),
            simulado: SIMULADO,
          })
        }
      } catch (e) {
        resultado = { status: 'falha', detalhe: String(e?.message ?? e).slice(0, 180), mensagens: [] }
      }

      console.log(`  · ${cred.conector_id}/${cred.cnpj}: status=${resultado.status} msgs=${resultado.mensagens.length} (${resultado.detalhe ?? ''})`)

      // Grava mensagens novas + enfileira notificações (helper compartilhado).
      const g = await gravarMensagens(banco, { titularId: cred.titular_id, conectorId: cred.conector_id, cnpj: cred.cnpj, mapa, regras, destinatario }, resultado.mensagens)
      totalMsgs += g.total; novasMsgs += g.novas; emailsMsgs += g.emails; contidasMsgs += g.contidas

      // Saúde do conector (requisito 4.2): verificado_em só avança em 'ok'.
      if (!DRY) {
        const okAgora = resultado.status === 'ok'
        // Persiste sessão renovada (cifrada) quando o conector devolveu storageState.
        // NUNCA regravar o cofre com algo PIOR do que ele já tem.
        //
        // Esta gravação existe para renovar a sessão, mas não conferia o que estava
        // renovando. Em 13/09/2026 custou a sessão de um cliente: o conector reportou
        // `ok` por engano (olhava a SPA antes de renderizar), devolveu o estado de um
        // navegador que nunca logou, e a passada seguinte salvou por cima — os 11 cookies
        // do login viraram dois cookies do Google Analytics.
        //
        // Regra: sessão sem cookie de credencial não substitui sessão existente. Perder a
        // renovação custa uma reconexão; perder o cofre custa o cliente refazer o login.
        const renovacaoUtil = resultado.storageState && sessaoTemCredencial(resultado.storageState)
        if (okAgora && resultado.storageState && !renovacaoUtil) {
          console.warn(`    (renovação DESCARTADA: a sessão devolvida não tem cookie de credencial — cofre preservado)`)
        }
        if (okAgora && renovacaoUtil && !SIMULADO) {
          try {
            const raw = process.env.RADAR_CRED_KEY
            const key = Buffer.from(raw.trim(), 'hex')
            const iv = crypto.randomBytes(12)
            const c = crypto.createCipheriv('aes-256-gcm', key, iv)
            const ctb = Buffer.concat([c.update(resultado.storageState, 'utf8'), c.final()])
            const blob = `${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ctb.toString('base64')}`
            await consultar(banco, `UPDATE radar_credenciais SET storage_state = $2, atualizado_em = now() WHERE id = $1`, [cred.id, blob])
if (resultado.bypassSso) {
  await auditarBypassSso((sql, p) => consultar(banco, sql, p), { titularId: cred.titular_id, credencialId: cred.id, conectorId: cred.conector_id, via: 'renovacao' })
}
          } catch (e) { console.warn('    (não foi possível salvar a sessão):', e.message) }
        }
        await consultar(banco,
          `INSERT INTO radar_saude (credencial_id, titular_id, conector_id, status, verificado_em, tentado_em, detalhe, duracao_ms, atualizado_em)
           VALUES ($1,$2,$3,$4, ${okAgora ? 'now()' : 'NULL'}, now(), $5, $6, now())
           -- O predicado NÃO é decoração: radar_saude_cred_uq é um índice único PARCIAL
           -- (WHERE credencial_id IS NOT NULL), e o Postgres só infere índice parcial se
           -- o ON CONFLICT repetir o predicado. Sem ele, 42P10 — era o que derrubava
           -- TODA passada do Radar desde que a PK virou índice parcial.
           ON CONFLICT (credencial_id) WHERE credencial_id IS NOT NULL DO UPDATE SET
             status = EXCLUDED.status,
             verificado_em = ${okAgora ? 'now()' : 'radar_saude.verificado_em'},
             tentado_em = now(), detalhe = EXCLUDED.detalhe, duracao_ms = EXCLUDED.duracao_ms, atualizado_em = now()`,
          [cred.id, cred.titular_id, cred.conector_id, resultado.status, resultado.detalhe ?? null, Date.now() - inicio],
        )
      }
    } catch (e) {
      // UM conector caiu (quase sempre a conexão com o banco, já depois do retry).
      // Não é motivo para os que ainda não tiveram vez ficarem sem passada: era
      // exatamente assim que a fila inteira sumia. Fica o erro, e segue a fila.
      console.error(`  ✗ ${cred.conector_id}/${cred.cnpj}: a passada deste conector caiu — ${String(e?.message ?? e).slice(0, 180)}`)
      process.exitCode = 1
    }
  }

  // ── PASSO PÚBLICO (portais que publicam o andamento SEM login) ──────────────
  // Vale para TODO portal marcado como público em portais.mjs (hoje PCP, BLL e BNC).
  // Antes este passo tinha 'pcp' escrito na mão em cinco lugares — acrescentar um portal
  // público significava reescrever o orquestrador, e foi por isso que BLL e BNC ficaram
  // parados mesmo com a página deles aberta a qualquer um.
  //
  // Cada portal roda por tenant que tenha processos dele e NÃO tenha credencial ativa
  // dele (quem conectou sessão já foi atendido no laço acima, em modo híbrido).
  if (!SIMULADO) {
    for (const portalId of PORTAIS_PUBLICOS.filter((id) => !process.argv.includes('--comprasgov-publico') || id === 'comprasgov')) {
      try {
        const inicioPublico = new Date().toISOString()
        const { rows: pubProcs } = await consultar(banco,
          `SELECT p.id, p.titular_id, p.licitacao_id, p.titulo, p.uf, p.link_portal
             FROM radar_processos p
             LEFT JOIN contratacoes c ON c.numero_controle_pncp = p.licitacao_id
            WHERE p.conector_id = $1 AND p.status = 'ativo' AND p.mutado = false
              AND ($1 = 'comprasgov' OR NOT EXISTS (SELECT 1 FROM radar_credenciais cr
                              WHERE cr.titular_id = p.titular_id AND cr.conector_id = $1 AND cr.ativo = true))
              AND ($1 <> 'comprasgov' OR (p.origem='manual' AND p.licitacao_id LIKE 'comprasgov:publico:%'))${filtro}
            -- A ORDEM É POLÍTICA, NÃO ENFEITE. Ler a página pública custa ~12 s por
            -- processo e o conector tem teto por passada; então o que está perto da sessão
            -- vai primeiro, e o teto corta a cauda fria em vez de sortear quem fica de fora.
            -- Processo sem data casada em contratacoes (metade deles, medido) vai ao fim,
            -- não fica de fora.
            ORDER BY (coalesce(c.data_encerramento_proposta, c.data_abertura_proposta) IS NULL),
                     abs(coalesce(c.data_encerramento_proposta, c.data_abertura_proposta) - current_date),
                     p.criado_em DESC`,
          [portalId],
        )
        const pubUsar = LIMIT ? pubProcs.slice(0, LIMIT) : pubProcs
        const lease = portalId === 'comprasgov' && pubUsar.length && !DRY
          ? await coordenarColeta(banco, portalId) : null
        if (portalId === 'comprasgov' && pubUsar.length && !DRY && !lease) {
          console.log('  · comprasgov: outra rodada está em execução ou o portal está em pausa.')
          continue
        }
        let esperaPortal = 300
        try {
          const porTitular = new Map()
          for (const p of pubUsar) (porTitular.get(p.titular_id) ?? porTitular.set(p.titular_id, []).get(p.titular_id)).push(p)
          if (porTitular.size) console.log(`→ ${portalId} público (sem login): ${porTitular.size} tenant(s), ${pubUsar.length}${LIMIT ? `/${pubProcs.length}` : ''} processo(s)`)

          const syncPortal = conectorSync(portalId)
          for (const [titularId, procsNaOrdem] of porTitular) {
            try {
              conectores++

              // ── RODIZIO ──────────────────────────────────────────────────────────────
              //
              // Medido no Licitanet em 22/09/2026: "recusou a conexao (HTTP 429) — 21 de 60
              // processo(s) lidos antes". O conector agiu certo. O problema era a passada
              // SEGUINTE: a ordem acima e estavel, entao ela recomecava do mesmo primeiro, lia
              // os mesmos ~21 e levava 429 no mesmo ponto. Os processos 22 a 60 NUNCA eram
              // lidos — o teto configurado era 60 e o teto real virou 21, sem nada na tela
              // dizendo isso. O cliente le "21 lidos" e supoe cobertura.
              //
              // Girar a lista nao exige saber a regra do WAF deles (que nao sabemos): seja
              // qual for o ponto do corte, a volta seguinte comeca depois dele.
              //
              // SO NA PASSADA COMPLETA. Na de urgencia a lista ja e filtrada para quem tem
              // sessao a porta, e ali "mais quente primeiro" e a resposta certa: pregao com
              // sessao hoje nao cede a vez para um de mes que vem.
              const chaveRod = chaveRodizio(portalId, titularId)
              let offsetRod = 0
              // LE ate no dry-run (o dry so nao ESCREVE): sem isso um `--dry` mostraria a
              // volta sempre comecando do 1o, e quem usa o dry para conferir o rodizio veria
              // exatamente o bug que ele conserta.
              //
              // DESLIGADO COM `--limit`. O limite corta a lista ANTES do rodízio, então o ponto
              // salvo (medido na lista inteira) apontaria para outro lugar — e, numa passada
              // real, o módulo pela lista cortada GRAVARIA POR CIMA o ponto de produção. O
              // `--limit` é ferramenta de teste; ele não pode mexer no estado da passada de verdade.
              const rodizio = !URGENTES && !LIMIT
              if (rodizio) {
                const { rows: [cp] } = await consultar(banco,
                  'SELECT ultima_pagina FROM etl_checkpoint WHERE chave = $1', [chaveRod])
                offsetRod = cp?.ultima_pagina ?? 0
              }
              const procs = rodizio ? rotacionar(procsNaOrdem, offsetRod) : procsNaOrdem
              const mapa = new Map(procs.map((p) => [p.licitacao_id, p]))
              // O PCP não publica o endereço do processo no PNCP: precisa do resolvedor (ou do
              // link colado pelo cliente). BLL/BNC publicam — o link já está em link_portal,
              // gravado pela seleção a partir do `link_externo` do PNCP.
              const urlPublicaPorLic = portalId === 'pcp'
                ? await resolverUrlsPCP(banco, procs, DRY)
                : new Map(procs.filter((p) => p.link_portal).map((p) => [p.licitacao_id, p.link_portal]))
              const { rows: regras } = await consultar(banco, `SELECT tipo, padrao, ativo FROM radar_regras WHERE titular_id = $1 OR titular_id IS NULL`, [titularId])
              const { rows: [tit] } = await consultar(banco, `SELECT email FROM usuarios WHERE id = $1`, [titularId])
              const destinatario = tit?.email ?? titularId

              let resultado
              try {
                resultado = syncPortal
                  ? await syncPortal({ credencial: {}, processos: procs.map((p) => ({ licitacaoId: p.licitacao_id, titulo: p.titulo, uf: p.uf, urlPublica: urlPublicaPorLic.get(p.licitacao_id) })), simulado: false })
                  : { status: 'falha', detalhe: `conector ${portalId} ausente`, mensagens: [] }
              } catch (e) { resultado = { status: 'falha', detalhe: String(e?.message ?? e).slice(0, 180), mensagens: [] } }
              // O rodizio entra no log: rodizio silencioso e indistinguivel de rodizio que
              // nao aconteceu, e a pergunta que alguem vai fazer e "por que o processo X nao
              // foi lido hoje?".
              // A VOLTA (só Compras.gov.br). Ele lê no máximo 5 compras por rodada, então `ok`
// quer dizer "este lote saiu limpo" — não "a lista inteira foi vista". Quem pode
// afirmar a lista inteira é a volta: `verificado_em` só avança quando as posições
// consumidas cobrem a lista e todos os lotes dela foram limpos, e avança para o
// INÍCIO da volta. Ver ciclo-cobertura.mjs. Só na passada completa: na de urgência
// (ou com --limit) a lista é outra, e somar sobre ela contaria a volta errada.
let volta = null
if (portalId === 'comprasgov' && rodizio) {
  const k = chavesVolta(portalId, titularId)
  const { rows: cps } = await consultar(banco,
    'SELECT chave, ultima_pagina, atualizado_em FROM etl_checkpoint WHERE chave = ANY($1)', [[k.acumulado, k.inicio]])
  const acum = cps.find((c) => c.chave === k.acumulado)
  const ini = cps.find((c) => c.chave === k.inicio)
  const estadoVolta = acum?.ultima_pagina > 0
    ? { acumulado: acum.ultima_pagina, inicio: ini?.atualizado_em ? new Date(ini.atualizado_em).toISOString() : null, limpa: (ini?.ultima_pagina ?? 1) === 1 }
    : VOLTA_NOVA
  volta = avancarVolta(estadoVolta, { consumidos: resultado.consumidos, total: procs.length, loteLimpo: resultado.status === 'ok', inicioLote: inicioPublico })
}
const frase = [rodizio ? explicarRodizio(offsetRod, procs.length) : (LIMIT && !URGENTES ? 'rodízio desligado com --limit' : ''),
  volta ? explicarVolta(volta, procs.length) : ''].filter(Boolean).join(' · ')
              console.log(`  · ${portalId}[público]/${titularId}: status=${resultado.status} msgs=${resultado.mensagens.length} (${resultado.detalhe ?? ''})${frase ? ` · ${frase}` : ''}`)

              if (portalId === 'comprasgov' && resultado.status !== 'ok') process.exitCode = 1
              if (portalId === 'comprasgov' && ['portal_indisponivel', 'captcha_2fa'].includes(resultado.status)) esperaPortal = Math.max(1800, resultado.retryAfterSeconds || 0)
              await transacaoPublica(banco, lease, async (client) => {
                const g = await gravarMensagens(client, { titularId, conectorId: portalId, cnpj: '', mapa, regras, destinatario }, resultado.mensagens)
                totalMsgs += g.total; novasMsgs += g.novas; emailsMsgs += g.emails; contidasMsgs += g.contidas

                // Saúde do monitor PÚBLICO (sem credencial). Sem isto a tela mostrava as
                // mensagens capturadas e, logo acima, "CONECTORES OK 0 / nenhum conector
                // configurado" — se contradizendo na cara do usuário.
                if (DRY) return

                // ONDE A PROXIMA VOLTA COMECA. `resultado.consumidos` e quantas posicoes DESTA
                // lista o conector gastou: lidas ou falhas daquela pagina, mas NAO as que o
                // portal recusou (ver contadorDeConsumo em rodizio.mjs). Nao e o recebido —
                // avancar pelo recebido pularia justamente os recusados. E nao e mais
                // `lidos`: com ele, um primeiro lote que falhava sempre deixava o ponto parado
                // e a cauda nunca era tentada (revisao da #38).
                //
                // `lidos` fica so como compatibilidade com conector que ainda nao conta
                // consumo. Conector que nao informa nenhum dos dois nao roda: melhor manter o
                // comportamento antigo do que girar a lista por um numero inventado.
                const avanco = Number.isFinite(Number(resultado.consumidos)) ? Number(resultado.consumidos) : Number(resultado.lidos)
                if (rodizio && Number.isFinite(avanco)) {
                  const novo = proximoOffset(offsetRod, avanco, procs.length)
                  await client.query(
                    `INSERT INTO etl_checkpoint (chave, ultima_pagina) VALUES ($1, $2)
                     ON CONFLICT (chave) DO UPDATE SET ultima_pagina = EXCLUDED.ultima_pagina,
                                                       atualizado_em = now()`,
                    [chaveRod, novo])
                }

                // Compras cadastradas durante a rodada ainda precisam de uma leitura.
                if (volta) {
                  const k = chavesVolta(portalId, titularId)
                  await client.query(
                    `INSERT INTO etl_checkpoint (chave, ultima_pagina) VALUES ($1, $2)
                     ON CONFLICT (chave) DO UPDATE SET ultima_pagina = EXCLUDED.ultima_pagina, atualizado_em = now()`,
                    [k.acumulado, volta.estado.acumulado])
                  // `atualizado_em` desta chave É o início da volta — por isso é escrito explicitamente,
                  // e não pelo now() do upsert, que o moveria a cada rodada.
                  await client.query(
                    `INSERT INTO etl_checkpoint (chave, ultima_pagina, atualizado_em) VALUES ($1, $2, coalesce($3::timestamptz, now()))
                     ON CONFLICT (chave) DO UPDATE SET ultima_pagina = EXCLUDED.ultima_pagina, atualizado_em = EXCLUDED.atualizado_em`,
                    [k.inicio, volta.estado.limpa ? 1 : 0, volta.estado.inicio])
                }

                // Compras.gov.br: só a volta fechada e limpa autoriza `verificado_em` (e sem volta —
                // urgência, --limit — nada o autoriza). Os demais portais leem a lista numa rodada.
                const verificadoPublico = portalId === 'comprasgov'
                  ? (volta?.verificadoEm ?? null)
                  : (resultado.status === 'ok' ? new Date().toISOString() : null)
                await client.query(
                  `INSERT INTO radar_saude (credencial_id, titular_id, conector_id, status, verificado_em, tentado_em, detalhe, atualizado_em)
                   VALUES (NULL,$1,$2,$3,$5::timestamptz,now(),$4,now())
                   ON CONFLICT (titular_id, conector_id) WHERE credencial_id IS NULL DO UPDATE SET
                     status = EXCLUDED.status,
                     verificado_em = coalesce(EXCLUDED.verificado_em,radar_saude.verificado_em),
                     tentado_em = now(), detalhe = EXCLUDED.detalhe, atualizado_em = now()`,
                  [titularId, portalId, resultado.status, resultado.detalhe ?? null, verificadoPublico],
                )
              })
              if (portalId === 'comprasgov' && ['portal_indisponivel', 'captcha_2fa'].includes(resultado.status)) break
            } catch (e) {
              // UM conector caiu (quase sempre a conexão com o banco, já depois do retry).
              // Não é motivo para os que ainda não tiveram vez ficarem sem passada: era
              // exatamente assim que a fila inteira sumia. Fica o erro, e segue a fila.
              console.error(`  ✗ ${portalId}[público]/${titularId}: a passada deste conector caiu — ${String(e?.message ?? e).slice(0, 180)}`)
              process.exitCode = 1
            }
          }
        } finally { await lease?.fechar(esperaPortal) }
      } catch (e) {
        // O mesmo isolamento, um nível acima: aqui o que cai é a consulta do PORTAL
        // (a lista de processos), e o próximo portal público ainda tem de rodar.
        console.error(`  ✗ ${portalId}[público]: a passada deste conector caiu — ${String(e?.message ?? e).slice(0, 180)}`)
        process.exitCode = 1
      }
    }
  }

  console.log(`✓ Radar sync: ${conectores} conector(es), ${totalMsgs} mensagem(ns) vistas, ${novasMsgs} nova(s), ${emailsMsgs} por e-mail${contidasMsgs ? ` (+${contidasMsgs} recente(s) contida(s) pelo teto por processo)` : ''} — as demais são histórico e ficam só na caixa${DRY ? ' (dry-run, nada gravado)' : ''}.`)
} catch (e) {
  console.error('Falha no Radar sync:', e)
  process.exitCode = 1
} finally {
  await banco.end()
}
