// Testes das peças jurídicas: prazo (a parte que não pode sair errada), validação,
// prompt e normalização da resposta da IA. Roda com `npm run pecas:teste`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  blocoPrazo, citacoesLiteraisDeLei, normalizarPeca, prazoDaPeca, promptDaPeca, sanearEntrada, validarEntrada,
  type PrazoPeca,
} from '../src/lib/pecas-juridicas'

const ok = (p: ReturnType<typeof prazoDaPeca>): PrazoPeca => {
  if ('erro' in p) throw new Error(`esperava prazo, veio erro: ${p.erro}`)
  return p
}

test('esclarecimento: 3 dias úteis ANTES da abertura (sexta 28/08 → terça 25/08)', () => {
  const p = ok(prazoDaPeca('esclarecimento', '2026-08-28', '2026-08-20'))
  assert.equal(p.limiteIso, '2026-08-25')
  assert.equal(p.diaSemana, 'terça-feira')
  assert.equal(p.situacao, 'aberto')
  assert.equal(p.diasUteisRestantes, 3) // 21, 24, 25
  assert.match(p.fundamento, /Art\. 164/)
})

test('esclarecimento: pula o feriado nacional (abertura 14/10 → 08/10, por causa do 12/10)', () => {
  // 13/10 (ter), 12/10 é feriado, 09/10 (sex), 08/10 (qui)
  const p = ok(prazoDaPeca('esclarecimento', '2026-10-14', '2026-10-01'))
  assert.equal(p.limiteIso, '2026-10-08')
})

test('recurso: 3 dias úteis DEPOIS da ata (sexta 02/10 → quarta 07/10)', () => {
  const p = ok(prazoDaPeca('recurso', '2026-10-02', '2026-10-05'))
  assert.equal(p.limiteIso, '2026-10-07')
  assert.equal(p.diaSemana, 'quarta-feira')
  assert.equal(p.diasUteisRestantes, 2)
  assert.ok(p.ressalvas.some((r) => /intenção de recorrer/.test(r)))
})

test('recurso: feriado no meio empurra o fim (ata 09/10 → 15/10)', () => {
  const p = ok(prazoDaPeca('recurso', '2026-10-09', '2026-10-09'))
  assert.equal(p.limiteIso, '2026-10-15')
})

test('recurso: Consciência Negra conta como feriado (ata 19/11/2026 → 25/11)', () => {
  const p = ok(prazoDaPeca('recurso', '2026-11-19', '2026-11-19'))
  assert.equal(p.limiteIso, '2026-11-25')
})

test('contrarrazões: mesmo prazo, contado da divulgação do recurso', () => {
  const p = ok(prazoDaPeca('contrarrazoes', '2026-10-02', '2026-10-02'))
  assert.equal(p.limiteIso, '2026-10-07')
  assert.match(p.fundamento, /§ 4º/)
})

test('situação: vence hoje e vencido', () => {
  const hoje = ok(prazoDaPeca('recurso', '2026-10-02', '2026-10-07'))
  assert.equal(hoje.situacao, 'vence-hoje')
  assert.equal(hoje.diasUteisRestantes, 0)
  const venceu = ok(prazoDaPeca('recurso', '2026-10-02', '2026-10-08'))
  assert.equal(venceu.situacao, 'vencido')
  assert.ok(venceu.diasUteisRestantes < 0)
})

test('datas inválidas ou no futuro viram erro, não prazo', () => {
  assert.ok('erro' in prazoDaPeca('recurso', '2026-02-31', '2026-10-05'))
  assert.ok('erro' in prazoDaPeca('recurso', '05/10/2026', '2026-10-05'))
  assert.ok('erro' in prazoDaPeca('recurso', '2026-10-06', '2026-10-05'))
  assert.ok('erro' in prazoDaPeca('contrarrazoes', '2026-10-06', '2026-10-05'))
  // Esclarecimento é sobre o futuro: abertura depois de hoje é o caso normal.
  assert.ok(!('erro' in prazoDaPeca('esclarecimento', '2026-10-20', '2026-10-05')))
})

