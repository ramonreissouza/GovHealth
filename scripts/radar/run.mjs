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
import crypto from 'node:crypto'
import { conectorSync } from './registry.mjs'
import { PORTAIS_PUBLICOS } from './portais.mjs'
import { rotacionar, proximoOffset, chaveRodizio, explicarRodizio } from './rodizio.mjs'
import { resolverUrlPublicaPCP, PCP_BASE_PROCESSOS } from './pcp-resolver.mjs'
import { sessaoTemCredencial } from './capture.mjs'
import { novoPool } from '../lib/pg-ssl.mjs'
import { consultar } from './banco-resiliente.mjs'

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

const DRY = process.argv.includes('--dry')
const SIMULADO = process.argv.includes('--simulado')
// Pula o laço de credenciais e roda só o passo público (PCP, BLL, BNC). O nome antigo
// (--pcp-only) continua valendo: era o único portal público quando a flag nasceu.
const ONLY_PUBLICO = process.argv.includes('--publico-only') || process.argv.includes('--pcp-only')
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

// ── hash (mesmo de src/lib/radar/hash.ts) ────────────────────────────────────
const SEP = '␟'
function msgHash({ conectorId, licitacaoId, autor, texto, horarioOrigem }) {
  const partes = [conectorId, licitacaoId, (autor ?? '').trim(), texto.trim(), (horarioOrigem ?? '').trim()]
  return crypto.createHash('sha256').update(partes.join(SEP)).digest('hex')
}

// ── classificação (espelha src/lib/radar/regras.ts) ──────────────────────────
const PADROES = [
  ['convocacao', /convoca[çc]?[ãa]?o?|convocad|comparec/i],
  ['negociacao', /negocia|contraproposta|reduzir.*valor|melhor.*lance/i],
  ['proposta_ajustada', /proposta ajustada|reajust|nova proposta|proposta readequ/i],
  ['habilitacao', /habilita|inabilita|documenta[çc]?[ãa]?o?|documento.*complement/i],
  ['diligencia', /dilig[êe]nc/i],
  ['recurso', /recurso|contrarraz|impugna/i],
  // `encerr` SOLTO saiu daqui (espelha src/lib/radar/regras.ts): quem fala de prazo
  // escreve "prazo", e o token solto transformava "o ITEM 213 foi encerrado" em
  // prioridade ALTA — 34 de 60 mensagens de uma sessão do Licitanet, rotina de disputa
  // empurrando suspensão e intenção de recurso para fora do topo da caixa.
  ['prazo', /prazo|at[ée] (o dia|as|às)|vencimento|expira/i],
  // Mudança de estado do processo (suspensão, revogação, prorrogação…). Espelha
  // src/lib/radar/regras.ts: sem ela, "o Processo foi SUSPENSO, reabertura dia X"
  // caía como prioridade BAIXA por não conter nenhuma das outras palavras.
  ['status_processo', /suspens|suspend|retomad|reabertura|reaberto|revoga|anulad|cancelad|prorrogad[oa]|prorroga[çc][ãa]o d[aeo]|adiad|remarcad/i],
  // Desfecho do lote (fracassado/deserto/adjudicado/homologado). Espelha regras.ts e NÃO
  // entra em ALTA: é resultado, não urgência — mas deixar em 'baixa' era tratar como
  // ruído uma frase cujo sentido o Radar reconhece.
  ['resultado_lote', /fracassad|desert[oa]|adjudicad|homologad/i],
]
const ALTA = new Set(['convocacao', 'prazo', 'recurso', 'diligencia', 'status_processo'])
const norm = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

function classificar(texto, cnpj, regras) {
  const hay = norm(texto)
  const cats = new Set()
  for (const [tipo, re] of PADROES) if (re.test(hay)) cats.add(tipo)
  const dig = (cnpj ?? '').replace(/\D+/g, '')
  if (dig && (texto ?? '').replace(/\D+/g, '').includes(dig)) cats.add('cnpj')
  for (const r of regras) {
    if (!r.ativo) continue
    if (r.tipo === 'qualquer') { cats.add('qualquer'); continue }
    if (r.padrao && hay.includes(norm(r.padrao))) cats.add(r.tipo === 'keyword' ? 'keyword' : r.tipo)
  }
  return [...cats]
}
const prioridadeDe = (cats) => (cats.some((c) => ALTA.has(c)) ? 'alta' : cats.length ? 'normal' : 'baixa')

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

// HISTÓRICO NÃO É NOTÍCIA.
//
// Na PRIMEIRA vez que o Radar vê um processo, o portal entrega o log INTEIRO dele de
// uma vez — semanas de eventos. Todas essas linhas são "novas" para o banco, e o
// enfileiramento mandava UM E-MAIL POR LINHA: 176 e-mails saíram de dez processos de
// teste do BNC, sobre coisas que aconteceram semanas atrás. Num tenant real, com
// centenas de processos, isso é o cliente abrindo a caixa com milhares de alertas
// retroativos no primeiro dia — e desligando o produto no segundo.
//
// Então o e-mail passa a ser sobre o que ACABOU de acontecer. O resto continua gravado
// e aparece na caixa do Radar (é contexto útil do processo), mas não toca o telefone de
// ninguém. Mensagem sem horário de origem notifica: não dá para afirmar que é velha.
const JANELA_EMAIL_H = 48

