// scripts/pagometro.teste.mjs — o cálculo do Pagômetro (src/lib/pagometro-calculo.mjs).
// Uso: npm run pagometro:teste (tsx --test: alguns casos importam os módulos .ts do app)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { ehFornecedor, somarMsc, resumirDias, faixaDias, classificarPagador, normalizeKey, pagadorDe } from '../src/lib/pagometro-calculo.mjs'
import { lerCsv, eventosDoDia, aplicarDia, resumirUg, AQUECIMENTO_DIAS, primeiroMesInteiroApos } from '../src/lib/pagometro-federal.mjs'
import { lerDoZip, entradasZip } from './lib/zip.mjs'

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
  assert.equal(classificarPagador('FUNDO MUN.DE SAUDE DE SAO LUIS DE MONTES BELOS'), 'municipio')
  assert.equal(classificarPagador('PREFEITURA MUNICIPAL DE BORÁ - ESTADO DE SÃO PAULO'), 'municipio')
  assert.equal(classificarPagador('SECRETARIA DA SAÚDE DO ESTADO DA BAHIA'), 'estado')
  assert.equal(classificarPagador('FUNDO ESTADUAL DE SAÚDE'), 'estado')
  assert.equal(classificarPagador('ESTADO DE MINAS GERAIS'), 'estado')
  assert.equal(classificarPagador('SECRETARIA DE ESTADO DE SAUDE DO DISTRITO FEDERAL'), 'estado')
  assert.equal(classificarPagador('MINISTERIO PUBLICO DO ESTADO DA BAHIA'), 'estado')
  assert.equal(classificarPagador('MINISTÉRIO DA SAÚDE'), 'federal')
  assert.equal(classificarPagador('EMPRESA BRASILEIRA DE SERVIÇOS HOSPITALARES - EBSERH'), 'federal')
  assert.equal(classificarPagador('UNIVERSIDADE FEDERAL DO PARANÁ'), 'federal')
  assert.equal(classificarPagador('UNIVERSIDADE FEDERAL DO ESTADO DO RIO DE JANEIRO'), 'federal')
  assert.equal(classificarPagador('CONSÓRCIO INTERMUNICIPAL DE SAÚDE DO OESTE'), 'outro')
  assert.equal(classificarPagador('CONDERG - CONS. DE DESENV. - HOSPITAL DIVINOLÂNDIA'), 'outro')
})

test('sem marca de prefeitura, não herda o prazo da cidade (nomes reais da base)', () => {
  // Estes caíam em 'municipio' e mostravam o Pagômetro da prefeitura onde ficam.
  for (const [orgao, esperado] of [
    ['UNIVERSIDADE ESTADUAL DE LONDRINA', 'estado'],
    ['UNIVERSIDADE ESTADUAL DE CAMPINAS', 'estado'],
    ['INSTITUTO DE ASSISTENCIA MEDICA AO SERVIDOR PUBLICO ESTADUAL', 'estado'],
    ['RIO GRANDE DO NORTE SECRETARIA DA SAUDE PUBLICA', 'estado'],
    ['SAO PAULO SECRETARIA DA ADMINISTRACAO PENITENCIARIA', 'estado'],
    ['(UO) ESP-CETESB-CIA AMBIENTAL DO EST.DE SP', 'estado'],
    ['BANCO CENTRAL DO BRASIL', 'federal'],
    ['TRIBUNAL SUPERIOR DO TRABALHO', 'federal'],
    ['JUSTICA FEDERAL DE PRIMEIRA INSTANCIA', 'federal'],
    ['FUNDACAO NACIONAL DE SAUDE', 'federal'],
    ['CONSELHO REGIONAL DE FARMACIA', 'outro'],
    // Ambíguos: sem selo é melhor que o prazo de outro ente.
    ['SECRETARIA DE SAUDE', 'outro'],
    ['HOSPITAL DAS CLINICAS DA FACULDADE DE MEDICINA DE RPUSP', 'outro'],
    ['HOSPITAL REGIONAL DE ITABUNA', 'outro'],
    [null, 'outro'],
  ]) assert.equal(classificarPagador(orgao), esperado, String(orgao))
})

