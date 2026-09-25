import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { ClienteComprasgov, normalizarMensagem, hashMensagem, dataUTC, retryAfterSegundos } from './connector-comprasgov-api.mjs'
import { validarChaveCompra, linkComprasgovValido } from '../../src/lib/radar/comprasgov-identidade.mjs'
import { gravarPagina, tomarProximo, destinatariosDoAlerta } from './comprasgov-persistencia.mjs'

const chave = '07000505000032026'
const id = '312871a5-e26b-49da-a1ee-b9fbc855a265'
const origem = { chaveCompra: { numeroUasg: 70005, idModalidade: 5, numero: 3, ano: 2026 }, chaveMensagem: id,
  texto: 'Envie a proposta até o prazo indicado.', categoria: '8', tipoRemetente: '3', identificadorItem: 'G1', dataHora: '2026-09-23 14:30:11.271' }
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const token = () => json({ access_token: 'token-de-teste', expires_in: 3600 })
function clienteCom(respostas, extra = {}) {
  const chamadas = []
  const cliente = new ClienteComprasgov({ key: 'key-teste', secret: 'secret-teste', ...extra, fetchImpl: async (url, opts) => {
    chamadas.push({ url: String(url), opts })
    const resposta = respostas.shift()
    assert.ok(resposta, 'requisição inesperada')
    return resposta
  } })
  return { cliente, chamadas }
}

test('identidade SIASG e origem oficial não aceitam PNCP, modalidade PNCP ou host disfarçado', () => {
  assert.equal(validarChaveCompra(chave), chave)
  for (const v of ['7000505000032026', '07000508000032026', '07000505000002026', '123-1-000001/2026', '00000005000032026']) assert.throws(() => validarChaveCompra(v))
  assert.ok(linkComprasgovValido('https://cnetmobile.estaleiro.comprasnet.gov.br/compra'))
  for (const v of ['https://comprasnet.gov.br.evil.test', 'https://evil.test/?comprasnet.gov.br', 'https://a@comprasnet.gov.br', 'javascript:alert(1)', 'http://comprasnet.gov.br']) assert.equal(linkComprasgovValido(v), false)
})

test('datas UTC são independentes do fuso do coletor e dedup isola tenant/processo/canal', () => {
  assert.equal(dataUTC(origem.dataHora), '2026-09-23T14:30:11.271Z')
  assert.equal(dataUTC('2026-09-23T11:30:11.271-03:00'), dataUTC(origem.dataHora))
  assert.throws(() => dataUTC('amanhã'))
  const hashes = [['a','p','chat'], ['b','p','chat'], ['a','q','chat'], ['a','p','diligencias']].map((a) => hashMensagem(...a, id))
  assert.equal(new Set(hashes).size, 4)
  const m = normalizarMensagem(origem, chave, 'diligencias')
  assert.equal(m.lote, 'G1'); assert.equal(m.autor, 'Pregoeiro'); assert.ok(m.categorias.includes('diligencia'))
  assert.throws(() => normalizarMensagem({ ...origem, chaveCompra: { ...origem.chaveCompra, numero: 4 } }, chave, 'chat'))
})

test('OAuth, paginação 206, filtro UTC e endpoint de diligências seguem o contrato publicado', async () => {
  const { cliente, chamadas } = clienteCom([token(), json([origem], 206), json([])])
  const primeira = await cliente.pagina({ chave, canal: 'diligencias', desde: '2026-09-20T10:00:00.000Z' })
  assert.equal(primeira.parcial, true)
  assert.equal(primeira.mensagens[0].id, id)
  const segunda = await cliente.pagina({ chave, canal: 'diligencias', pagina: 1, desde: '2026-09-20T10:00:00.000Z' })
  assert.equal(segunda.parcial, false)
  assert.equal(chamadas.length, 3)
  assert.equal(chamadas[0].opts.body, 'grant_type=client_credentials')
  const url = new URL(chamadas[1].url)
  assert.ok(url.pathname.endsWith(`/chat/${chave}/diligencias`))
  assert.equal(url.searchParams.get('desde'), '2026-09-20T10:00:00.000')
  assert.equal(url.searchParams.get('ordem'), 'asc')
  assert.equal(new URL(chamadas[2].url).searchParams.get('page'), '1')
  assert.equal(chamadas[1].opts.redirect, 'error')
})

test('401 renova uma vez; tentativa e repetição consomem orçamento', async () => {
  const { cliente } = clienteCom([token(), json({},401), token(), json([origem])])
  await cliente.pagina({ chave, canal: 'chat' })
  assert.equal(cliente.requests, 2)
  const limitado = clienteCom([token(), json({},401)], { maxRequests: 1 })
  await assert.rejects(limitado.cliente.pagina({ chave, canal: 'chat' }), /Limite de consultas/)
  assert.equal(limitado.chamadas.length, 2)
})

