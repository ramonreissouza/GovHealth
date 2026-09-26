import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { gravarMensagens, hashDaEmpresa } from './mensagens-persistencia.mjs'

// Banco falso com a regra que importa: `msg_hash` é UNIQUE no banco inteiro.
function bancoFalso() {
  const mensagens = new Map() // msg_hash → { titular_id, processo_id }
  const notificacoes = []
  let id = 0
  let consultasLegado = 0
  return {
    mensagens, notificacoes,
    get consultasLegado() { return consultasLegado },
    async query(sql, p = []) {
      if (sql.startsWith('SELECT msg_hash FROM radar_mensagens')) {
        consultasLegado++
        return { rows: p[1].filter((h) => mensagens.get(h)?.titular_id === p[0]).map((msg_hash) => ({ msg_hash })) }
      }
      if (sql.includes('INSERT INTO radar_mensagens')) {
        if (mensagens.has(p[0])) return { rows: [] }
        mensagens.set(p[0], { titular_id: p[1], processo_id: p[2], id: ++id })
        return { rows: [{ id }] }
      }
      if (sql.includes('INSERT INTO radar_notificacoes')) { notificacoes.push({ id: p[0], titular: p[1] }); return { rows: [] } }
      return { rows: [] } // auditoria
    },
  }
}

const PNCP = '07954480000179-1-022924/2026'
const agora = new Date().toISOString()
const msg = { licitacaoId: PNCP, autor: 'Pregoeiro', texto: 'Convocação para envio da proposta ajustada', horarioOrigem: agora }
const ctx = (titularId, procId = `licitanet:${titularId}:${PNCP}`) => ({
  titularId, conectorId: 'licitanet', cnpj: '', regras: [], destinatario: `${titularId}@x`,
  mapa: new Map([[PNCP, { id: procId, titulo: 'Luvas', link_portal: 'https://licitanet.com.br/sessao/1' }]]),
})

test('duas empresas no mesmo pregão recebem, as duas, a mensagem e o alerta', async () => {
  const banco = bancoFalso()
  const a = await gravarMensagens(banco, ctx('empresa-a'), [msg])
  const b = await gravarMensagens(banco, ctx('empresa-b'), [msg])
  assert.equal(a.novas, 1)
  assert.equal(b.novas, 1, 'a segunda empresa perdia a mensagem no ON CONFLICT (msg_hash)')
  assert.equal(new Set(banco.notificacoes.map((n) => n.titular)).size, 2)
})

test('a mesma empresa não recebe a mesma mensagem duas vezes', async () => {
  const banco = bancoFalso()
  await gravarMensagens(banco, ctx('empresa-a'), [msg])
  const de_novo = await gravarMensagens(banco, ctx('empresa-a'), [msg])
  assert.equal(de_novo.novas, 0)
})

test('mensagem gravada com o hash ANTIGO não volta como nova (nem manda alerta de novo)', async () => {
  const banco = bancoFalso()
  // O hash antigo: só portal+pregão+autor+texto+hora (fórmula de antes desta correção).
  const antigo = crypto.createHash('sha256')
    .update(['licitanet', PNCP, msg.autor, msg.texto, msg.horarioOrigem].join('␟')).digest('hex')
  banco.mensagens.set(antigo, { titular_id: 'empresa-a', processo_id: 'x', id: 99 })
  const a = await gravarMensagens(banco, ctx('empresa-a'), [msg])
  assert.equal(a.novas, 0, 'a troca do hash regravaria a mensagem e reenviaria o alerta')
  assert.equal(banco.notificacoes.length, 0)
  // ...e a outra empresa, que nunca recebeu, agora recebe.
  const b = await gravarMensagens(banco, ctx('empresa-b'), [msg])
  assert.equal(b.novas, 1)
})

test('duas linhas da MESMA empresa para o mesmo pregão não regravam a mensagem', async () => {
  // A seleção e o "Acompanhar no Radar" podem gerar dois processos do mesmo pregão; o
  // mapa do coletor fica com um ou outro conforme a passada.
  const banco = bancoFalso()
  await gravarMensagens(banco, ctx('empresa-a', 'processo-da-selecao'), [msg])
  const outra = await gravarMensagens(banco, ctx('empresa-a', 'processo-manual'), [msg])
  assert.equal(outra.novas, 0)
})

test('o hash antigo é conferido numa consulta só por passada, não uma por mensagem', async () => {
  const banco = bancoFalso()
  const log = Array.from({ length: 50 }, (_, i) => ({ ...msg, texto: `aviso ${i}` }))
  await gravarMensagens(banco, ctx('empresa-a'), log)
  assert.equal(banco.consultasLegado, 1)
})

test('o hash do Compras.gov.br não mudou (já amarrava a empresa e o processo)', () => {
  const h = hashDaEmpresa('comprasgov', 't', 'p', 'base')
  assert.equal(h, crypto.createHash('sha256').update(JSON.stringify(['t', 'p', 'base'])).digest('hex'))
})