test('a chave da carga é a mesma da consulta (normalizeKey de src/lib/text.ts)', async () => {
  const { normalizeKey: doApp } = await import('../src/lib/text.ts')
  for (const nome of ['São João del-Rei', 'Pingo-d\'Água', ' Mãe d\'Água ', 'ITAPAJÉ', 'Westfália']) {
    assert.equal(normalizeKey(nome), doApp(nome), nome)
  }
})

test('localidade da emenda: município, estado e sem ente', async () => {
  const { lerLocalidade } = await import('../src/lib/capacidade-pagamento.ts')
  assert.deepEqual(lerLocalidade('SALVADOR - BA'), { uf: 'BA', municipio: 'SALVADOR' })
  assert.deepEqual(lerLocalidade('Embu/SP'), { uf: 'SP', municipio: 'Embu' })
  assert.deepEqual(lerLocalidade('Westfália (RS)'), { uf: 'RS', municipio: 'Westfália' })
  assert.deepEqual(lerLocalidade('BAHIA (UF)'), { uf: 'BA', municipio: null })
  assert.deepEqual(lerLocalidade('PARANÁ'), { uf: 'PR', municipio: null })
  assert.equal(lerLocalidade('MÚLTIPLO'), null)
  assert.equal(lerLocalidade('NACIONAL'), null)
  assert.equal(lerLocalidade(''), null)
})

test('frase do selo: com e sem período, sempre com a ressalva', async () => {
  const { textoPagometro, diasSelo } = await import('../src/lib/pagometro-texto.ts')
  const p = { dias: 8.7, saude: true, faixa: 'rapido', pagador: 'Salvador/BA', meses: 6, inicio: '2026-01-01', fim: '2026-06-01' }
  assert.equal(textoPagometro(p),
    'Salvador/BA: depois de reconhecer a nota (liquidação), paga fornecedores da Saúde em ~9 dias. '
    + 'Média de jan/2026 a jun/2026, pela contabilidade que o ente entrega ao Tesouro (Siconfi/MSC). '
    + 'Não inclui o tempo até o órgão atestar a entrega.')
  const semPeriodo = textoPagometro({ ...p, inicio: null, fim: null })
  assert.doesNotMatch(semPeriodo, /\.\s*,|\s,|\.\./, semPeriodo)
  assert.match(semPeriodo, /Não inclui o tempo até o órgão atestar a entrega\.$/)
  assert.equal(diasSelo(0.4), '<1d')
  assert.equal(diasSelo(12.4), '~12d')
  assert.match(textoPagometro({ ...p, fonte: 'portal', pagador: 'HOSPITAL NAVAL MARCILIO DIAS (UG 765720)' }),
    /pelos pagamentos registrados no Portal da Transparência \(CGU\)\. Não inclui/)
})

// ── Fase 2: federal ─────────────────────────────────────────────────────────────────

test('a esfera do PNCP vence o nome; sem esfera (ou N), vale o nome', () => {
  assert.equal(pagadorDe('HOSPITAL NOSSA SENHORA DA CONCEICAO S/A', 'F'), 'federal')
  assert.equal(pagadorDe('SECRETARIA DE SAUDE', 'E'), 'estado')
  assert.equal(pagadorDe('SECRETARIA DE SAUDE', 'M'), 'municipio')
  assert.equal(pagadorDe('SECRETARIA DE ESTADO DE SAUDE', 'D'), 'estado')
  assert.equal(pagadorDe('MUNICIPIO DE SALVADOR', null), 'municipio')
  assert.equal(pagadorDe('CONSELHO REGIONAL DE FARMACIA', 'N'), 'outro')
})

test('CSV do Portal: ponto e vírgula e aspas dentro do campo', () => {
  const r = lerCsv('"A";"B"\r\n"1";"texto; com ""aspas"""\r\n"curta"\r\n')
  assert.deepEqual(r, [{ A: '1', B: 'texto; com "aspas"' }])
})