// E UM PREGÃO VIVO TAMBÉM NÃO É UMA CAIXA DE ENTRADA.
//
// A janela de 48 h resolve o histórico, não a enxurrada. Num pregão de 213 itens do
// Licitanet, o portal narra CADA item ("o ITEM 212 está na fase competitiva", "o ITEM
// 213 foi encerrado") — são centenas de mensagens legítimas e recentes numa tarde só.
// Sem teto, o cliente receberia centenas de e-mails de um único processo enquanto
// disputa outro.
//
// Então o e-mail carrega no máximo as `TETO_EMAIL_PROCESSO` mais importantes de cada
// processo a cada passada — as de prioridade alta primeiro, e entre iguais as mais
// recentes. O RESTO NÃO SOME: continua gravado, classificado e visível na caixa do
// Radar. O que o teto corta é o toque no telefone, não a informação.
const TETO_EMAIL_PROCESSO = 5

/** A mensagem é recente o bastante para virar e-mail? Sem horário → sim (conservador). */
function valeEmail(horarioOrigem) {
  if (!horarioOrigem) return true
  const t = Date.parse(horarioOrigem)
  if (Number.isNaN(t)) return true
  return Date.now() - t <= JANELA_EMAIL_H * 3600_000
}

/** Ordem de ATENDIMENTO do e-mail: alta primeiro, depois a mais recente. */
function ordemDeAtencao(a, b) {
  const alta = (m) => (prioridadeDe(classificarSoPadroes(m.texto)) === 'alta' ? 0 : 1)
  const d = alta(a) - alta(b)
  if (d) return d
  return (Date.parse(b.horarioOrigem ?? 0) || 0) - (Date.parse(a.horarioOrigem ?? 0) || 0)
}

/** Classificação só pelos padrões fixos — basta para ordenar, sem ler regras do tenant. */
function classificarSoPadroes(texto) {
  const hay = norm(texto)
  const cats = []
  for (const [tipo, re] of PADROES) if (re.test(hay)) cats.push(tipo)
  return cats
}

