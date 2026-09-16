// scripts/radar/cobertura-portais.mjs — quanto do que está ABERTO HOJE o Radar alcança,
// e quem são os portais que faltam. Rode antes de decidir escrever qualquer conector:
//
//   npm run radar:cobertura
//
// Existe porque a mesma pergunta foi respondida errado três vezes, cada vez por um
// motivo diferente. As três correções estão codificadas aqui para não dependerem de eu
// lembrar delas:
//
//   1) MEDIR PELA COLUNA CERTA. `link_externo` diz ONDE; `usuario_nome` diz QUEM
//      PUBLICOU. Contar portal por `link_externo` dá zero falso para toda casa de
//      software que não publica endereço — foi assim que Betha, IPM e GovernançaBrasil
//      foram descartadas por "0 licitações" tendo milhares. O ranking abaixo é por
//      `usuario_nome`; o link entra só para dizer se dá para CHEGAR lá.
//
//   2) LINK NÃO BASTA, PRECISA DE CAMINHO. O BR Conectado tem 100% de `link_externo` e
//      os 3.461 são domínio puro (`http://www.portaldecomprascodo.com.br`), sem id de
//      processo. Ter link e ser alcançável são coisas diferentes.
//
//   3) A RÉGUA DO CAMINHO PRECISA TIRAR O ESQUEMA ANTES. Escrita como
//      `^(?:https?://)?[^/]+/.+`, ela aprova QUALQUER url com `://`: o grupo opcional não
//      casa, `[^/]+` come `http:`, e o `.+` come o host inteiro. Foi o que fez o Ceará
//      aparecer com 114 links úteis tendo zero. Aqui o esquema é removido ANTES do teste
//      — e `teste()` prova isso a cada execução.
//
// "Aberta hoje" é `data_encerramento_proposta >= current_date`: é o recorte que muda
// decisão, porque chat de processo encerrado não faz ninguém ganhar licitação. Não
// confundir com a régua de aberto/encerrado do PRODUTO, que é ausência em `resultados` —
// aquela conta processos de 2024 sem resultado lançado, e infla tudo em 40x.

import pg from 'pg'
import { PORTAIS } from './portais.mjs'

// UFs com cliente ativo. É fato comercial, não deduzível do banco: `usuarios` não tem
// UF, só `endereco` em texto livre. Atualize quando a base de clientes mudar — todo o
// ranking depende disso, e medir no Brasil inteiro inverte a resposta.
const UFS_CLIENTE = ['RN', 'SP', 'GO', 'PB', 'PE', 'MT', 'BA', 'CE', 'AL', 'SE']

// Portais já medidos e FECHADOS, com o motivo. Ficam aqui para a tabela não sugerir de
// novo o que já foi sondado — e para o motivo morrer junto com a sondagem, não comigo.
const VEREDITOS = {
  'Licitações-E BB': 'fechado — sem chat público; só com login do cliente',
  'Novo BBMNET Licitações': 'fechado — não publica endereço',
  'Megasoft Informática': 'fechado — não publica endereço',
  'BR Conectado': 'fechado — link sem caminho, 257 domínios',
  'Governançabrasil Tecnologia e Gestão em Serviços': 'fechado — não publica endereço',
  'Fiorilli Software': 'fechado — link é PDF do edital ou listagem; 21 domínios, servidores 403',
  'Instituto Municipal de Administração Pública - IMAP': 'fechado — repositório de arquivos (sai.io)',
  'Secretaria de Administração do Estado de Pernambuco': 'fechado — servidor recusa conexão (2 redes, 16/09/2026)',
  'BAHIA SECRETARIA DA ADMINISTRACAO': 'fechado — vitrine; a disputa corre no Licitações-e BB',
  'ASJB Consultoria S/C Ltda': 'fechado — vitrine; a disputa corre no Licitanet',
  'Secretaria do Planejamento e Gestão do Ceará': 'fechado — publica só a home, sem caminho',
  'Licitar Digital - Plataforma de Licitações Online': 'bloqueado — desafio do Cloudflare',
  'IBDM Modernização Assessoria e Consultoria': 'fechado — diário oficial e página de município, não processo',
  // O único candidato VIVO medido em 16/09/2026. Lista pública em JSON
  // (/processos/tabela/?…&todos=1&page=N, sem token) com o guid de cada processo, que é
  // o mesmo guid do link do PNCP. A página do processo traz situação e PRAZO de
  // impugnação/esclarecimento — mas o teor do pedido fica atrás de login. Daria conector
  // de RUPTURA (suspenso/revogado/anulado), não de chat.
  'M2A tecnologia': 'VIVO — lista pública em JSON; só situação, o teor exige login',
  'SMARAPD INFORMATICA LTDA': 'sem endereço',
  'TOP DOWN CONSULTORIA LTDA': 'sem endereço',
  '3Tecnos Tecnologia LTDA': 'sem endereço',
}

