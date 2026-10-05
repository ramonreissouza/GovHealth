// Testes do Raio-X da disputa (src/lib/raio-x.ts). Roda com `npm run raiox:teste`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CATEGORIAS_RAIO_X, MIN_ITENS_DESCONTO, calcularRaioX, percentil, raioXDisponivel, razoesValidas,
  textoFaixa, textoVariacao, type ItemHomologado,
} from '../src/lib/raio-x'

let seq = 0
const item = (o: Partial<ItemHomologado> = {}): ItemHomologado => ({
  pregao: 'P1', fornecedor: `F${seq++}`, nome: 'FORNECEDOR', porte: null, data: '2026-01-10',
  homologado: 70, estimado: 100, valorTotal: 700, ...o,
})
/** n itens espalhados por k pregões, com as razões dadas em ciclo. */
const amostra = (n: number, k: number, razoes: number[], o: Partial<ItemHomologado> = {}) =>
  Array.from({ length: n }, (_, j) => item({ pregao: `P${j % k}`, homologado: razoes[j % razoes.length] * 100, ...o }))

test('só medicamento e material hospitalar têm Raio-X', () => {
  assert.deepEqual([...CATEGORIAS_RAIO_X].sort(), ['material_hospitalar', 'medicamento'])
  assert.equal(raioXDisponivel('medicamento'), true)
  for (const c of ['imagem', 'equipamento_medico', 'ambulancia', 'outros', '', null, undefined]) {
    assert.equal(raioXDisponivel(c), false, String(c))
  }
})

test('percentil igual ao percentile_cont do Postgres (interpolação linear)', () => {
  const v = [0.4, 0.5, 0.6, 0.9]
  assert.equal(percentil(v, 0.5), 0.55)
  assert.ok(Math.abs(percentil(v, 0.25) - 0.475) < 1e-12)
  assert.ok(Math.abs(percentil(v, 0.75) - 0.675) < 1e-12)
  assert.equal(percentil([0.3], 0.75), 0.3)
})

test('razão 1 (homologado = estimado) ENTRA quando o pregão tem outros itens com desconto', () => {
  // review da #64: tirar a razão 1 inflava o desconto típico
  const itens = amostra(40, 5, [1, 1, 0.6, 0.8]) // 5 pregões x 4 razões: todo pregão sai misto
  const r = calcularRaioX(itens)
  assert.equal(r.desconto!.itens, 40)
  assert.equal(r.desconto!.mediana, 10)        // mediana de {0,6 ×10, 0,8 ×10, 1 ×20} = 0,9
  assert.equal(r.desconto!.faixa[0], 0)       // p75 = 1 → 0%: os itens no estimado aparecem na faixa
})

test('pregão em que TODOS os itens saíram pelo estimado fica de fora (estimado copiado)', () => {
  const misto = amostra(30, 3, [0.7, 0.8])
  const copiado = Array.from({ length: 10 }, () => item({ pregao: 'COPIA', homologado: 100 }))
  const v = razoesValidas([...misto, ...copiado])
  assert.equal(v.slice(30).every((x) => x === null), true)
  assert.equal(v.slice(0, 30).every((x) => x !== null), true)
  assert.equal(calcularRaioX([...misto, ...copiado]).desconto!.itens, 30)
})

test('limites da razão: 1 e 1,5 entram; acima de 1,5 e até 0,05 saem', () => {
  const casos: [number, boolean][] = [[0.05, false], [0.051, true], [1, true], [1.01, true], [1.5, true], [1.51, false]]
  const itens = casos.map(([r]) => item({ pregao: 'X', homologado: r * 100 }))
  // um item com desconto no mesmo pregão, para a razão 1 não cair na regra do pregão copiado
  itens.push(item({ pregao: 'X', homologado: 60 }))
  const v = razoesValidas(itens)
  casos.forEach(([r, entra], k) => assert.equal(v[k] !== null, entra, `razão ${r}`))
})

test('estimado ausente ou zero não vira razão', () => {
  assert.deepEqual(razoesValidas([item({ estimado: null }), item({ estimado: 0 })]), [null, null])
})

