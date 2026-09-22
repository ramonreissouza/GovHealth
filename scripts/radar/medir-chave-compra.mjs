// scripts/radar/medir-chave-compra.mjs — quanto do Radar teria `chaveCompra` montável.
//
//   npm run radar:chave:medir            (padrão: 200 órgãos do topo + 100 da cauda)
//   npm run radar:chave:medir -- --topo 300 --cauda 150 --amostra 150
//
// POR QUE ESTE SCRIPT EXISTE
//
// A `chaveCompra` do Compras.gov.br é `UASG(6) + modalidadeSIASG(2) + numero(5) + ano(4)`.
// Sem ela não há `GET /chat/{chaveCompra}` — nem na API paga do SERPRO, nem em lugar
// nenhum. Antes de contratar API ou escrever conector, o número que decide é: PARA
// QUANTOS PROCESSOS A CHAVE É MONTÁVEL? Esse número é o teto do produto.
//
// ELE SÓ LÊ. Não escreve no banco. O único arquivo que toca é um cache em `os.tmpdir()`,
// porque o PNCP devolve 500/502/503 com frequência de dia e refazer 300 requisições a
// cada execução custa dez minutos por nada.
//
// ── A ARMADILHA QUE ESTE SCRIPT EXISTE PARA NÃO DEIXAR PASSAR ────────────────────────
//
// `conector_id='comprasgov'` NÃO quer dizer "está no Compras.gov.br".
// `src/lib/radar/selecao.ts:14` define `CONECTOR_PADRAO = 'comprasgov'` e a linha 183
// arquiva sob ele TODO processo de titular sem credencial cadastrada — venha de onde
// vier. Por isso o maior "órgão do Compras.gov.br" da base é o ESTADO DO CEARÁ, com 1.541
// processos, que licita no portal próprio dele.
//
// Contar `conector_id='comprasgov'` como denominador, portanto, responde outra pergunta.
// O recorte que decide é a ESFERA do órgão: só o que é federal existe no SIASG, e só o
// que existe no SIASG tem UASG e `chaveCompra`. Estado e município entram no PNCP, mas
// não no Compras.gov.br — para eles a chave não existe, não é "difícil de montar".
//
// ── COMO A ESFERA É MEDIDA ───────────────────────────────────────────────────────────
//
// `contratacoes` não guarda esfera (nem UASG — ver a Fase 2 do plano). Quem tem é o
// detalhe do PNCP: `orgaoEntidade.esferaId` em {F, E, M}. Esfera é propriedade do ÓRGÃO,
// não do processo, então uma requisição por órgão distinto basta — e 1.039 órgãos cobrem
// 8.817 processos. O script mede os órgãos do topo (que concentram o volume) e uma
// amostra da cauda, e extrapola a cauda pela proporção medida nela. Ele IMPRIME quanto
// foi medido e quanto foi extrapolado; um número extrapolado que se apresenta como
// medido é pior que nenhum número.
//
// ── CONCORRÊNCIA ─────────────────────────────────────────────────────────────────────
//
// 3 requisições simultâneas, com espera entre elas. Sondar o PNCP em rajada é o que o
// derruba (é medição registrada neste repositório), e um 503 provocado por nós vira um
// "órgão sem esfera" que suja exatamente o número que viemos buscar.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { novoPool } from '../lib/pg-ssl.mjs'

const CONSULTA = 'https://pncp.gov.br/api/consulta/v1'

// ── argumentos ──────────────────────────────────────────────────────────────────────
function arg(nome, padrao) {
  const i = process.argv.indexOf(`--${nome}`)
  if (i < 0 || !process.argv[i + 1]) return padrao
  const n = Number(process.argv[i + 1])
  return Number.isFinite(n) ? n : padrao
}
const N_TOPO = arg('topo', 200)       // órgãos do topo (por volume) a medir
const N_CAUDA = arg('cauda', 100)     // órgãos da cauda, para extrapolar
const N_AMOSTRA = arg('amostra', 120) // processos federais amostrados p/ formato do número
const SEM_CACHE = process.argv.includes('--sem-cache')

const CACHE = path.join(os.tmpdir(), 'govhealth-esfera-orgaos.json')

// ── PNCP: uma requisição, com paciência ─────────────────────────────────────────────
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

