// Testes das peças jurídicas: prazo (a parte que não pode sair errada), validação,
// prompt e normalização da resposta da IA. Roda com `npm run pecas:teste`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  blocoPrazo, citacoesLiteraisDeLei, conferirReferencias, inserirTempestividade, MARCADOR_TEMPESTIVIDADE,
  normalizarPeca, prazoDaPeca, promptDaPeca, sanearEntrada, textoTempestividade, validarEntrada,
  type ContextoConferencia,
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
  // O prazo NÃO vai para o prompt: quem escreve a tempestividade é o servidor.
  assert.ok(!system.includes('07/10/2026'))
  assert.ok(system.includes(MARCADOR_TEMPESTIVIDADE))
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
  assert.match(system, /NÃO CONFIRMADA pelo usuário/)
})

test('prompt: esclarecimento sem dúvidas pede para a IA apontar os pontos ambíguos', () => {
  const { user } = promptDaPeca({ tipo: 'esclarecimento', edital: EDITAL }, null, { iso: '2026-10-05', extenso: 'x' })
  assert.match(user, /não listou dúvidas/)
  assert.ok(!/DÚVIDAS DO USUÁRIO/.test(user))
})

test('blocoPrazo: avisa quando já venceu e nunca entrega a data ao modelo', () => {
  const p = ok(prazoDaPeca('recurso', '2026-10-02', '2026-10-09'))
  assert.match(blocoPrazo(p), /JÁ VENCEU/)
  assert.ok(!blocoPrazo(p).includes(p.limiteBR))
  assert.ok(!/VENCEU/.test(blocoPrazo(ok(prazoDaPeca('recurso', '2026-10-02', '2026-10-05')))))
})

const ctx = (c: Partial<ContextoConferencia> = {}): ContextoConferencia => ({ prazo: null, fontes: EDITAL, hojeIso: '2026-10-05', ...c })

test('normalização: resposta incompleta não vira peça; campos ruins viram lista vazia', () => {
  assert.equal(normalizarPeca('recurso', null, ctx()), null)
  assert.equal(normalizarPeca('recurso', { minuta: 'curta' }, ctx()), null)
  const p = normalizarPeca('recurso', {
    minuta: 'A'.repeat(300),
    teses: [{ tese: 'Formalismo moderado', fundamento: 'art. 12, III' }, { tese: '' }, 'lixo', null],
    pendencias: ['Nº do processo', '', null],
  }, ctx({ intencaoManifestada: true }))
  assert.ok(p)
  assert.deepEqual(p.teses, [{ tese: 'Formalismo moderado', fundamento: 'art. 12, III' }])
  assert.deepEqual(p.pendencias, ['Nº do processo'])
  const semListas = normalizarPeca('esclarecimento', { minuta: 'B'.repeat(300), teses: 'x' }, ctx())
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
  const p = normalizarPeca('recurso', { minuta: minuta + ' '.repeat(200) + 'fim', pendencias: ['Nº do processo'] }, ctx({ intencaoManifestada: true }))
  assert.equal(p?.pendencias.length, 2)
  assert.match(p!.pendencias[1], /art\. 12, art\. 64 da Lei 14\.133/)
  assert.deepEqual(citacoesLiteraisDeLei('Conforme o art. 64, § 1º, a falha pode ser sanada. O item 3 diz "entrega em 30 dias".'), [])
  // Formas que o GLM escreveu de verdade: o ponto de "14.133" não pode cortar a busca.
  assert.deepEqual(citacoesLiteraisDeLei('Conforme estabelece o art. 64, § 1º, da Lei 14.133/2021, "erros ou falhas que não alterem a substância".'), ['art. 64'])
  assert.deepEqual(citacoesLiteraisDeLei('o art. 59, § 2º, da Lei nº 14.133/2021, prevê que "a Administração pode fazer diligência".'), ['art. 59'])
  // Aspa depois de "item" ou "edital" é citação do edital.
  assert.deepEqual(citacoesLiteraisDeLei('nos termos do art. 165 e do item 10 do edital, "qualquer licitante poderá manifestar".'), [])
})

// ── Revisão da #60 ────────────────────────────────────────────────────────────

const PRAZO_ABERTO = ok(prazoDaPeca('recurso', '2026-10-02', '2026-10-05'))   // limite 07/10
const PRAZO_VENCIDO = ok(prazoDaPeca('recurso', '2026-10-02', '2026-10-09'))

