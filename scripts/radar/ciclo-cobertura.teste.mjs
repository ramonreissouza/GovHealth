// scripts/radar/ciclo-cobertura.teste.mjs — o lote do Compras.gov.br público e a volta.
//
// Os dois defeitos da revisão da #39, cada um com o caso que morde:
//   1. com 6+ compras a saúde nunca ficava verde (`ok` exigia ler a lista inteira numa
//      rodada de no máximo 5);
//   2. uma compra inválida travava a fila do tenant (qualquer erro encerrava o lote e o
//      rodízio, por `lidos`, não andava).
// Sem navegador: a leitura de cada compra é injetada.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avancarVolta, VOLTA_NOVA, explicarVolta } from './ciclo-cobertura.mjs'
import { lerLote, statusDoLote, MAX_COMPRAS_POR_RODADA, DesafioPublico, CompraNaoEncontrada } from './connector-comprasgov-publico.mjs'
import { PortalRecusou } from './connector-base.mjs'
import { rotacionar, proximoOffset } from './rodizio.mjs'

const url = (n) => `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=${String(160050).padStart(6, '0')}05${String(n).padStart(5, '0')}2026`
const compras = (k) => Array.from({ length: k }, (_, i) => ({ licitacaoId: `L${i}`, urlPublica: url(i + 1) }))
const semPausa = { pausa: async () => {} }
const leituraOk = async () => ({ mensagens: [{ texto: 'x' }], completa: true })

test('o link de teste é aceito pelo validador do conector', async () => {
  const r = await lerLote(compras(1), leituraOk, semPausa)
  assert.equal(r.lidos, 1, 'se falhar aqui, o formato da URL de teste está errado, não o conector')
})

test('lote respeita o teto e consome só o que tentou', async () => {
  const r = await lerLote(compras(12), leituraOk, semPausa)
  assert.equal(r.tentadas, MAX_COMPRAS_POR_RODADA)
  assert.equal(r.truncado, true)
  assert.equal(r.consumidos, MAX_COMPRAS_POR_RODADA)
  assert.equal(statusDoLote(r), 'ok', 'lote limpo é ok — mesmo sem ter visto a lista inteira')
})

test('compra inválida NÃO trava a fila: registra, consome e segue', async () => {
  const lista = compras(4)
  lista[0] = { licitacaoId: 'quebrada', urlPublica: 'https://exemplo.invalido/x' }
  const r = await lerLote(lista, leituraOk, semPausa)
  assert.equal(r.lidos, 3, 'as outras três são lidas')
  assert.equal(r.consumidos, 4, 'a quebrada consome a posição')
  assert.match(r.falhas[0], /quebrada: link público/)
  assert.equal(statusDoLote(r), 'falha', 'lote com compra não lida não é ok')
})

test('erro LOCAL de leitura (compra não encontrada, timeout) consome e segue', async () => {
  let n = 0
  const r = await lerLote(compras(3), async () => {
    n++
    if (n === 1) throw Object.assign(new CompraNaoEncontrada(), { etapa: 'abrir painel de mensagens' })
    if (n === 2) throw Object.assign(new Error('Timeout 20000ms exceeded'), { etapa: 'ler páginas de mensagens' })
    return { mensagens: [], completa: true }
  }, semPausa)
  assert.equal(r.tentadas, 3)
  assert.equal(r.lidos, 1)
  assert.equal(r.consumidos, 3)
  assert.equal(r.falhas.length, 2)
  assert.match(r.falhas[1], /ler páginas de mensagens/)
})

test('CAPTCHA e recusa do portal interrompem o lote e não consomem a compra recusada', async () => {
  for (const [erro, status] of [[new DesafioPublico(), 'captcha_2fa'], [new PortalRecusou(429, 'x'), 'portal_indisponivel']]) {
    let n = 0
    const r = await lerLote(compras(5), async () => { if (++n === 2) throw erro; return { mensagens: [], completa: true } }, semPausa)
    assert.equal(r.lidos, 1)
    assert.equal(r.tentadas, 2, 'parou na recusa, não tentou a 3ª')
    assert.equal(r.consumidos, 1, 'a recusada fica para a próxima volta')
    assert.equal(statusDoLote(r), status)
  }
})

test('histórico parcial (teto de 20 páginas) não é lote limpo', async () => {
  const r = await lerLote(compras(2), async () => ({ mensagens: [], completa: false }), semPausa)
  assert.equal(statusDoLote(r), 'falha')
})

test('O CASO 1: 12 compras, lotes limpos — verificado_em avança ao fechar a volta, para o INÍCIO dela', async () => {
  const lista = compras(12)
  let estado = VOLTA_NOVA, offset = 0
  const inicios = ['2026-09-25T10:00:00Z', '2026-09-25T12:00:00Z', '2026-09-25T14:00:00Z']
  const resultados = []
  for (const inicioLote of inicios) {
    const r = await lerLote(rotacionar(lista, offset), leituraOk, semPausa)
    const v = avancarVolta(estado, { consumidos: r.consumidos, total: lista.length, loteLimpo: statusDoLote(r) === 'ok', inicioLote })
    resultados.push(v)
    estado = v.estado
    offset = proximoOffset(offset, r.consumidos, lista.length)
  }
  assert.deepEqual(resultados.map((v) => v.fechou), [false, false, true], '5 + 5 + 5 cobre as 12 na 3ª rodada')
  assert.deepEqual(resultados.map((v) => v.verificadoEm), [null, null, '2026-09-25T10:00:00Z'])
  assert.match(explicarVolta(resultados[0], 12), /5 de 12/)
})

test('O CASO 2: compra quebrada no 1º lugar — a fila anda e todas são tentadas', async () => {
  const lista = compras(12)
  lista[0] = { licitacaoId: 'quebrada', urlPublica: 'lixo' }
  const tentadas = new Set()
  let offset = 0
  for (let i = 0; i < 3; i++) {
    const r = await lerLote(rotacionar(lista, offset), async (p) => { tentadas.add(p.licitacaoId); return { mensagens: [], completa: true } }, semPausa)
    offset = proximoOffset(offset, r.consumidos, lista.length)
  }
  assert.equal(tentadas.size, 11, 'as 11 válidas foram lidas em 3 rodadas')
})

test('volta com lote sujo fecha SEM avançar verificado_em, e a seguinte começa limpa', () => {
  let v = avancarVolta(VOLTA_NOVA, { consumidos: 5, total: 10, loteLimpo: false, inicioLote: 'A' })
  v = avancarVolta(v.estado, { consumidos: 5, total: 10, loteLimpo: true, inicioLote: 'B' })
  assert.equal(v.fechou, true)
  assert.equal(v.verificadoEm, null)
  assert.deepEqual(v.estado, VOLTA_NOVA)
  const v2 = avancarVolta(v.estado, { consumidos: 10, total: 10, loteLimpo: true, inicioLote: 'C' })
  assert.equal(v2.verificadoEm, 'C')
})

test('lista que cabe num lote: cada rodada limpa fecha a volta sozinha', () => {
  const v = avancarVolta(VOLTA_NOVA, { consumidos: 3, total: 3, loteLimpo: true, inicioLote: 'T' })
  assert.deepEqual([v.fechou, v.verificadoEm], [true, 'T'])
})

test('rodada sem número de consumo não afirma nada nem mexe na volta', () => {
  const meio = { acumulado: 5, inicio: 'A', limpa: true }
  const v = avancarVolta(meio, { consumidos: undefined, total: 10, loteLimpo: true, inicioLote: 'B' })
  assert.deepEqual([v.fechou, v.verificadoEm, v.estado], [false, null, meio])
})