// Um dia de arquivos, como a CGU publica (só as colunas que o cálculo lê).
const csvDia = ({ liqs = [], pags = [] }) => ({
  liquidacao: '"Código Liquidação";"Data Emissão";"Código Unidade Gestora";"Unidade Gestora";"Órgão"\n'
    + liqs.map((l) => `"${l.cod}";"${l.data}";"${l.ug}";"HOSPITAL ${l.ug}";"MS"`).join('\n'),
  liquidacaoEmpenhos: '"Código Liquidação";"Código Empenho";"Código Natureza Despesa Completa";"Valor Liquidado (R$)"\n'
    + liqs.map((l) => `"${l.cod}";"${l.emp}";"${l.nd ?? '33903000'}";"${l.valor}"`).join('\n'),
  pagamento: '"Código Pagamento";"Data Emissão";"Código Unidade Gestora";"Unidade Gestora";"Órgão"\n'
    + pags.map((p) => `"${p.cod}";"${p.data}";"${p.ug}";"HOSPITAL ${p.ug}";"MS"`).join('\n'),
  pagamentoEmpenhos: '"Código Pagamento";"Código Empenho";"Código Natureza Despesa Completa";"Valor Pago (R$)"\n'
    + pags.map((p) => `"${p.cod}";"${p.emp}";"${p.nd ?? '33903000'}";"${p.valor}"`).join('\n'),
})

test('federal: o pagamento quita a liquidação mais antiga do empenho (fila), dias ponderados pelo valor', () => {
  const filas = new Map()
  aplicarDia(filas, eventosDoDia(csvDia({ liqs: [{ cod: 'L1', data: '01/09/2026', ug: '250052', emp: 'E1', valor: '100,00' }] })))
  aplicarDia(filas, eventosDoDia(csvDia({ liqs: [
    { cod: 'L2', data: '05/09/2026', ug: '250052', emp: 'E1', valor: '50,00' },
    { cod: 'L3', data: '05/09/2026', ug: '250052', emp: 'E2', valor: '1.000,00', nd: '31901131' }, // folha: fora
  ] })))
  const m = aplicarDia(filas, eventosDoDia(csvDia({ pags: [
    { cod: 'P1', data: '10/09/2026', ug: '250052', emp: 'E1', valor: '120,00' },
    { cod: 'P2', data: '10/09/2026', ug: '250052', emp: 'E9', valor: '40,00' },   // sem liquidação conhecida
  ] })))
  const set = m.get('250052|2026-09')
  // 100 liquidados em 01/09 pagos em 10/09 (9 dias) + 20 dos de 05/09 (5 dias).
  assert.equal(set.pago, 120)
  assert.equal(set.pagoXdias, 100 * 9 + 20 * 5)
  assert.equal(set.semLiquidacao, 40)
  assert.deepEqual(filas.get('E1'), [{ data: '2026-09-05', saldo: 30, ug: '250052' }], 'sobram 30 da segunda')
  assert.equal(filas.has('E2'), false, 'folha não entra na fila')
})

test('federal: estorno de liquidação tira do fim da fila; pago no mesmo dia da liquidação = 0 dias', () => {
  const filas = new Map()
  aplicarDia(filas, eventosDoDia(csvDia({ liqs: [
    { cod: 'L1', data: '01/09/2026', ug: '1', emp: 'E1', valor: '100,00' },
    { cod: 'L2', data: '02/09/2026', ug: '1', emp: 'E1', valor: '50,00' },
    { cod: 'L3', data: '02/09/2026', ug: '1', emp: 'E1', valor: '-50,00' },
  ] })))
  assert.deepEqual(filas.get('E1'), [{ data: '2026-09-01', saldo: 100, ug: '1' }])
  const m = aplicarDia(filas, eventosDoDia(csvDia({
    liqs: [{ cod: 'L4', data: '03/09/2026', ug: '1', emp: 'E3', valor: '10,00' }],
    pags: [{ cod: 'P1', data: '03/09/2026', ug: '1', emp: 'E3', valor: '10,00' }],
  })))
  assert.equal(m.get('1|2026-09').pagoXdias, 0)
  assert.equal(filas.has('E3'), false)
})

