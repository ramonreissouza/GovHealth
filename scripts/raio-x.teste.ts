// Testes do Raio-X da disputa (src/lib/raio-x.ts). Roda com `npm run raiox:teste`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CATEGORIAS_RAIO_X, MIN_ITENS_CONCORRENTES, MIN_ITENS_DESCONTO, MIN_PREGOES_DESCONTO, estatDoBanco, montarRaioX, raioXDisponivel,
  type ConcorrenteBruto, type EstatRazao,
} from '../src/lib/raio-x'

const estat = (o: Partial<EstatRazao> = {}): EstatRazao => ({
  n: 120, p25: 0.45, p50: 0.66, p75: 0.85, itens: 150, licitacoes: 20, licitacoesDesconto: 18, vencedores: 40, ...o,
})
const conc = (o: Partial<ConcorrenteBruto> = {}): ConcorrenteBruto => ({
  cnpj: '11111111000111', nome: 'DISTRIBUIDORA A', porte: 'ME', vitorias: 30, valor: 1000,
  n_desconto: 25, pregoes_desconto: 6, ratio_mediana: 0.6, ultima: '2026-09-01', ...o,
})

test('só medicamento e material hospitalar têm Raio-X', () => {
  assert.deepEqual([...CATEGORIAS_RAIO_X].sort(), ['material_hospitalar', 'medicamento'])
  assert.equal(raioXDisponivel('medicamento'), true)
  for (const c of ['imagem', 'equipamento_medico', 'ambulancia', 'outros', '', null, undefined]) {
    assert.equal(raioXDisponivel(c), false, String(c))
  }
})

test('desconto: razão vira desconto e a faixa sai na ordem certa (menor → maior)', () => {
  const r = montarRaioX({ estat: estat(), concorrentes: [] })
  assert.ok(r.desconto)
  assert.equal(r.desconto!.mediana, 34)         // 1 - 0,66
  assert.deepEqual(r.desconto!.faixa, [15, 55]) // 1 - p75, 1 - p25
  assert.equal(r.desconto!.itens, 120)
})

test('desconto: abaixo de 30 itens válidos o bloco não aparece (sem fallback)', () => {
  const r = montarRaioX({ estat: estat({ n: MIN_ITENS_DESCONTO - 1 }), concorrentes: [conc()] })
  assert.equal(r.desconto, null)
  // os concorrentes têm régua própria e continuam
  assert.ok(r.concorrentes)
})

test('desconto: 30 itens de menos de 3 pregões não bastam (itens do mesmo pregão andam juntos)', () => {
  const r = montarRaioX({ estat: estat({ n: 132, licitacoesDesconto: MIN_PREGOES_DESCONTO - 1 }), concorrentes: [conc()] })
  assert.equal(r.desconto, null)
  assert.ok(r.concorrentes)
  assert.ok(montarRaioX({ estat: estat({ licitacoesDesconto: MIN_PREGOES_DESCONTO }), concorrentes: [] }).desconto)
})

test('desconto: percentil nulo não vira número', () => {
  assert.equal(montarRaioX({ estat: estat({ p50: null }), concorrentes: [] }).desconto, null)
})

test('concorrentes: pedem 10 itens ganhos e 3 vencedores distintos', () => {
  assert.equal(montarRaioX({ estat: estat({ itens: MIN_ITENS_CONCORRENTES - 1 }), concorrentes: [conc()] }).concorrentes, null)
  assert.equal(montarRaioX({ estat: estat({ vencedores: 2 }), concorrentes: [conc()] }).concorrentes, null)
})

test('concorrentes: participação sobre os itens do recorte; desconto só com 5+ itens dele', () => {
  const r = montarRaioX({
    estat: estat({ itens: 200 }),
    concorrentes: [conc({ vitorias: 50 }), conc({ cnpj: '2', vitorias: 4, n_desconto: 4, ratio_mediana: 0.5 })],
  })
  assert.equal(r.concorrentes![0].participacao, 25)
  assert.equal(r.concorrentes![0].desconto, 40)
  assert.equal(r.concorrentes![1].desconto, null)
})

test('concorrentes: desconto próprio de um pregão só não aparece', () => {
  const r = montarRaioX({ estat: estat(), concorrentes: [conc({ n_desconto: 30, pregoes_desconto: 1 })] })
  assert.equal(r.concorrentes![0].desconto, null)
  assert.equal(r.concorrentes![0].vitorias, 30)
})

test('concorrentes: no máximo 5, nome vazio cai no CNPJ, números do banco como string', () => {
  const muitos = Array.from({ length: 8 }, (_, i) => conc({ cnpj: String(i), vitorias: '9' as unknown as number }))
  const r = montarRaioX({ estat: estat(), concorrentes: [conc({ nome: '  ', cnpj: '99' }), ...muitos] })
  assert.equal(r.concorrentes!.length, 5)
  assert.equal(r.concorrentes![0].nome, '99')
  assert.equal(r.concorrentes![1].vitorias, 9)
})

test('estatDoBanco: JSON vazio vira zeros, não quebra', () => {
  const e = estatDoBanco(null)
  assert.equal(e.n, 0)
  assert.equal(e.p50, null)
  assert.equal(montarRaioX({ estat: e, concorrentes: [] }).desconto, null)
})