/** Detalhe da compra. Devolve o JSON, ou `null` depois de esgotar as tentativas. */
async function detalhe(cnpj, ano, seq, tentativas = 5) {
  const url = `${CONSULTA}/orgaos/${cnpj}/compras/${ano}/${seq}`
  for (let i = 1; i <= tentativas; i++) {
    let r
    try {
      r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'GovHealth/1.0' } })
    } catch {
      await dormir(1500 * i); continue
    }
    if (r.ok) { try { return await r.json() } catch { return null } }
    // 404 é resposta, não falha de infra: a compra não está no PNCP. Não insistir.
    if (r.status === 404) return null
    await dormir(1500 * i)
  }
  return null
}

/** Executa `fn` sobre `itens` com no máximo `n` simultâneas. */
async function comLimite(itens, n, fn) {
  const saida = new Array(itens.length)
  let proximo = 0
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (proximo < itens.length) {
      const i = proximo++
      saida[i] = await fn(itens[i], i)
      await dormir(250)
    }
  }))
  return saida
}

// ── formato ─────────────────────────────────────────────────────────────────────────
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : '0.0') + '%'
function tabela(titulo, linhas) {
  console.log('\n-- ' + titulo + ' ' + '-'.repeat(Math.max(0, 68 - titulo.length)))
  if (!linhas.length) { console.log('  (vazio)'); return }
  console.table(linhas)
}

// ── principal ───────────────────────────────────────────────────────────────────────
const banco = novoPool(process.env.DATABASE_URL, { max: 3, idleTimeoutMillis: 10_000 })
// O PgBouncer derruba conexão ociosa; sem este handler o processo inteiro morre.
banco.on('error', (e) => console.error('aviso: conexao do pool caiu e foi descartada:', e?.message ?? e))

const q = async (sql, args = []) => (await banco.query(sql, args)).rows