// ── Persiste mensagens novas + enfileira notificações (compartilhado pelos dois
// caminhos: credencial e público). Retorna {total, novas}. Respeita DRY. ─────────
async function gravarMensagens(banco, ctx, mensagens) {
  const { titularId, conectorId, cnpj, mapa, regras, destinatario } = ctx
  let total = 0, novas = 0, emails = 0, contidas = 0
  // Cópia ordenada: quem decide o que vira e-mail é a atenção que a mensagem merece,
  // não a ordem em que o portal devolveu.
  const porProcesso = new Map()
  for (const m of [...mensagens].sort(ordemDeAtencao)) {
    const proc = mapa.get(m.licitacaoId)
    if (!proc) continue // mensagem de processo não monitorado — ignora
    const cats = classificar(m.texto, cnpj, regras)
    const prioridade = prioridadeDe(cats)
    const hash = msgHash({ conectorId, licitacaoId: m.licitacaoId, autor: m.autor, texto: m.texto, horarioOrigem: m.horarioOrigem })
    total++
    if (DRY) { console.log(`    [dry] ${prioridade} [${cats.join(',') || '—'}] ${m.texto.slice(0, 70)}`); continue }
    const { rows: ins } = await banco.query(
      `INSERT INTO radar_mensagens
         (msg_hash, titular_id, processo_id, conector_id, cnpj, licitacao_id, autor, texto, anexos, horario_origem, raw, categorias, prioridade)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13)
       ON CONFLICT (msg_hash) DO NOTHING
       RETURNING id`,
      [hash, titularId, proc.id, conectorId, cnpj, m.licitacaoId, m.autor, m.texto,
       JSON.stringify(m.anexos ?? []), m.horarioOrigem, JSON.stringify(m.raw ?? {}), cats, prioridade],
    )
    if (!ins.length) continue // já existia (dedup)
    novas++
    const msgId = ins[0].id
    const assunto = proc.titulo || m.licitacaoId
    // e-mail (só o que é recente) + in-app (tudo; a caixa é o histórico do processo).
    const jaMandou = porProcesso.get(proc.id) ?? 0
    if (valeEmail(m.horarioOrigem) && jaMandou >= TETO_EMAIL_PROCESSO) contidas++
    if (valeEmail(m.horarioOrigem) && jaMandou < TETO_EMAIL_PROCESSO) {
      porProcesso.set(proc.id, jaMandou + 1)
      await banco.query(
        `INSERT INTO radar_notificacoes (id, titular_id, evento, mensagem_id, processo_id, destinatario, canal, assunto, link)
         VALUES ($1,$2,'nova_mensagem',$3,$4,$5,'email',$6,$7) ON CONFLICT (id) DO NOTHING`,
        [`nm:${msgId}:email`, titularId, msgId, proc.id, destinatario, assunto, proc.link_portal],
      )
      emails++
    }
    await banco.query(
      `INSERT INTO radar_notificacoes (id, titular_id, evento, mensagem_id, processo_id, destinatario, canal, assunto, link, status)
       VALUES ($1,$2,'nova_mensagem',$3,$4,$5,'in_app',$6,$7,'entregue') ON CONFLICT (id) DO NOTHING`,
      [`nm:${msgId}:app`, titularId, msgId, proc.id, destinatario, assunto, proc.link_portal],
    )
    await banco.query(
      `INSERT INTO radar_auditoria (titular_id, acao, entidade, entidade_id, detalhe)
       VALUES ($1,'captura','radar_mensagens',$2,$3::jsonb)`,
      [titularId, String(msgId), JSON.stringify({ categorias: cats, prioridade })],
    )
  }
  return { total, novas, emails, contidas }
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
    for (const portalId of PORTAIS_PUBLICOS) {
      try {
        const { rows: pubProcs } = await consultar(banco,
          `SELECT p.id, p.titular_id, p.licitacao_id, p.titulo, p.uf, p.link_portal
             FROM radar_processos p
             LEFT JOIN contratacoes c ON c.numero_controle_pncp = p.licitacao_id
            WHERE p.conector_id = $1 AND p.status = 'ativo' AND p.mutado = false
              AND NOT EXISTS (SELECT 1 FROM radar_credenciais cr
                              WHERE cr.titular_id = p.titular_id AND cr.conector_id = $1 AND cr.ativo = true)${filtro}
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
            if (!URGENTES) {
              const { rows: [cp] } = await consultar(banco,
                'SELECT ultima_pagina FROM etl_checkpoint WHERE chave = $1', [chaveRod])
              offsetRod = cp?.ultima_pagina ?? 0
            }
            const procs = URGENTES ? procsNaOrdem : rotacionar(procsNaOrdem, offsetRod)
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
            const frase = URGENTES ? '' : explicarRodizio(offsetRod, procs.length)
            console.log(`  · ${portalId}[público]/${titularId}: status=${resultado.status} msgs=${resultado.mensagens.length} (${resultado.detalhe ?? ''})${frase ? ` · ${frase}` : ''}`)

            const g = await gravarMensagens(banco, { titularId, conectorId: portalId, cnpj: '', mapa, regras, destinatario }, resultado.mensagens)
            totalMsgs += g.total; novasMsgs += g.novas; emailsMsgs += g.emails; contidasMsgs += g.contidas

            // Saúde do monitor PÚBLICO (sem credencial). Sem isto a tela mostrava as
            // mensagens capturadas e, logo acima, "CONECTORES OK 0 / nenhum conector
            // configurado" — se contradizendo na cara do usuário.
            if (DRY) continue

            // ONDE A PROXIMA VOLTA COMECA. `resultado.lidos` e quantos o conector leu DE
            // VERDADE — nao quantos recebeu. Avancar pelo recebido pularia justamente os
            // que o portal recusou, e o buraco so mudaria de lugar.
            //
            // Conector que nao informa `lidos` nao roda: melhor manter o comportamento
            // antigo do que girar a lista por um numero inventado.
            if (!URGENTES && Number.isFinite(Number(resultado.lidos))) {
              const novo = proximoOffset(offsetRod, Number(resultado.lidos), procs.length)
              await consultar(banco,
                `INSERT INTO etl_checkpoint (chave, ultima_pagina) VALUES ($1, $2)
                 ON CONFLICT (chave) DO UPDATE SET ultima_pagina = EXCLUDED.ultima_pagina,
                                                   atualizado_em = now()`,
                [chaveRod, novo])
            }

            const okPub = resultado.status === 'ok'
            await consultar(banco,
              `INSERT INTO radar_saude (credencial_id, titular_id, conector_id, status, verificado_em, tentado_em, detalhe, atualizado_em)
               VALUES (NULL,$1,$2,$3, ${okPub ? 'now()' : 'NULL'}, now(), $4, now())
               ON CONFLICT (titular_id, conector_id) WHERE credencial_id IS NULL DO UPDATE SET
                 status = EXCLUDED.status,
                 verificado_em = ${okPub ? 'now()' : 'radar_saude.verificado_em'},
                 tentado_em = now(), detalhe = EXCLUDED.detalhe, atualizado_em = now()`,
              [titularId, portalId, resultado.status, resultado.detalhe ?? null],
            )
          } catch (e) {
            // UM conector caiu (quase sempre a conexão com o banco, já depois do retry).
            // Não é motivo para os que ainda não tiveram vez ficarem sem passada: era
            // exatamente assim que a fila inteira sumia. Fica o erro, e segue a fila.
            console.error(`  ✗ ${portalId}[público]/${titularId}: a passada deste conector caiu — ${String(e?.message ?? e).slice(0, 180)}`)
            process.exitCode = 1
          }
        }
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