test('federal: resumo descarta os meses do aquecimento e exige volume', () => {
  const mes = (ano, m, pago, pagoXdias, n = 30) => ({ ano, mes: m, pago, pagoXdias, semLiquidacao: 0, pagamentos: n })
  assert.equal(AQUECIMENTO_DIAS, 90)
  // Série começa em 01/07: o aquecimento vai até 29/09, então SETEMBRO TAMBÉM fica fora
  // (revisão da #57: cortar por "2025-09" deixava setembro inteiro entrar).
  const r = resumirUg([
    mes(2025, 7, 1e6, 1e6), mes(2025, 9, 1e6, 1e6),
    mes(2025, 10, 300e3, 300e3 * 6), mes(2025, 11, 300e3, 300e3 * 4),
  ], { inicioSerie: '2025-07-01' })
  assert.equal(r.dias, 5, 'só outubro e novembro: (6+4)/2')
  assert.equal(r.inicio, '2025-10-01')
  assert.equal(primeiroMesInteiroApos('2025-07-01', 90), '2025-10')
  assert.equal(primeiroMesInteiroApos('2025-07-03', 90), '2025-10', 'aquecimento acaba em 01/10: outubro já vale')
  assert.equal(primeiroMesInteiroApos('2025-07-04', 90), '2025-11')
  assert.equal(resumirUg([mes(2025, 10, 100e3, 100e3)], { inicioSerie: '2025-07-01' }).dias, null, 'pouco pago')
  assert.equal(resumirUg([mes(2025, 10, 900e3, 900e3, 5)], { inicioSerie: '2025-07-01' }).dias, null, 'poucos pagamentos')
})

test('federal: pagamento sem liquidação conhecida não conta para o mínimo de pagamentos (revisão da #57)', () => {
  const filas = new Map()
  aplicarDia(filas, eventosDoDia(csvDia({ liqs: [{ cod: 'L1', data: '01/10/2025', ug: '9', emp: 'E1', valor: '300.000,00' }] })))
  const pags = [{ cod: 'P0', data: '11/10/2025', ug: '9', emp: 'E1', valor: '300.000,00' }]
  for (let i = 1; i <= 19; i++) pags.push({ cod: `P${i}`, data: '11/10/2025', ug: '9', emp: `X${i}`, valor: '1.000,00' })
  const m = aplicarDia(filas, eventosDoDia(csvDia({ pags })))
  const out = m.get('9|2025-10')
  assert.equal(out.pagamentos, 1, 'só o que casou é observação')
  assert.equal(out.semLiquidacao, 19_000)
  assert.equal(resumirUg([out], { inicioSerie: '2025-01-01' }).dias, null, 'uma observação de R$ 300 mil não publica prazo')
})

test('PNCP ao vivo: a licitação normalizada traz esfera e unidade (revisão da #57)', async () => {
  const { normalizarLicitacao } = await import('../src/lib/pncp.ts')
  const lic = normalizarLicitacao({
    numeroControlePNCP: 'x', modalidadeNome: 'Pregão', objetoCompra: 'monitores', valorTotalEstimado: 1,
    dataPublicacaoPncp: '2026-10-01', situacaoCompraId: 1, situacaoCompraNome: 'Divulgada',
    orgaoEntidade: { cnpj: '00394544000185', razaoSocial: 'MINISTERIO DA SAUDE', poderId: 'E', esferaId: 'F' },
    unidadeOrgao: { codigoUnidade: '250052', nomeUnidade: 'INCA', municipioNome: 'Rio de Janeiro', ufSigla: 'RJ' },
  })
  assert.equal(lic.orgaoEntidade.esferaId, 'F')
  assert.equal(lic.codigoUnidade, '250052')
})

test('na tela: compra federal acha a UG pela UASG; sem UASG, sem selo; esfera decide antes do nome', async () => {
  const { IndicePagometro } = await import('../src/lib/pagometro.ts')
  const idx = new IndicePagometro()
  idx.addFederal({ ug: '250052', nome: 'INSTITUTO NACIONAL DO CANCER - RJ', dias: 4.8, meses: 9, mes_inicio: '2026-01-01', mes_fim: '2026-09-01' })
  idx.add({ ente_tipo: 'municipio', uf: 'RJ', municipio_key: 'RIO DE JANEIRO', municipio_nome: 'Rio de Janeiro', dias: 30, dias_saude: null, meses: 6, mes_inicio: null, mes_fim: null })
  const fed = idx.resolver('RJ', 'Rio de Janeiro', 'MINISTERIO DA SAUDE', { esfera: 'F', ug: '250052' })
  assert.equal(fed?.dias, 4.8)
  assert.equal(fed?.fonte, 'portal')
  assert.equal(fed?.pagador, 'INSTITUTO NACIONAL DO CANCER - RJ (UG 250052)')
  assert.equal(idx.resolver('RJ', 'Rio de Janeiro', 'MINISTERIO DA SAUDE', {}), null, 'federal sem UASG: sem selo, nunca o prazo da cidade')
  assert.equal(idx.resolver('RJ', 'Rio de Janeiro', 'SECRETARIA DE SAUDE', { esfera: 'M' })?.dias, 30, 'esfera M: a prefeitura')
})