test('acima do estimado vira desconto NEGATIVO, e o texto diz "acima"', () => {
  const r = calcularRaioX(amostra(30, 3, [1.2, 1.1, 1.05]))
  assert.ok(r.desconto!.mediana < 0)
  assert.equal(textoVariacao(r.desconto!.mediana), '10% acima do estimado')
  assert.match(textoFaixa(r.desconto!.faixa), /acima do estimado$/)
  assert.doesNotMatch(textoFaixa(r.desconto!.faixa), /-/)
})

test('texto da faixa em todos os casos de sinal, sem número negativo', () => {
  assert.equal(textoFaixa([15, 54]), 'entre 15% e 54% abaixo do estimado')
  assert.equal(textoFaixa([0, 40]), 'entre o próprio estimado e 40% abaixo dele')
  assert.equal(textoFaixa([-5, 30]), 'entre 5% acima e 30% abaixo do estimado')
  assert.equal(textoFaixa([-20, -5]), 'entre 5% e 20% acima do estimado')
  assert.equal(textoFaixa([-10, 0]), 'entre 10% acima do estimado e o próprio estimado')
  assert.equal(textoFaixa([7, 7]), '7% abaixo do estimado')
  assert.equal(textoVariacao(0), 'no próprio estimado')
})

test('desconto: abaixo de 30 itens válidos o bloco não aparece', () => {
  assert.equal(calcularRaioX(amostra(MIN_ITENS_DESCONTO - 1, 5, [0.7])).desconto, null)
})

test('desconto: 30+ itens de menos de 3 pregões não bastam (itens do mesmo pregão andam juntos)', () => {
  assert.equal(calcularRaioX(amostra(132, 2, [0.5, 0.7])).desconto, null)
  assert.ok(calcularRaioX(amostra(132, 3, [0.5, 0.7])).desconto)
})

test('concorrentes: pedem 10 itens e 3 vencedores; ordem por vitórias; participação', () => {
  const a = amostra(6, 3, [0.6], { fornecedor: 'A', nome: 'ALFA' })
  const b = amostra(3, 3, [0.8], { fornecedor: 'B', nome: 'BETA' })
  const c = amostra(1, 1, [0.9], { fornecedor: 'C', nome: 'GAMA' })
  assert.equal(calcularRaioX([...a, ...b]).concorrentes, null)          // 9 itens, 2 vencedores
  const r = calcularRaioX([...a, ...b, ...c])
  assert.deepEqual(r.concorrentes!.map((x) => x.nome), ['ALFA', 'BETA', 'GAMA'])
  assert.equal(r.concorrentes![0].participacao, 60)
  assert.equal(r.concorrentes![0].desconto, 40)                          // 6 itens em 3 pregões
  assert.equal(r.concorrentes![1].desconto, null)                        // só 3 itens
})

test('concorrentes: desconto próprio de um pregão só não aparece; no máximo 5', () => {
  const um = amostra(8, 1, [0.6], { fornecedor: 'U', nome: 'UM PREGAO' })
  const outros = Array.from({ length: 7 }, (_, j) => amostra(2, 2, [0.7], { fornecedor: `O${j}` })).flat()
  const r = calcularRaioX([...um, ...outros])
  assert.equal(r.concorrentes!.length, 5)
  assert.equal(r.concorrentes![0].nome, 'UM PREGAO')
  assert.equal(r.concorrentes![0].desconto, null)
})

test('nome vazio cai no CNPJ; última vitória é a data mais recente', () => {
  const itens = [
    ...amostra(5, 2, [0.7], { fornecedor: '99', nome: '  ', data: '2025-03-01' }),
    item({ fornecedor: '99', nome: null, data: '2026-02-01' }),
    ...amostra(6, 3, [0.7]),
  ]
  const f = calcularRaioX(itens).concorrentes!.find((x) => x.cnpj === '99')!
  assert.equal(f.nome, '99')
  assert.equal(f.ultima, '2026-02-01')
})