const EDITAL = 'EDITAL DE PREGÃO ELETRÔNICO Nº 12/2026. '.repeat(10)

test('validação: edital, decisão e recurso obrigatórios onde a peça precisa', () => {
  assert.equal(validarEntrada({ tipo: 'esclarecimento', edital: 'curto' }), 'Envie o edital antes de gerar a peça.')
  assert.equal(validarEntrada({ tipo: 'esclarecimento', edital: EDITAL }), null)
  assert.match(validarEntrada({ tipo: 'recurso', edital: EDITAL, documento: 'inabilitado' }) ?? '', /decisão/)
  assert.match(validarEntrada({ tipo: 'contrarrazoes', edital: EDITAL }) ?? '', /recurso do concorrente/)
  assert.equal(validarEntrada({ tipo: 'recurso', edital: EDITAL, documento: 'x'.repeat(100), alvo: 'minha-inabilitacao' }), null)
  assert.equal(validarEntrada({ tipo: 'peticao' as never, edital: EDITAL }), 'Escolha a peça.')
  assert.equal(validarEntrada({ tipo: 'recurso', edital: EDITAL, documento: 'x'.repeat(100), alvo: 'qualquer' as never }), 'Escolha contra o quê é o recurso.')
})

test('prompt: leva o prazo pronto, a lista de artigos e as partes', () => {
  const prazo = ok(prazoDaPeca('recurso', '2026-10-02', '2026-10-05'))
  const { system, user } = promptDaPeca({
    tipo: 'recurso', edital: EDITAL, documento: 'O pregoeiro inabilitou a empresa por falta de atestado.',
    alvo: 'minha-inabilitacao', intencaoManifestada: true,
    empresa: { razaoSocial: 'Hospmult Ltda', cnpj: '12.345.678/0001-90' },
  }, prazo, { iso: '2026-10-05', extenso: 'segunda-feira, 05 de outubro de 2026' })
  assert.match(system, /07\/10\/2026 \(quarta-feira\)/)
  assert.match(system, /Art\. 165/)
  assert.match(system, /Hospmult Ltda, CNPJ 12\.345\.678\/0001-90/)
  assert.match(system, /INABILITADA/)
  assert.match(system, /SIM, o usuário confirmou/)
  assert.match(system, /Não cite jurisprudência/)
  assert.match(user, /DECISÃO RECORRIDA/)
})

test('prompt: sem empresa, sem data e sem intenção, deixa marcadores para o usuário', () => {
  const { system } = promptDaPeca({
    tipo: 'recurso', edital: EDITAL, documento: 'x'.repeat(100),
  }, null, { iso: '2026-10-05', extenso: 'segunda' })
  assert.match(system, /\[RAZÃO SOCIAL\], CNPJ \[CNPJ\]/)
  assert.match(system, /\[conferir: protocolado dentro do prazo do art\. 165, I\]/)
  assert.match(system, /NÃO CONFIRMADA/)
})

test('prompt: esclarecimento sem dúvidas pede para a IA apontar os pontos ambíguos', () => {
  const { user } = promptDaPeca({ tipo: 'esclarecimento', edital: EDITAL }, null, { iso: '2026-10-05', extenso: 'x' })
  assert.match(user, /não listou dúvidas/)
  assert.ok(!/DÚVIDAS DO USUÁRIO/.test(user))
})

test('blocoPrazo: avisa quando já venceu', () => {
  const p = ok(prazoDaPeca('recurso', '2026-10-02', '2026-10-09'))
  assert.match(blocoPrazo('recurso', p), /JÁ VENCEU/)
})