test('404 fica explícito e conta no orçamento; 403/429/502 não viram vazio saudável', async () => {
  const { cliente } = clienteCom([token(), json({},404)])
  assert.equal((await cliente.pagina({ chave, canal: 'chat' })).naoEncontrado, true)
  assert.equal(cliente.requests, 1)
  for (const status of [403, 429, 502]) {
    const c = clienteCom([token(), json({},status, { 'retry-after': '900' })])
    await assert.rejects(c.cliente.pagina({ chave, canal: 'chat' }), (e) => e.status === status && e.retryAfter === 900)
    assert.equal(c.chamadas.length, 2)
  }
  assert.equal(retryAfterSegundos('Wed, 23 Sep 2026 10:15:00 GMT', Date.parse('2026-09-23T10:00:00Z')), 900)
})

test('HTML, envelope inesperado, página parcial vazia e mensagem de outra compra falham', async () => {
  for (const r of [new Response('<html>login</html>'), json({ error: 'bloqueio' }), json([],206), json([{ ...origem, chaveMensagem: null }]), json([{ ...origem, chaveCompra: null }])]) {
    await assert.rejects(clienteCom([token(), r]).cliente.pagina({ chave, canal: 'chat' }))
  }
})

test('raw guarda só a allowlist, com teto de tamanho (revisão da #39)', async () => {
  const { rawMinimo, CAMPOS_RAW } = await import('./connector-comprasgov-api.mjs')
  const payload = { ...origem, cpfPregoeiro: '12345678900', emailFornecedor: 'x@y.com', anexos: [{ nome: 'a.pdf' }],
    dataHora: '2026-09-23 14:30:11.271', identificadorItem: 'G'.repeat(500), futuro: { qualquer: 'coisa' } }
  const m = normalizarMensagem(payload, chave, 'chat')
  assert.deepEqual(Object.keys(m.raw).sort(), ['chaveCompra', ...CAMPOS_RAW].sort())
  for (const fora of ['cpfPregoeiro', 'emailFornecedor', 'anexos', 'futuro', 'texto']) assert.equal(fora in m.raw, false, `${fora} não pode ir para o raw`)
  assert.equal(m.raw.identificadorItem.length, 120)
  assert.equal(m.raw.chaveCompra, chave)
  assert.deepEqual(rawMinimo({ categoria: { aninhado: 1 } }, chave), { chaveCompra: chave }, 'objeto aninhado não entra')
})

test('alerta vai para o e-mail do titular, nunca para um id (revisão da #39)', () => {
  // Era `job.user_id`: o worker usava o id como endereço `to`.
  assert.deepEqual(destinatariosDoAlerta({ titular_id: 'u-123', user_id: 'u-456', email_titular: 'Compras@Empresa.com.br' }),
    { email: 'compras@empresa.com.br', app: 'compras@empresa.com.br' })
  // Sem e-mail válido não há alerta por e-mail — o aviso no app continua, ao titular.
  for (const email_titular of [null, '', 'u-123', 'sem-arroba.com', 'a@b']) {
    assert.deepEqual(destinatariosDoAlerta({ titular_id: 'u-123', user_id: 'u-456', email_titular }), { email: null, app: 'u-123' })
  }
})

