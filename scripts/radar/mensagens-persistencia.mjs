import crypto from 'node:crypto'
import { emTransacao } from './banco-resiliente.mjs'

const SEP = '␟'
function msgHash({ conectorId, licitacaoId, autor, texto, horarioOrigem }) {
  const partes = [conectorId, licitacaoId, (autor ?? '').trim(), texto.trim(), (horarioOrigem ?? '').trim()]
  return crypto.createHash('sha256').update(partes.join(SEP)).digest('hex')
}

/** O hash gravado: o da mensagem, amarrado à empresa e ao processo dela. Era a fórmula
 *  só do Compras.gov.br; agora vale para todos (ver gravarMensagens). */
export function hashDaEmpresa(titularId, processoId, baseHash) {
  return crypto.createHash('sha256').update(JSON.stringify([titularId, processoId, baseHash])).digest('hex')
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
export async function gravarMensagens(banco, ctx, mensagens, { dry = false } = {}) {
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
    const baseHash = msgHash({ conectorId, licitacaoId: m.licitacaoId, autor: m.autor, texto: m.texto, horarioOrigem: m.horarioOrigem })
    // A EMPRESA ENTRA NA IDENTIDADE DA MENSAGEM, EM TODO PORTAL. `msg_hash` é UNIQUE no
    // banco inteiro, e fora do Compras.gov.br o hash era só portal+pregão+autor+texto+hora:
    // duas empresas no mesmo pregão (o nº do PNCP é o mesmo para as duas) davam o mesmo
    // hash, a primeira gravava e a segunda caía no ON CONFLICT DO NOTHING — sem mensagem
    // e sem alerta, com a tela dizendo "sem novidades" (requisito 4.2).
    const hash = hashDaEmpresa(titularId, proc.id, baseHash)
    total++
    if (dry) { console.log(`    [dry] ${prioridade} [${cats.join(',') || '—'}] ${m.texto.slice(0, 70)}`); continue }
    // O que já foi gravado com o hash ANTIGO (só portal+pregão) é desta empresa se a linha
    // é dela. Sem esta checagem, a troca do hash regravaria como nova cada mensagem já
    // capturada e mandaria de novo os alertas dela. Sem migração de dados: a regra vale
    // igual antes e depois, e rodar duas vezes não muda nada.
    if (conectorId !== 'comprasgov') {
      const { rows: antiga } = await banco.query(
        'SELECT 1 FROM radar_mensagens WHERE msg_hash = $1 AND titular_id = $2 LIMIT 1', [baseHash, titularId])
      if (antiga.length) continue
    }
    const assunto = proc.titulo || m.licitacaoId
    // e-mail (só o que é recente) + in-app (tudo; a caixa é o histórico do processo).
    const jaMandou = porProcesso.get(proc.id) ?? 0
    const querEmail = valeEmail(m.horarioOrigem) && jaMandou < TETO_EMAIL_PROCESSO
    // A MENSAGEM E OS ALERTAS DELA SÃO UMA COISA SÓ (revisão da #34). Com instruções
    // soltas, uma queda entre o INSERT da mensagem e o das notificações deixava o
    // `msg_hash` gravado e o alerta não — e a rodada seguinte nunca o recriava.
    //
    // `emTransacao` abre transação por mensagem quando `banco` é um Pool — é o caso do
    // laço de credenciais e dos portais públicos sem lease (BLL, BNC, Licitanet, PCP),
    // que o `transacaoPublica` repassa como pool puro. Quando `banco` já é o client da
    // transação do lease (Compras.gov.br), a atomicidade é a dela, e não há BEGIN
    // aninhado. Contadores ficam FORA: numa repetição, dentro seriam contados duas vezes.
    const gravada = await emTransacao(banco, async (db) => {
      const { rows: ins } = await db.query(
        `INSERT INTO radar_mensagens
           (msg_hash, titular_id, processo_id, conector_id, cnpj, licitacao_id, autor, texto, anexos, horario_origem, raw, categorias, prioridade, lote)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13,$14)
         ON CONFLICT (msg_hash) DO NOTHING
         RETURNING id`,
        [hash, titularId, proc.id, conectorId, cnpj, m.licitacaoId, m.autor, m.texto,
         JSON.stringify(m.anexos ?? []), m.horarioOrigem, JSON.stringify(m.raw ?? {}), cats, prioridade, m.lote ?? null],
      )
      if (!ins.length) return false // já existia (dedup) — e, com a transação, JÁ COM os alertas
      const msgId = ins[0].id
      if (querEmail) {
        await db.query(
          `INSERT INTO radar_notificacoes (id, titular_id, evento, mensagem_id, processo_id, destinatario, canal, assunto, link)
           VALUES ($1,$2,'nova_mensagem',$3,$4,$5,'email',$6,$7) ON CONFLICT (id) DO NOTHING`,
          [`nm:${msgId}:email`, titularId, msgId, proc.id, destinatario, assunto, proc.link_portal],
        )
      }
      await db.query(
        `INSERT INTO radar_notificacoes (id, titular_id, evento, mensagem_id, processo_id, destinatario, canal, assunto, link, status)
         VALUES ($1,$2,'nova_mensagem',$3,$4,$5,'in_app',$6,$7,'entregue') ON CONFLICT (id) DO NOTHING`,
        [`nm:${msgId}:app`, titularId, msgId, proc.id, destinatario, assunto, proc.link_portal],
      )
      await db.query(
        `INSERT INTO radar_auditoria (titular_id, acao, entidade, entidade_id, detalhe)
         VALUES ($1,'captura','radar_mensagens',$2,$3::jsonb)`,
        [titularId, String(msgId), JSON.stringify({ categorias: cats, prioridade })],
      )
      return true
    })
    if (!gravada) continue
    novas++
    if (querEmail) { porProcesso.set(proc.id, jaMandou + 1); emails++ }
    else if (valeEmail(m.horarioOrigem)) contidas++
  }
  return { total, novas, emails, contidas }
}