/** Um zip de verdade, montado aqui: uma entrada "deflate" e uma "stored". */
function montarZip(arquivos) {
  const locais = [], centrais = []
  let ofs = 0
  for (const [nome, texto, comprimir] of arquivos) {
    const bruto = Buffer.from(texto, 'latin1')
    const dados = comprimir ? zlib.deflateRawSync(bruto) : bruto
    const n = Buffer.from(nome)
    const crc = zlib.crc32(bruto) >>> 0
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(comprimir ? 8 : 0, 8)
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(dados.length, 18); lh.writeUInt32LE(bruto.length, 22); lh.writeUInt16LE(n.length, 26)
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(comprimir ? 8 : 0, 10)
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(dados.length, 20); ch.writeUInt32LE(bruto.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(ofs, 42)
    locais.push(lh, n, dados); centrais.push(ch, n)
    ofs += 30 + n.length + dados.length
  }
  const central = Buffer.concat(centrais)
  const fim = Buffer.alloc(22); fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8)
  fim.writeUInt16LE(arquivos.length, 10); fim.writeUInt32LE(central.length, 12); fim.writeUInt32LE(ofs, 16)
  return Buffer.concat([...locais, central, fim])
}

test('zip: lê entrada comprimida e não comprimida; acha pelo fim do nome', () => {
  const zip = montarZip([
    ['20260930_Despesas_Liquidacao.csv', '"a";"b"\n"ção";"2"\n'.repeat(50), true],
    ['20260930_Despesas_Liquidacao_EmpenhosImpactados.csv', '"x"\n"1"\n', false],
  ])
  assert.equal(entradasZip(zip).length, 2)
  const r = lerDoZip(zip, ['_Despesas_Liquidacao.csv', '_Despesas_Liquidacao_EmpenhosImpactados.csv'])
  assert.equal(r.get('_Despesas_Liquidacao.csv').toString('latin1'), '"a";"b"\n"ção";"2"\n'.repeat(50))
  assert.equal(r.get('_Despesas_Liquidacao_EmpenhosImpactados.csv').toString('latin1'), '"x"\n"1"\n')
  assert.throws(() => entradasZip(Buffer.from('não é zip, só texto qualquer com mais de vinte e dois bytes')), /não é um arquivo zip/)
})

test('zip vindo de fora não é confiado: tetos, CRC, posições e tamanho mentiroso (revisão da #57)', () => {
  const texto = '"a";"b"\n'.repeat(2000)
  const base = () => montarZip([['x_Despesas_Liquidacao.csv', texto, true]])
  const suf = ['_Despesas_Liquidacao.csv']
  // Posição do diretório central: fim - 22 + 16; da entrada central: lida dali.
  const central = (z) => z.readUInt32LE(z.length - 22 + 16)

  const crcErrado = base(); crcErrado.writeUInt32LE(0xdeadbeef, central(crcErrado) + 16)
  assert.throws(() => lerDoZip(crcErrado, suf), /CRC não confere/)

  assert.throws(() => lerDoZip(base(), suf, { porEntrada: 1000, total: 1e9 }), /acima do teto/, 'teto por entrada, antes de descomprimir')
  assert.throws(() => lerDoZip(base(), suf, { porEntrada: 1e9, total: 1000 }), /no total, acima do teto/)

  const mentiroso = base(); mentiroso.writeUInt32LE(100, central(mentiroso) + 24) // declara 100 bytes; tem 16 mil
  assert.throws(() => lerDoZip(mentiroso, suf), /descompressão falhou|tamanho lido/, 'não descomprime além do declarado')

  const foraDoArquivo = base(); foraDoArquivo.writeUInt32LE(0x7fffffff, central(foraDoArquivo) + 42)
  assert.throws(() => lerDoZip(foraDoArquivo, suf), /fora do arquivo/)

  assert.equal(lerDoZip(base(), suf).get(suf[0]).toString('latin1'), texto, 'o íntegro continua passando')
})