try {
  console.log('Medindo o teto da chaveCompra. So leitura; nada e gravado no banco.\n')

  // 1 ── o denominador, e por que ele engana ────────────────────────────────────────
  const [{ n: totalRotulado }] = await q(
    `SELECT count(*)::int n FROM radar_processos WHERE conector_id = 'comprasgov'`)
  const [{ n: casados }] = await q(
    `SELECT count(*)::int n
       FROM radar_processos rp
       JOIN contratacoes c ON c.numero_controle_pncp = rp.licitacao_id
      WHERE rp.conector_id = 'comprasgov'`)

  console.log(`processos rotulados conector_id='comprasgov' .... ${totalRotulado}`)
  console.log(`  destes, com linha em contratacoes ............. ${casados}  (${pct(casados, totalRotulado)})`)
  console.log('\n  ATENCAO: comprasgov e o rotulo PADRAO de selecao.ts, nao uma medicao')
  console.log('  de portal. O numero que decide e o federal, apurado abaixo.')

  // 2 ── órgãos, por volume ─────────────────────────────────────────────────────────
  const orgaos = await q(
    `SELECT c.cnpj_orgao,
            max(c.razao_social_orgao) AS razao,
            count(*)::int             AS n,
            (array_agg(c.sequencial_compra ORDER BY c.ano_compra DESC))[1] AS seq,
            (array_agg(c.ano_compra        ORDER BY c.ano_compra DESC))[1] AS ano_seq
       FROM radar_processos rp
       JOIN contratacoes c ON c.numero_controle_pncp = rp.licitacao_id
      WHERE rp.conector_id = 'comprasgov'
      GROUP BY 1
      ORDER BY 3 DESC`)

  const topo = orgaos.slice(0, N_TOPO)
  const cauda = orgaos.slice(N_TOPO)
  // Amostra determinística da cauda (sem Math.random): passo uniforme sobre a lista já
  // ordenada. Reexecuções dão a mesma amostra, o que torna dois resultados comparáveis.
  const passo = cauda.length > N_CAUDA ? cauda.length / N_CAUDA : 1
  const amostraCauda = cauda.length <= N_CAUDA
    ? cauda
    : Array.from({ length: N_CAUDA }, (_, i) => cauda[Math.floor(i * passo)])

  const aMedir = [...topo, ...amostraCauda]
  console.log(`\norgaos distintos ................................ ${orgaos.length}`)
  console.log(`  a consultar no PNCP (topo ${topo.length} + cauda ${amostraCauda.length}) ....... ${aMedir.length}`)

  // cache
  let cache = {}
  if (!SEM_CACHE && fs.existsSync(CACHE)) {
    try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')) } catch { cache = {} }
  }
  const faltam = aMedir.filter((o) => !cache[o.cnpj_orgao])
  console.log(`  ja em cache ................................... ${aMedir.length - faltam.length}`)
  if (faltam.length) console.log(`  a buscar agora (3 por vez, PNCP e fragil) ..... ${faltam.length}`)

  let feitos = 0
  await comLimite(faltam, 3, async (o) => {
    const d = await detalhe(o.cnpj_orgao, o.ano_seq, o.seq)
    cache[o.cnpj_orgao] = {
      esfera: d?.orgaoEntidade?.esferaId ?? null,
      poder: d?.orgaoEntidade?.poderId ?? null,
      codigoUnidade: d?.unidadeOrgao?.codigoUnidade ?? null,
    }
    if (++feitos % 25 === 0) process.stdout.write(`  ... ${feitos}/${faltam.length}\n`)
  })
  if (!SEM_CACHE) { try { fs.writeFileSync(CACHE, JSON.stringify(cache)) } catch { /* cache e conforto */ } }

  // 3 ── esfera, ponderada por processo ─────────────────────────────────────────────
  const contaPorEsfera = { F: 0, E: 0, M: 0, '(sem resposta)': 0 }
  let medidosProc = 0
  for (const o of aMedir) {
    const e = cache[o.cnpj_orgao]?.esfera
    contaPorEsfera[e && e in contaPorEsfera ? e : '(sem resposta)'] += o.n
    medidosProc += o.n
  }
  const procsTopo = topo.reduce((a, b) => a + b.n, 0)
  const procsCauda = cauda.reduce((a, b) => a + b.n, 0)
  const procsAmostraCauda = amostraCauda.reduce((a, b) => a + b.n, 0)

  tabela('esfera do orgao, ponderada por processo (medido)', Object.entries(contaPorEsfera)
    .map(([esfera, n]) => ({
      esfera: { F: 'F - federal (existe no SIASG)', E: 'E - estadual', M: 'M - municipal' }[esfera] ?? esfera,
      processos: n,
      'pct do medido': pct(n, medidosProc),
    })))

  // extrapolação da cauda
  const federalTopo = topo.reduce((a, o) => a + (cache[o.cnpj_orgao]?.esfera === 'F' ? o.n : 0), 0)
  const federalAmostraCauda = amostraCauda.reduce((a, o) => a + (cache[o.cnpj_orgao]?.esfera === 'F' ? o.n : 0), 0)
  const taxaCauda = procsAmostraCauda ? federalAmostraCauda / procsAmostraCauda : 0
  const federalEstimado = federalTopo + Math.round(taxaCauda * procsCauda)

  console.log(`\nfederais medidos no topo ........................ ${federalTopo} de ${procsTopo} processos`)
  console.log(`taxa federal na amostra da cauda ................ ${pct(federalAmostraCauda, procsAmostraCauda)}`)
  console.log(`  -> estimativa federal na base inteira ......... ~${federalEstimado} de ${casados}  (${pct(federalEstimado, casados)})`)
  console.log(`     (${pct(procsTopo + procsAmostraCauda, casados)} disso e medido; o resto e extrapolado pela taxa da cauda)`)

  // 4 ── modalidade: geral e só-federal ─────────────────────────────────────────────
  const cnpjsFederais = new Set(Object.entries(cache).filter(([, v]) => v?.esfera === 'F').map(([k]) => k))
  const modalidades = await q(
    `SELECT c.modalidade_nome, c.cnpj_orgao, count(*)::int n
       FROM radar_processos rp
       JOIN contratacoes c ON c.numero_controle_pncp = rp.licitacao_id
      WHERE rp.conector_id = 'comprasgov'
      GROUP BY 1, 2`)
  const somaMod = (filtro) => {
    const m = new Map()
    for (const r of modalidades) {
      if (!filtro(r.cnpj_orgao)) continue
      m.set(r.modalidade_nome, (m.get(r.modalidade_nome) ?? 0) + r.n)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }
  const modFed = somaMod((c) => cnpjsFederais.has(c))
  const totalFedMod = modFed.reduce((a, b) => a + b[1], 0)
  tabela('modalidade_nome nos orgaos FEDERAIS medidos (o de/para a escrever)',
    modFed.map(([nome, n]) => ({ modalidade_nome: nome ?? '(nulo)', processos: n, pct: pct(n, totalFedMod) })))
  const geral = somaMod(() => true)
  const totalGeral = geral.reduce((a, b) => a + b[1], 0)
  tabela('modalidade_nome na base inteira (referencia)',
    geral.map(([nome, n]) => ({ modalidade_nome: nome ?? '(nulo)', processos: n, pct: pct(n, totalGeral) })))

  // 5 ── formato: a UASG tem 6 dígitos? o número cabe em 5? ─────────────────────────
  //
  // As duas perguntas que decidem se a chave e montavel a partir do que o PNCP devolve.
  // A Fase 5.1 do plano pergunta se `sequencial_compra` do PNCP e o `numero` do SIASG;
  // aqui a resposta comeca a aparecer, olhando `numeroCompra` de processos reais.
  let alvos = []
  if (cnpjsFederais.size) {
    alvos = await q(
      `SELECT c.cnpj_orgao, c.ano_compra, c.sequencial_compra
         FROM radar_processos rp
         JOIN contratacoes c ON c.numero_controle_pncp = rp.licitacao_id
        WHERE rp.conector_id = 'comprasgov' AND c.cnpj_orgao = ANY($1)
        ORDER BY c.data_publicacao DESC NULLS LAST
        LIMIT $2`, [[...cnpjsFederais], N_AMOSTRA])
  }
  if (!alvos.length) {
    console.log('\nsem orgao federal medido - nada a amostrar para formato de numero.')
  } else {
    console.log(`\namostrando ${alvos.length} processos federais para conferir formato...`)
    const forma = { uasg6: 0, uasgOutro: 0, uasgAusente: 0, num5ouMenos: 0, numMaior: 0, numNaoNumerico: 0, semResposta: 0 }
    const exemplos = []
    await comLimite(alvos, 3, async (a) => {
      const d = await detalhe(a.cnpj_orgao, a.ano_compra, a.sequencial_compra, 3)
      if (!d) { forma.semResposta++; return }
      const u = String(d.unidadeOrgao?.codigoUnidade ?? '')
      if (!u) forma.uasgAusente++
      else if (/^\d{6}$/.test(u)) forma.uasg6++
      else forma.uasgOutro++
      const num = String(d.numeroCompra ?? '')
      if (!/^\d+$/.test(num)) forma.numNaoNumerico++
      else if (num.length <= 5) forma.num5ouMenos++
      else forma.numMaior++
      if (exemplos.length < 6) exemplos.push({
        uasg: u, numeroCompra: num, sequencialCompra: d.sequencialCompra,
        modalidadeId: d.modalidadeId, modalidadeNome: d.modalidadeNome, ano: d.anoCompra,
      })
    })
    tabela('formato observado nos federais', [
      { campo: 'codigoUnidade com 6 digitos', n: forma.uasg6 },
      { campo: 'codigoUnidade com outro tamanho', n: forma.uasgOutro },
      { campo: 'codigoUnidade ausente', n: forma.uasgAusente },
      { campo: 'numeroCompra cabe em 5 digitos', n: forma.num5ouMenos },
      { campo: 'numeroCompra MAIOR que 5 digitos', n: forma.numMaior },
      { campo: 'numeroCompra nao numerico', n: forma.numNaoNumerico },
      { campo: 'PNCP nao respondeu', n: forma.semResposta },
    ])
    tabela('exemplos crus (confira a mao antes de confiar)', exemplos)
    if (forma.numMaior > 0) {
      console.log('\n  AVISO: numeroCompra maior que 5 digitos aparece na amostra. A chave de 17')
      console.log('  digitos NAO comporta esse numero, e sequencialCompra e outro sistema de')
      console.log('  numeracao. Isto e a pergunta 1 da Fase 5.1 respondendo NAO: leve o achado')
      console.log('  para o humano ANTES de escrever o modulo da Fase 3.')
    }
  }

  // 6 ── veredito ───────────────────────────────────────────────────────────────────
  const share = casados ? federalEstimado / casados : 0
  console.log('\n' + '='.repeat(72))
  console.log(`VEREDITO - fatia federal estimada: ${pct(federalEstimado, casados)}`)
  if (share >= 0.60) console.log('>= 60%: siga para a Fase 2 do plano.')
  else if (share >= 0.20) console.log('20-60%: siga, MAS avise o humano - isto e complemento, nao substituto.')
  else console.log('< 20%: PARE E AVISE. Nao vale contratar API para esta fatia.')
  console.log('='.repeat(72))
} catch (e) {
  console.error('\nfalhou:', e?.message ?? e)
  process.exitCode = 1
} finally {
  await banco.end().catch(() => {})
}
