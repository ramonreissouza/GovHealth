// scripts/pagometro.teste.mjs — o cálculo do Pagômetro (src/lib/pagometro-calculo.mjs).
// Uso: node --test scripts/pagometro.teste.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ehFornecedor, somarMsc, resumirDias, faixaDias, classificarPagador } from '../src/lib/pagometro-calculo.mjs'

test('só compra de fornecedor entra: folha e transferência ficam de fora', () => {
  assert.equal(ehFornecedor('33903000'), true)   // material de consumo
  assert.equal(ehFornecedor('33903900'), true)   // serviços PJ
  assert.equal(ehFornecedor('44905200'), true)   // equipamentos
  assert.equal(ehFornecedor('31901100'), false)  // vencimentos (folha)
  assert.equal(ehFornecedor('33504300'), false)  // subvenção a entidade sem fins lucrativos
  assert.equal(ehFornecedor('33913900'), false)  // modalidade 91: entre órgãos do mesmo ente
  assert.equal(ehFornecedor(''), false)
  assert.equal(ehFornecedor(null), false)
})

test('somarMsc separa a pagar e pago, geral e Saúde, e trata o estorno', () => {
  const linha = (conta, nd, funcao, valor, natureza = 'C') => ({ conta_contabil: conta, natureza_despesa: nd, funcao, valor, natureza_conta: natureza })
  const r = somarMsc([
    linha('622130300', '33903000', '10', 100),          // a pagar, Saúde
    linha('622130300', '33903900', '12', 50),           // a pagar, Educação
    linha('622130400', '33903000', '10', 1000),         // pago, Saúde
    linha('622130400', '31901100', '10', 9999),         // folha: fora
    linha('622130400', '33903000', '10', 30, 'D'),      // estorno
    linha('622110000', '33903000', '10', 7777),         // outra conta: fora
  ])
  assert.deepEqual(r, { aPagar: 150, pagoAcumulado: 970, aPagarSaude: 100, pagoAcumuladoSaude: 970, linhas: 6 })
})

const mes = (ano, m, aPagar, pagoAcumulado, aPagarSaude = aPagar / 2, pagoAcumuladoSaude = pagoAcumulado / 2) =>
  ({ ano, mes: m, aPagar, pagoAcumulado, aPagarSaude, pagoAcumuladoSaude })

test('dias: estoque médio ÷ pagamento diário, com o fluxo tirado do acumulado', () => {
  // Paga 300 mil por mês (~10 mil/dia) e carrega 100 mil a pagar → ~10 dias.
  const serie = [mes(2026, 1, 100e3, 300e3), mes(2026, 2, 100e3, 600e3), mes(2026, 3, 100e3, 900e3), mes(2026, 4, 100e3, 1200e3)]
  const r = resumirDias(serie)
  assert.equal(r.meses, 4)
  assert.equal(r.inicio, '2026-01-01')
  assert.equal(r.fim, '2026-04-01')
  // 120 dias, 1,2 mi pagos → 10 mil/dia; estoque 100 mil → 10 dias.
  assert.equal(r.dias, 10)
  assert.equal(r.diasSaude, 10)
})

test('janeiro recomeça o acumulado; mês sem o anterior não inventa fluxo', () => {
  const serie = [
    mes(2025, 11, 50e3, 3000e3), mes(2025, 12, 50e3, 3300e3),
    mes(2026, 1, 50e3, 300e3),                    // ano novo: o acumulado É o mês
    /* falta fevereiro */ mes(2026, 3, 999e3, 900e3), // sem fevereiro, março não tem fluxo
    mes(2026, 4, 50e3, 1200e3),
  ]
  const r = resumirDias(serie)
  // Úteis: dez (300k), jan (300k), abr (300k). Novembro não tem outubro antes; março fica fora.
  assert.equal(r.meses, 3)
  assert.equal(r.inicio, '2025-12-01')
  assert.equal(r.fim, '2026-04-01')
  assert.ok(r.dias > 4 && r.dias < 6, `esperava ~5 dias, veio ${r.dias}`)
})

test('menos de 3 meses ou nada pago: sem número, em vez de um número inventado', () => {
  assert.equal(resumirDias([mes(2026, 1, 1e3, 1e3), mes(2026, 2, 1e3, 2e3)]).dias, null)
  assert.equal(resumirDias([mes(2026, 1, 1e3, 0), mes(2026, 2, 1e3, 0), mes(2026, 3, 1e3, 0)]).dias, null)
  assert.equal(resumirDias([]).dias, null)
})

test('Saúde com pagamento pequeno demais fica sem número (ruído, não comportamento)', () => {
  const pouco = [1, 2, 3, 4].map((m) => mes(2026, m, 100e3, m * 300e3, 1e3, m * 5e3))
  const r = resumirDias(pouco)
  assert.equal(r.dias, 10)
  assert.equal(r.diasSaude, null)
})

test('a janela usa só os últimos 12 meses úteis', () => {
  const serie = []
  for (let m = 1; m <= 12; m++) serie.push(mes(2025, m, 900e3, m * 300e3))   // 2025 lento (~90 dias)
  for (let m = 1; m <= 12; m++) serie.push(mes(2026, m, 100e3, m * 300e3))   // 2026 rápido (~10 dias)
  const r = resumirDias(serie)
  assert.equal(r.meses, 12)
  assert.equal(r.inicio, '2026-01-01')
  assert.ok(r.dias > 9 && r.dias < 11, `veio ${r.dias}`)
})

test('faixas: até 15 dias verde, até 45 âmbar, acima vermelho', () => {
  assert.equal(faixaDias(3), 'rapido')
  assert.equal(faixaDias(15), 'rapido')
  assert.equal(faixaDias(15.1), 'medio')
  assert.equal(faixaDias(45), 'medio')
  assert.equal(faixaDias(90), 'lento')
  assert.equal(faixaDias(null), null)
})

test('quem paga: prefeitura, estado, União ou consórcio', () => {
  assert.equal(classificarPagador('MUNICIPIO DE SALVADOR'), 'municipio')
  assert.equal(classificarPagador('FUNDO MUNICIPAL DE SAÚDE DE PATO BRANCO'), 'municipio')
  assert.equal(classificarPagador('PREFEITURA MUNICIPAL DE BORÁ - ESTADO DE SÃO PAULO'), 'municipio')
  assert.equal(classificarPagador('SECRETARIA DA SAÚDE DO ESTADO DA BAHIA'), 'estado')
  assert.equal(classificarPagador('FUNDO ESTADUAL DE SAÚDE'), 'estado')
  assert.equal(classificarPagador('ESTADO DE MINAS GERAIS'), 'estado')
  assert.equal(classificarPagador('MINISTÉRIO DA SAÚDE'), 'federal')
  assert.equal(classificarPagador('EMPRESA BRASILEIRA DE SERVIÇOS HOSPITALARES - EBSERH'), 'federal')
  assert.equal(classificarPagador('UNIVERSIDADE FEDERAL DO PARANÁ'), 'federal')
  assert.equal(classificarPagador('CONSÓRCIO INTERMUNICIPAL DE SAÚDE DO OESTE'), 'outro')
  assert.equal(classificarPagador('HOSPITAL REGIONAL DE ITABUNA'), 'municipio')
  assert.equal(classificarPagador(null), 'municipio')
})