test('tempestividade: o texto é do servidor, com a data calculada', () => {
  const t = textoTempestividade('recurso', PRAZO_ABERTO, true)
  assert.match(t, /contado de 02\/10\/2026, encerra-se em 07\/10\/2026 \(quarta-feira\)/)
  assert.match(t, /intenção de recorrer foi manifestada/)
  assert.match(textoTempestividade('recurso', PRAZO_ABERTO, false), /\[conferir: intenção de recorrer/)
  assert.match(textoTempestividade('esclarecimento', ok(prazoDaPeca('esclarecimento', '2026-10-20', '2026-10-05'))),
    /sessão, marcada para 20\/10\/2026, encerra-se em 15\/10\/2026/)
  assert.match(textoTempestividade('contrarrazoes', null), /\[conferir: protocolado dentro do prazo do art\. 165, § 4º/)
  // Vencido: NÃO diz que é tempestivo.
  const v = textoTempestividade('recurso', PRAZO_VENCIDO, true)
  assert.match(v, /^\[ATENÇÃO: .*o prazo terminou em 07\/10\/2026/)
  assert.ok(!/(?<!in)tempestiv[oa]s?\b/i.test(v))
})

test('tempestividade: marcador, seção com texto na linha, parágrafo abaixo do título, nada', () => {
  const P = 'PARAGRAFO-DO-SERVIDOR'
  assert.deepEqual(inserirTempestividade(`1. TEMPESTIVIDADE\n${MARCADOR_TEMPESTIVIDADE}\n\n2. FATOS\nx\n${MARCADOR_TEMPESTIVIDADE}`, P),
    { minuta: `1. TEMPESTIVIDADE\n${P}\n\n2. FATOS\nx\n`, como: 'marcador' })
  // A IA ignorou o marcador: o texto DELA, com a data errada, é trocado.
  assert.deepEqual(inserirTempestividade('Tempestividade: tempestivo até 30/10/2026.\nResto', P),
    { minuta: `Tempestividade: ${P}\nResto`, como: 'secao' })
  assert.deepEqual(inserirTempestividade('1. TEMPESTIVIDADE\nAs razões vencem em 30/10/2026.\nsegunda linha\n2. SÍNTESE DOS FATOS\nfatos', P),
    { minuta: `1. TEMPESTIVIDADE\n${P}\n2. SÍNTESE DOS FATOS\nfatos`, como: 'secao' })
  assert.deepEqual(inserirTempestividade('I - DA TEMPESTIVIDADE\n\nAs razões vencem em 30/10.\n\nII - DOS FATOS', P),
    { minuta: `I - DA TEMPESTIVIDADE\n\n${P}\n\nII - DOS FATOS`, como: 'secao' })
  assert.equal(inserirTempestividade('Sem seção nenhuma aqui.', P).como, 'nenhum')
})

const MINUTA_BASE = 'RECURSO ADMINISTRATIVO\n\n1. TEMPESTIVIDADE\n' + MARCADOR_TEMPESTIVIDADE + '\n\n2. RAZÕES\nNos termos do art. 64, § 1º, e do art. 12, III, a falha é sanável.\n' + 'x'.repeat(200)

test('conferência: a tempestividade da minuta final tem a data do servidor', () => {
  const p = normalizarPeca('recurso', { minuta: MINUTA_BASE }, ctx({ prazo: PRAZO_ABERTO, intencaoManifestada: true }))!
  assert.ok(p.minuta.includes('encerra-se em 07/10/2026 (quarta-feira)'))
  assert.ok(!p.minuta.includes(MARCADOR_TEMPESTIVIDADE))
  assert.deepEqual(p.alertas, [])
  // A IA escreveu a própria tempestividade com data errada: é trocada pela do servidor.
  const errada = MINUTA_BASE.replace(MARCADOR_TEMPESTIVIDADE, 'As razões são tempestivas, pois o prazo vence em 30/10/2026.')
  const q = normalizarPeca('recurso', { minuta: errada }, ctx({ prazo: PRAZO_ABERTO, intencaoManifestada: true }))!
  assert.ok(!q.minuta.includes('30/10/2026'))
  assert.ok(q.minuta.includes('07/10/2026'))
  assert.deepEqual(q.alertas, [])
})

test('conferência: sem seção de tempestividade, avisa e dá o texto certo', () => {
  const sem = 'RECURSO\nAs razões são tempestivas até 30/10/2026.\n' + 'x'.repeat(250)
  const p = normalizarPeca('recurso', { minuta: sem }, ctx({ prazo: PRAZO_ABERTO, intencaoManifestada: true }))!
  assert.ok(p.alertas.some((a) => /não deixou a seção de tempestividade/.test(a) && a.includes('07/10/2026')))
  assert.ok(p.alertas.some((a) => /30\/10\/2026, que não aparece/.test(a)), 'data inventada é apontada')
})

test('conferência: prazo vencido e a IA diz "tempestivo" em outro ponto', () => {
  const m = MINUTA_BASE + '\nO presente recurso é tempestivo e deve ser conhecido.'
  const p = normalizarPeca('recurso', { minuta: m }, ctx({ prazo: PRAZO_VENCIDO, intencaoManifestada: true }))!
  assert.match(p.minuta, /\[ATENÇÃO: .*terminou em 07\/10\/2026/)
  assert.ok(p.alertas.some((a) => /diz em outro ponto que a peça é tempestiva/.test(a)))
  // "intempestivo" não conta.
  const r = normalizarPeca('recurso', { minuta: MINUTA_BASE + '\nNão se trata de recurso intempestivo.' }, ctx({ prazo: PRAZO_VENCIDO, intencaoManifestada: true }))!
  assert.ok(!r.alertas.some((a) => /tempestiva/.test(a)))
})

test('conferência: artigo inventado, jurisprudência e norma fora do edital viram alerta', () => {
  const m = MINUTA_BASE + '\nConforme o art. 72-B e os arts. 62 a 70, e o Acórdão TCU nº 1.234/2023, além da Lei 8.666/1993 e da Súmula 222.'
  const p = normalizarPeca('recurso', {
    minuta: m, teses: [{ tese: 'Tese', fundamento: 'art. 17, § 1º' }],
  }, ctx({ prazo: PRAZO_ABERTO, intencaoManifestada: true }))!
  const tudo = p.alertas.join('\n')
  assert.match(tudo, /cita art\. 17, art\. 62, art\. 70 e art\. 72-B, fora da lista/)
  assert.match(tudo, /Lei 8\.666/)
  assert.match(tudo, /jurisprudência \("Acórdão" e "Súmula"\)/)
  assert.ok(!/art\. 64|art\. 12\b|art\. 165/.test(tudo.split('fora da lista')[0]), 'os da lista não entram')
})

test('conferência: o que o próprio edital cita pode ser citado', () => {
  const fontes = EDITAL + ' Nos termos do art. 17, § 1º, e do art. 43 da Lei Complementar nº 123/2006. A data do edital é 12/09/2026.'
  const ref = conferirReferencias('Pelo art. 17 e pelo art. 43 da LC 123, conforme o art. 5º da Lei nº 14.133/2021.', fontes)
  assert.deepEqual(ref, { artigosForaDaLista: [], normasNaoConferidas: [], jurisprudencia: [] })
  const p = normalizarPeca('esclarecimento', { minuta: 'PEDIDO\nTempestividade: ' + MARCADOR_TEMPESTIVIDADE + '\nO edital de 12/09/2026 diz.\n' + 'x'.repeat(200) },
    ctx({ fontes, prazo: ok(prazoDaPeca('esclarecimento', '2026-10-20', '2026-10-05')) }))!
  assert.deepEqual(p.alertas, [], 'data e artigos tirados do edital não são alerta')
})

test('conferência: recurso sem a intenção confirmada vira pendência', () => {
  const p = normalizarPeca('recurso', { minuta: MINUTA_BASE }, ctx({ prazo: PRAZO_ABERTO, intencaoManifestada: false }))!
  assert.ok(p.pendencias.some((x) => /intenção de recorrer/.test(x)))
  assert.match(p.minuta, /\[conferir: intenção de recorrer/)
})

test('conferência: palavra comum não vira jurisprudência', () => {
  // "resposta" era lido como "REsp" numa minuta real do GLM.
  const ref = conferirReferencias('Solicita-se a resposta no sítio oficial, com respaldo no art. 164 e sem precedência de prazo.', EDITAL)
  assert.deepEqual(ref.jurisprudencia, [])
  assert.deepEqual(conferirReferencias('Conforme o REsp 1.234 e os acórdãos do TCU.', EDITAL).jurisprudencia, ['REsp', 'acórdãos'])
})

// ── Travas da rota (revisão da #60) ───────────────────────────────────────────

test('assinatura: trial vencido, cancelada e expirada não geram peça; master e inadimplente sim', async () => {
  const { assinaturaPermiteUso } = await import('../src/lib/plano-gating')
  const hoje = '2026-10-05'
  assert.equal(assinaturaPermiteUso({ status: 'trial', expiraEm: '2026-10-04' }, hoje), false)
  assert.equal(assinaturaPermiteUso({ status: 'trial', expiraEm: '2026-10-05' }, hoje), true, 'vence hoje ainda vale')
  assert.equal(assinaturaPermiteUso({ status: 'cancelada' }, hoje), false)
  assert.equal(assinaturaPermiteUso({ status: 'expirada' }, hoje), false)
  assert.equal(assinaturaPermiteUso({ status: 'inadimplente' }, hoje), true)
  assert.equal(assinaturaPermiteUso({ status: 'ativa' }, hoje), true)
  assert.equal(assinaturaPermiteUso({ role: 'master', status: 'cancelada' }, hoje), true)
})

test('vaga: uma redação por conta ao mesmo tempo, devolvida no fim', async () => {
  const { ocuparVaga, liberarVaga } = await import('../src/lib/rate-limit')
  assert.equal(await ocuparVaga('peca:teste@x', 1, 60_000), true)
  assert.equal(await ocuparVaga('peca:teste@x', 1, 60_000), false, 'a segunda espera')
  assert.equal(await ocuparVaga('peca:outra@x', 1, 60_000), true, 'outra conta não espera')
  await liberarVaga('peca:teste@x')
  assert.equal(await ocuparVaga('peca:teste@x', 1, 60_000), true, 'liberada, volta a valer')
  await liberarVaga('peca:teste@x')
  // Instância que morreu sem liberar: o TTL devolve a vaga.
  assert.equal(await ocuparVaga('peca:ttl@x', 1, 30), true)
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(await ocuparVaga('peca:ttl@x', 1, 30), true)
})
