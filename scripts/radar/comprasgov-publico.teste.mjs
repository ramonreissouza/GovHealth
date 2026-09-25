import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compraPublica, horarioPublico, mensagemPublica } from '../../src/lib/radar/comprasgov-publico.mjs'
import { lerPaginasPublicas, diagnosticoPublico, temDesafioPublico, DesafioPublico, CompraNaoEncontrada, PesquisaNaoConfirmada, abrirPainel, abrirPelaPesquisa } from './connector-comprasgov-publico.mjs'
import { gravarMensagens } from './mensagens-persistencia.mjs'
import { tomarLease, renovarLease, conferirLease, liberarLease, transacaoPublica } from './publico-lease.mjs'
import fs from 'node:fs/promises'

const chave = '20105705900122025'
const base = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra'
const linha = { autor: 'Mensagem do Pregoeiro', texto: 'A sessão será retomada amanhã.', lote: 'Grupo 1', horario: '16/12/2025 17:01' }

test('redirecionamento compra-nao-encontrada não vira timeout nem ausência de mensagens', async () => {
  const page = {
    url: () => 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/compra-nao-encontrada',
    locator: () => ({ first: () => ({ isVisible: async () => false }) }),
  }
  await assert.rejects(abrirPainel(page,async () => {}),CompraNaoEncontrada)
  assert.match(diagnosticoPublico(new CompraNaoEncontrada(),'painel'),/pesquisa oficial/)
})

test('pesquisa não aceita resultado ambíguo ou compra diferente do cadastro', async () => {
  const pagina = (quantidade, chaveFinal) => ({
    goto: async () => ({ status: () => 200 }),
    locator: () => ({ isVisible: async () => true, fill: async () => {} }),
    getByRole: () => ({ check: async () => {}, click: async () => {}, count: async () => quantidade, isVisible: async () => true }),
    waitForURL: async () => {}, waitForTimeout: async () => {}, url: () => `${base}?compra=${chaveFinal}`,
  })
  const compra = compraPublica(`${base}?compra=${chave}`)
  await assert.rejects(abrirPelaPesquisa(pagina(2,chave),compra,async () => {}),/ambígua/)
  await assert.rejects(abrirPelaPesquisa(pagina(1,'20105705900132025'),compra,async () => {}),/diferente/)
  await assert.rejects(abrirPelaPesquisa(pagina(0,chave),compra,async () => {}),PesquisaNaoConfirmada)
  await abrirPelaPesquisa(pagina(1,chave),compra,async () => {})
})

test('só aceita a rota pública e normaliza URL de item para compra', () => {
  assert.equal(compraPublica(`${base}/item/-1?compra=${chave}`)?.url, `${base}?compra=${chave}`)
  for (const url of [`${base}?compra=x`, `${base}?compra=20105708900122025`, base.replace('https:', 'http:'), `${base.replace('.gov.br', '.gov.br.evil.test')}?compra=${chave}`, `https://localhost/${chave}`, `${base.replace('/public/', '/seguro/')}?compra=${chave}`]) assert.equal(compraPublica(url), null)
})

test('horário de Brasília, grupo e precisão da origem são preservados', () => {
  assert.equal(horarioPublico(linha.horario), '2025-12-16T20:01:00.000Z')
  assert.throws(() => horarioPublico('31/02/2025 17:01'))
  assert.throws(() => horarioPublico('16/12/2025 25:01'))
  const m = mensagemPublica(linha, 'processo', chave)
  assert.equal(m.lote, 'Grupo 1'); assert.match(m.texto, /^\[Grupo 1\]/)
  assert.equal(m.raw.precisaoHorario, 'minuto')
  assert.throws(() => mensagemPublica({ ...linha, texto: '' }, 'processo', chave))
})

function paginaFake(paginas, repetir = false) {
  let i = 0
  const page = {
    locator: () => ({ first: () => ({ waitFor: async () => {} }) }),
    evaluate: async () => paginas[i],
    getByRole: () => ({ getByRole: () => ({ click: async () => { if (!repetir) i++ } }) }),
    waitForFunction: async () => {}, waitForTimeout: async () => {},
  }
  return page
}
const pagina = (texto, temProxima) => ({ linhas: [{ ...linha, texto }], temProxima, paginador: true })

test('lê a página seguinte sem confundir carregamento com resposta vazia', async () => {
  const r = await lerPaginasPublicas(paginaFake([pagina('A',true), pagina('B',false)]), { licitacaoId:'p', chave })
  assert.equal(r.completa,true); assert.equal(r.paginas,2); assert.equal(r.mensagens.length,2)
})

test('teto de páginas declara cobertura parcial', async () => {
  const r = await lerPaginasPublicas(paginaFake([pagina('A',true)]), { licitacaoId:'p', chave, maxPaginas:1 })
  assert.equal(r.completa,false); assert.equal(r.mensagens.length,1)
})

test('página repetida, painel vazio e ausência de paginação não viram leitura OK', async () => {
  await assert.rejects(lerPaginasPublicas(paginaFake([pagina('A',true)],true), { licitacaoId:'p', chave }), /não avançou/)
  for (const p of [null, { linhas:[],temProxima:false,paginador:true }, { ...pagina('A',false),paginador:false }]) {
    await assert.rejects(lerPaginasPublicas(paginaFake([p]), { licitacaoId:'p', chave }))
  }
})

test('recusa de acesso interrompe a leitura', async () => {
  await assert.rejects(lerPaginasPublicas(paginaFake([pagina('A',false)]), {
    licitacaoId:'p', chave, verificar: () => { throw new Error('HTTP 429') },
  }), /429/)
})