test('transações reais: retomada de página, rollback, dedup e isolamento por tenant', {
  skip: process.env.RADAR_COMPRASGOV_TEST_DB !== '1' ? 'Defina RADAR_COMPRASGOV_TEST_DB=1 e DATABASE_URL para testar em tabelas TEMP.' : false,
}, async () => {
  const { novoClient } = await import('../lib/pg-ssl.mjs')
  const banco = novoClient()
  await banco.connect()
  try {
    // Somente tabelas temporárias nesta conexão. Nenhuma linha real é tocada,
    // nem a sequência de mensagens de produção é incrementada.
    await banco.query("SET search_path TO pg_temp, public")
    for (const tabela of ['radar_processos', 'radar_mensagens', 'radar_notificacoes']) {
      await banco.query(`CREATE TEMP TABLE ${tabela} (LIKE public.${tabela} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`)
    }
    await banco.query("CREATE TEMP SEQUENCE radar_test_message_seq; ALTER TABLE radar_mensagens ALTER COLUMN id SET DEFAULT nextval('pg_temp.radar_test_message_seq')")
    const schema = (await fs.readFile(new URL('../../db/schema-radar-comprasgov.sql', import.meta.url), 'utf8')).replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMP TABLE IF NOT EXISTS')
    await banco.query(schema)
    for (const tenant of ['teste-a', 'teste-b']) {
      await banco.query(`INSERT INTO radar_processos(id,titular_id,user_id,conector_id,cnpj,licitacao_id,titulo,origem)
        VALUES ($1,$2,$2,'comprasgov','00000000000000',$3,'Compra de teste','manual')`, [tenant, tenant, chave])
      await banco.query(`INSERT INTO radar_comprasgov_canais(processo_id,canal,ambiente,chave_compra,lease_id,lease_ate)
        VALUES ($1,'chat','producao',$2,'lease',now()+interval '3 minutes')`, [tenant,chave])
    }
    await banco.query('UPDATE radar_comprasgov_canais SET lease_id=NULL,lease_ate=NULL')
    assert.equal(await tomarProximo(banco, 'homologacao', 'lease'), null)
    const primeiro = await tomarProximo(banco, 'producao', 'lease')
    const segundo = await tomarProximo(banco, 'producao', 'lease')
    assert.notEqual(primeiro.processo_id, segundo.processo_id)
    assert.equal(await tomarProximo(banco, 'producao', 'outro-lease'), null)
    const job = (tenant) => ({ processo_id: tenant, titular_id: tenant, user_id: tenant, canal: 'chat', lease_id: 'lease', cnpj: '00000000000000', licitacao_id: chave, titulo: 'Teste', link_portal: null })
    const mensagem = normalizarMensagem(origem, chave, 'chat')
    const resultado = { mensagens: [mensagem], parcial: true, naoEncontrado: false }
    await gravarPagina(banco, job('teste-a'), resultado)
    let row = (await banco.query("SELECT * FROM radar_comprasgov_canais WHERE processo_id='teste-a'")).rows[0]
    assert.equal(row.proxima_pagina, 1); assert.equal(row.desde, null); assert.equal(row.status, 'paginando')
    assert.equal(row.inicializado, false); assert.equal(row.verificado_em, null)
    const renovar = () => banco.query("UPDATE radar_comprasgov_canais SET lease_id='lease',lease_ate=now()+interval '3 minutes' WHERE processo_id='teste-a'")
    await renovar()
    const quebrado = { query: (sql, params) => sql.includes('INSERT INTO radar_notificacoes') ? Promise.reject(new Error('falha de teste')) : banco.query(sql, params) }
    await assert.rejects(gravarPagina(quebrado, job('teste-a'), { mensagens: [{ ...mensagem, id: 'outro-id' }], parcial: false }), /falha de teste/)
    assert.equal((await banco.query('SELECT count(*)::int n FROM radar_mensagens')).rows[0].n, 1)
    row = (await banco.query("SELECT * FROM radar_comprasgov_canais WHERE processo_id='teste-a'")).rows[0]
    assert.equal(row.proxima_pagina, 1); assert.equal(row.desde, null)
    await gravarPagina(banco, job('teste-a'), { ...resultado, parcial: false })
    row = (await banco.query("SELECT * FROM radar_comprasgov_canais WHERE processo_id='teste-a'")).rows[0]
    assert.equal(row.proxima_pagina, 0); assert.equal(row.status, 'ok'); assert.equal(row.inicializado, true)
    assert.equal(new Date(row.desde).toISOString(), '2026-09-23T14:28:11.271Z')
    assert.equal((await banco.query("SELECT count(*)::int n FROM radar_notificacoes WHERE canal='email'")).rows[0].n, 0)
    await gravarPagina(banco, job('teste-b'), { ...resultado, parcial: false })
    assert.equal((await banco.query('SELECT count(*)::int n FROM radar_mensagens')).rows[0].n, 2)
    await renovar()
    await gravarPagina(banco, job('teste-a'), { mensagens: [], naoEncontrado: true, parcial: false })
    assert.equal((await banco.query("SELECT status FROM radar_comprasgov_canais WHERE processo_id='teste-a'")).rows[0].status, 'ok')
    await banco.query("UPDATE radar_comprasgov_canais SET inicializado=false,desde=NULL,lease_id='lease',lease_ate=now()+interval '3 minutes' WHERE processo_id='teste-a'")
    await gravarPagina(banco, job('teste-a'), { mensagens: [], naoEncontrado: true, parcial: false })
    assert.equal((await banco.query("SELECT status FROM radar_comprasgov_canais WHERE processo_id='teste-a'")).rows[0].status, 'nao_encontrado')
    await assert.rejects(gravarPagina(banco, { ...job('teste-a'), lease_id: 'lease-invalido' }, resultado), /Lease expirado/)
  } finally { await banco.end() }
})