test('normalização: resposta incompleta não vira peça; campos ruins viram lista vazia', () => {
  assert.equal(normalizarPeca('recurso', null, null), null)
  assert.equal(normalizarPeca('recurso', { minuta: 'curta' }, null), null)
  const p = normalizarPeca('recurso', {
    minuta: 'A'.repeat(300),
    teses: [{ tese: 'Formalismo moderado', fundamento: 'art. 12, III' }, { tese: '' }, 'lixo', null],
    pendencias: ['Nº do processo', '', null],
  }, null)
  assert.ok(p)
  assert.deepEqual(p.teses, [{ tese: 'Formalismo moderado', fundamento: 'art. 12, III' }])
  assert.deepEqual(p.pendencias, ['Nº do processo'])
  const semListas = normalizarPeca('esclarecimento', { minuta: 'B'.repeat(300), teses: 'x' }, null)
  assert.deepEqual(semListas?.teses, [])
  assert.deepEqual(semListas?.pendencias, [])
})

test('saneamento: campo de tipo errado vira ausente, não derruba o prompt', () => {
  const e = sanearEntrada({ tipo: 'recurso', edital: EDITAL, documento: 123, argumentos: ['x'], alvo: 5, intencaoManifestada: 'sim', empresa: { razaoSocial: 42, cnpj: '1' } })
  assert.equal(e.documento, undefined)
  assert.equal(e.argumentos, undefined)
  assert.equal(e.alvo, undefined)
  assert.equal(e.intencaoManifestada, false)
  assert.deepEqual(e.empresa, { razaoSocial: undefined, cnpj: '1' })
  assert.match(validarEntrada(e) ?? '', /decisão/)
  assert.equal(sanearEntrada({}).edital, '')
})

test('prompt: o resumo dos artigos não pode virar citação literal', () => {
  const { system } = promptDaPeca({ tipo: 'contrarrazoes', edital: EDITAL, documento: 'x'.repeat(100) }, null, { iso: '2026-10-05', extenso: 'x' })
  assert.match(system, /nunca ponha esse resumo entre aspas/)
  assert.match(system, /Não presuma o gênero/)
  assert.match(system, /só do PREÇO; diligência sobre documento de habilitação é o art\. 64/)
})

test('citação de lei entre aspas vira pendência; trecho do edital entre aspas não', () => {
  const minuta = [
    'O edital exige, no item 9.4.2, "atestado(s) de capacidade técnica que comprove(m) o fornecimento de 20 monitores".',
    '"Erros ou falhas que não alterem a substância dos documentos podem ser sanados, por despacho fundamentado" (Art. 64, §1º, da Lei 14.133/2021).',
    'O art. 12, III, estabelece que “o desatendimento de exigências meramente formais não importa afastamento”.',
    'Nos termos do art. 165, I, o prazo é de 3 dias úteis.',
  ].join('\n')
  assert.deepEqual(citacoesLiteraisDeLei(minuta), ['art. 12', 'art. 64'])
  const p = normalizarPeca('recurso', { minuta: minuta + ' '.repeat(200) + 'fim', pendencias: ['Nº do processo'] }, null)
  assert.equal(p?.pendencias.length, 2)
  assert.match(p!.pendencias[1], /art\. 12, art\. 64 da Lei 14\.133/)
  assert.deepEqual(citacoesLiteraisDeLei('Conforme o art. 64, § 1º, a falha pode ser sanada. O item 3 diz "entrega em 30 dias".'), [])
  // Formas que o GLM escreveu de verdade: o ponto de "14.133" não pode cortar a busca.
  assert.deepEqual(citacoesLiteraisDeLei('Conforme estabelece o art. 64, § 1º, da Lei 14.133/2021, "erros ou falhas que não alterem a substância".'), ['art. 64'])
  assert.deepEqual(citacoesLiteraisDeLei('o art. 59, § 2º, da Lei nº 14.133/2021, prevê que "a Administração pode fazer diligência".'), ['art. 59'])
  // Aspa depois de "item" ou "edital" é citação do edital.
  assert.deepEqual(citacoesLiteraisDeLei('nos termos do art. 165 e do item 10 do edital, "qualquer licitante poderá manifestar".'), [])
})