test('distingue CAPTCHA visível, selo pequeno e iframe oculto', async () => {
  const page = (visivel, width, height) => ({ locator: () => ({ all: async () => [{ isVisible: async () => visivel, boundingBox: async () => ({ width,height }) }] }) })
  assert.equal(await temDesafioPublico(page(true,400,600)),true)
  assert.equal(await temDesafioPublico(page(true,30,30)),false)
  assert.equal(await temDesafioPublico(page(false,400,600)),false)
  assert.match(diagnosticoPublico(new DesafioPublico(),'painel'),/modo assistido/)
  assert.match(diagnosticoPublico(new Error("Executable doesn't exist"),'navegador'),/não instalado/)
  assert.match(diagnosticoPublico(new Error('spawn EPERM'),'navegador'),/permissões/)
})

test('Postgres: exclusão mútua, pausa, dedup por empresa, alertas e rollback', {
  skip: process.env.RADAR_COMPRASGOV_TEST_DB !== '1' ? 'Habilite RADAR_COMPRASGOV_TEST_DB=1 para testar em tabelas temporárias.' : false,
}, async () => {
  const { novoClient } = await import('../lib/pg-ssl.mjs')
  const db = novoClient()
  await db.connect()
  try {
    // Uma transação fixa a conexão no PgBouncer. Tudo desaparece no ROLLBACK.
    await db.query('BEGIN')
    for (const tabela of ['radar_mensagens','radar_notificacoes','radar_auditoria']) {
      await db.query(`CREATE TEMP TABLE ${tabela} (LIKE public.${tabela} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES) ON COMMIT DROP`)
    }
    for (const tabela of ['radar_mensagens','radar_auditoria']) {
      await db.query(`CREATE TEMP SEQUENCE ${tabela}_teste_seq`)
      await db.query(`ALTER TABLE pg_temp.${tabela} ALTER COLUMN id SET DEFAULT nextval('pg_temp.${tabela}_teste_seq')`)
    }
    await db.query((await fs.readFile(new URL('../../db/schema-radar-publico.sql',import.meta.url),'utf8')).replace('CREATE TABLE IF NOT EXISTS','CREATE TEMP TABLE'))
    // Qualificação explícita impede fallback para tabelas reais em qualquer falha.
    const query = (sql, args) => db.query(sql.replace(/\bradar_(mensagens|notificacoes|auditoria|coletor_leases)\b/g,'pg_temp.radar_$1'),args)
    const banco = { query }
    assert.equal(await tomarLease(banco,'comprasgov','a'),'a')
    assert.equal(await tomarLease(banco,'comprasgov','b'),null)
    await renovarLease(banco,'comprasgov','a')
    await assert.rejects(conferirLease(banco,'comprasgov','b'),/perdido/)
    await liberarLease(banco,'comprasgov','b',0)
    await conferirLease(banco,'comprasgov','a')
    await liberarLease(banco,'comprasgov','a',1800)
    assert.equal(await tomarLease(banco,'comprasgov','b'),null)
    await query("UPDATE radar_coletor_leases SET proxima_tentativa=now()-interval '1 second'")
    assert.equal(await tomarLease(banco,'comprasgov','b'),'b')

    // Mapeia a transação de produção a SAVEPOINT para manter o teste inteiro isolado.
    const pool = { connect: async () => ({ query: (sql,args) => query(
      ({ BEGIN:'SAVEPOINT lote_teste', COMMIT:'RELEASE SAVEPOINT lote_teste', ROLLBACK:'ROLLBACK TO SAVEPOINT lote_teste' })[sql] || sql,args), release: () => {},
    }) }
    const lease = { conferir: (client) => conferirLease(client,'comprasgov','b') }
    const ctx = (tenant) => ({ titularId:tenant, conectorId:'comprasgov',cnpj:'',
      mapa:new Map([['p',{ id:`processo-${tenant}`,titulo:'Teste',link_portal:base }]]), regras:[],destinatario:'teste@example.invalid' })
    const antiga = mensagemPublica(linha,'p',chave)
    const recente = { ...antiga,texto:'Convocamos para envio da proposta até às 15h.',horarioOrigem:new Date().toISOString() }
    const salvar = (tenant, msgs) => transacaoPublica(pool,lease,(c) => gravarMensagens(c,ctx(tenant),msgs))
    assert.equal((await salvar('a',[antiga,recente])).novas,2)
    assert.equal((await salvar('a',[antiga,recente])).novas,0)
    assert.equal((await salvar('b',[antiga,recente])).novas,2)
    assert.equal((await query("SELECT count(*)::int n FROM radar_notificacoes WHERE canal='email'")).rows[0].n,2)
    assert.equal((await query("SELECT count(*)::int n FROM radar_notificacoes WHERE canal='in_app'")).rows[0].n,4)
    assert.equal((await query("SELECT count(*)::int n FROM radar_mensagens WHERE prioridade='alta' AND lote='Grupo 1'")).rows[0].n,4)
    await assert.rejects(transacaoPublica(pool,lease,(client) => gravarMensagens({ query: (sql,args) => {
      if (sql.includes('INSERT INTO radar_notificacoes')) throw new Error('falha na fila')
      return client.query(sql,args)
    } },ctx('a'),[{ ...recente,texto:'Mensagem adicional' }])),/falha na fila/)
    assert.equal((await query('SELECT count(*)::int n FROM radar_mensagens')).rows[0].n,4)
    await query("UPDATE radar_coletor_leases SET lease_ate=now()-interval '1 second'")
    await assert.rejects(salvar('a',[recente]),/perdido/)
    assert.equal(await tomarLease(banco,'comprasgov','c'),'c')
  } finally { await db.query('ROLLBACK'); await db.end() }
})