/** Tira o esquema. Todo teste de caminho depende de isto vir ANTES. */
export function semEsquema(url) {
  return String(url ?? '').replace(/^https?:\/\//i, '')
}

/** O link leva a um PROCESSO, ou só ao portal? Só o primeiro serve para um conector. */
export function temCaminho(url) {
  return /^[^/]+\/.+/.test(semEsquema(url))
}

export function hostDe(url) {
  const m = semEsquema(url).match(/^([^/:]+)/)
  return m ? m[1].toLowerCase() : null
}

// A MESMA regra em SQL. Se as duas divergirem, a tabela mente — por isso `teste()` roda
// os dois lados contra os mesmos casos, no banco, a cada execução.
const SEM_ESQ = `regexp_replace(c.link_externo, '^https?://', '')`
const CAMINHO = `${SEM_ESQ} ~ '^[^/]+/.+'`
const HOST = `lower(substring(${SEM_ESQ} from '^([^/:]+)'))`
const HOJE = `c.data_encerramento_proposta >= current_date`

const CASOS = [
  ['http://x.gov.br/', false], // a home com barra — o caso que furou a régua antiga
  ['https://x.gov.br', false],
  ['x.gov.br/Portal/Pages/Lic.aspx?n=1', true], // sem esquema: o PE Integrado publica assim
  ['https://x.gov.br/p/1', true],
]

async function teste(pool) {
  let falhou = 0
  for (const [url, esperado] of CASOS) {
    const { rows } = await pool.query(`select regexp_replace($1,'^https?://','') ~ '^[^/]+/.+' as sql`, [url])
    const js = temCaminho(url)
    const bom = js === esperado && rows[0].sql === esperado
    if (!bom) {
      falhou++
      console.log(`  RÉGUA QUEBRADA  ${url}  esperado ${esperado}, js ${js}, sql ${rows[0].sql}`)
    }
  }
  if (falhou) {
    console.error('\nA régua do caminho não confere. A tabela abaixo seria mentira; abortando.\n')
    process.exit(1)
  }
  console.log(`régua conferida em ${CASOS.length} casos (js e sql de acordo)\n`)
}

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—')

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL não está no ambiente. Rode com `node --env-file=.env.local`.')
    process.exit(1)
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 })
  try {
    await teste(pool)

    // Domínios que os conectores públicos atendem hoje, lidos do registro — para a
    // cobertura não ficar desatualizada toda vez que um conector entra.
    const dominios = Object.values(PORTAIS)
      .filter((p) => p.publico && p.dominio)
      .map((p) => p.dominio)
    const cobertoSql = `(${dominios.map((_, i) => `c.link_externo ilike '%' || $${i + 2} || '%'`).join(' or ')}
                         or c.usuario_nome = 'Compras.gov.br')`

    for (const [rotulo, ufs] of [['Brasil', null], [`UFs de cliente (${UFS_CLIENTE.join(', ')})`, UFS_CLIENTE]]) {
      // O `$1::text[] is null` mantém o parâmetro referenciado também no caso Brasil —
      // sem isso o Postgres não consegue inferir o tipo de um $1 que não aparece.
      const { rows } = await pool.query(
        `select count(*) filter (where ${HOJE}) as abertas,
                count(*) filter (where ${HOJE} and ${cobertoSql}) as cobertas
           from contratacoes c
          where ($1::text[] is null or c.uf = any($1))`,
        [ufs, ...dominios],
      )
      const { abertas, cobertas } = rows[0]
      console.log(`${rotulo}: ${cobertas} de ${abertas} abertas hoje — ${pct(cobertas, abertas)}`)
    }

    const { rows } = await pool.query(
      `select c.usuario_nome as sistema,
              count(*) filter (where ${HOJE}) as hoje,
              count(*) filter (where ${HOJE} and ${CAMINHO}) as uteis,
              count(distinct ${HOST}) filter (where ${HOJE} and ${CAMINHO}) as dominios,
              count(*) filter (where ${HOJE} and ${cobertoSql}) as cobertas
         from contratacoes c
        where c.uf = any($1) and c.usuario_nome is not null
        group by 1 having count(*) filter (where ${HOJE}) > 0
        order by hoje desc limit 25`,
      [UFS_CLIENTE, ...dominios],
    )

    console.log('\nquem publica o que está aberto HOJE nas UFs de cliente')
    console.log('  úteis = com link que leva a um processo (sem isso não há conector possível)\n')
    for (const r of rows) {
      // Um `bool_or` aqui diria "ligado" para o sistema inteiro quando UM processo
      // casasse um domínio coberto. O IMAP tem dois domínios e só um é do PCP — e
      // apareceu como ligado tendo 61 processos fora. Conta-se quantos, não se algum.
      const cobertas = Number(r.cobertas)
      const uteis = Number(r.uteis)
      const veredito =
        cobertas === Number(r.hoje) ? 'ligado'
        // Coberto em tudo que tinha endereço: o resto não é gap de conector, é gap de
        // link. Dizer "sem endereço" aqui faria parecer que falta trabalho onde não falta.
        : uteis > 0 && cobertas >= uteis ? 'ligado — o resto não publica endereço'
        : VEREDITOS[r.sistema] ?? (uteis > cobertas ? '← alcançável, não medido' : 'sem endereço')
      const parcial = cobertas > 0 && cobertas < Number(r.hoje) ? ` (${cobertas} de ${r.hoje})` : ''
      console.log(
        `${String(r.hoje).padStart(4)} hoje | úteis ${String(r.uteis).padStart(4)} | ${String(r.dominios).padStart(3)} dom | ` +
          `${String(r.sistema).slice(0, 42).padEnd(42)} ${veredito}${parcial}`,
      )
    }
    // O fecho é calculado, não escrito à mão: se amanhã aparecer um sistema novo com
    // link útil e sem veredito, esta linha passa a pedir sondagem em vez de declarar
    // que acabou. Foi assim que o M2A apareceu — a conclusão anterior dizia "não há
    // mais nada" com duas linhas alcançáveis na própria tabela.
    const pendentes = rows.filter((r) => !VEREDITOS[r.sistema] && Number(r.uteis) > Number(r.cobertas))
    console.log(
      pendentes.length
        ? `\n${pendentes.length} sistema(s) com link útil e sem veredito — sonde antes de concluir:\n` +
            pendentes.map((r) => `  · ${r.sistema} (${r.uteis} úteis)`).join('\n')
        : '\nNenhum sistema alcançável sem medir: o que falta nas UFs de cliente está atrás de\n' +
            'login ou não publica endereço. Não há conector PÚBLICO novo a escrever.',
    )
  } finally {
    await pool.end()
  }
}

await main()
