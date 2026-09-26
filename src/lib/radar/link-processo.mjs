import { compraPublica } from './comprasgov-publico.mjs'

/**
 * O LINK COLADO É DE QUAL PORTAL, E O RADAR CONSEGUE LER O PREGÃO POR ELE?
 *
 * É a porta do "Adicionar pregão fora do perfil" (/radar), que tem um campo só: o link.
 * Substituiu o "Conectar portal" em 25/09/2026. Os portais lidos não pedem login e o
 * Compras.gov.br não tem o que conectar, então aquela janela abria num "não há nada para
 * conectar" e a única coisa real que ela fazia era isto, com três campos.
 *
 * A REGRA DE CADA PORTAL É A DO COLETOR, OU MAIS ESTRITA, NUNCA MAIS FROUXA. O coletor
 * (scripts/radar/connector-*.mjs) descarta, sem avisar ninguém, o processo cujo link não
 * reconhece. Aceitar aqui um link que ele descarta deixava o pregão na lista esperando uma
 * leitura que não vem. `scripts/radar/link-processo.teste.mjs` confere, link a link, que o
 * que sai daqui passa no validador do coletor.
 *
 * Mais estrita onde o coletor é frouxo: Licitanet, AMM Licita, eGov RS, Compras BR e PCP
 * procuram o domínio em qualquer ponto do texto (lá, `https://x.com/?a=licitanet.com.br/sessao/1`
 * passa). Aqui o HOST é conferido, porque o link salvo vira navegação do coletor.
 *
 * Link do PNCP também serve: a página do edital diz em que portal a disputa corre, e quem
 * olha isso é a rota (precisa do banco), não este módulo.
 */

/**
 * @typedef {{ conectorId: string, nome: string, hosts: string[], subdominios: boolean,
 *   exemplo: string, id: (u: URL) => string | null, descricao: (id: string) => string,
 *   recusa?: (u: URL) => string | null }} Regra
 */

/** @type {Regra[]} */
const REGRAS = [
  {
    // connector-bll.mjs: `urlDeProcesso` com HOSTS_PORTAL.bll, só https, host exato.
    // Exige o `param1`, que o coletor não exige: sem ele o endereço é a tela de processo
    // sem processo nenhum, e dois links assim virariam o mesmo cadastro.
    conectorId: 'bll', nome: 'BLL', hosts: ['bllcompras.com', 'www.bllcompras.com'], subdominios: false,
    exemplo: 'https://bllcompras.com/Process/ProcessView?param1=…',
    id: (u) => /^\/Process\//i.test(u.pathname) ? u.searchParams.get('param1') || null : null,
    descricao: () => 'processo',
    recusa: (u) => /^\/DirectBuy\//i.test(u.pathname) ? 'Compra direta no BLL não tem quadro de mensagens. O Radar lê a página de processo (bllcompras.com/Process/…).' : null,
  },
  {
    conectorId: 'bnc', nome: 'BNC', hosts: ['bnccompras.com', 'www.bnccompras.com'], subdominios: false,
    exemplo: 'https://bnccompras.com/Process/ProcessView?param1=…',
    id: (u) => /^\/Process\//i.test(u.pathname) ? u.searchParams.get('param1') || null : null,
    descricao: () => 'processo',
    recusa: (u) => /^\/DirectBuy\//i.test(u.pathname) ? 'Compra direta no BNC não tem quadro de mensagens. O Radar lê a página de processo (bnccompras.com/Process/…).' : null,
  },
  {
    // connector-licitanet.mjs: `urlDeSessao`, /licitanet\.com\.br\/sessao\/\d+/i.
    conectorId: 'licitanet', nome: 'Licitanet', hosts: ['licitanet.com.br'], subdominios: true,
    exemplo: 'https://licitanet.com.br/sessao/123456',
    id: (u) => u.pathname.match(/^\/sessao\/(\d+)/i)?.[1] ?? null,
    descricao: (id) => `sessão ${id}`,
  },
  {
    // connector-ammlicita.mjs: `urlDePesquisa`, /ammlicita\.org\.br\/pesquisa\/\d+/i.
    conectorId: 'ammlicita', nome: 'AMM Licita', hosts: ['ammlicita.org.br'], subdominios: true,
    exemplo: 'https://app2.ammlicita.org.br/pesquisa/123',
    id: (u) => u.pathname.match(/^\/pesquisa\/(\d+)/i)?.[1] ?? null,
    descricao: (id) => `processo ${id}`,
  },
  {
    // connector-egovrs.mjs: `urlDeEdital`, /\/editais\/[^/]+\/(\d+)/. O mesmo validador
    // atende os dois domínios; aqui cada domínio vai para o id que o cliente reconhece.
    conectorId: 'egovrs', nome: 'Compras RS', hosts: ['compras.rs.gov.br'], subdominios: true,
    exemplo: 'https://www.compras.rs.gov.br/editais/0452_2026/356155',
    id: (u) => u.pathname.match(/\/editais\/[^/]+\/(\d+)/)?.[1] ?? null,
    descricao: (id) => `edital ${id}`,
  },
  {
    conectorId: 'banrisul', nome: 'Pregão Banrisul', hosts: ['pregaobanrisul.com.br'], subdominios: true,
    exemplo: 'https://pregaobanrisul.com.br/editais/0022_2026/355957',
    id: (u) => u.pathname.match(/\/editais\/[^/]+\/(\d+)/)?.[1] ?? null,
    descricao: (id) => `edital ${id}`,
  },
  {
    // connector-comprasbr.mjs: `urlDeProcesso`, exige ?idlicitacao=<dígitos> (ou &).
    conectorId: 'comprasbr', nome: 'Compras BR', hosts: ['comprasbr.com.br'], subdominios: true,
    exemplo: 'https://comprasbr.com.br/pregao-eletronico-detalhe/?idlicitacao=48015',
    id: (u) => u.search.match(/[?&]idlicitacao=(\d+)/i)?.[1] ?? null,
    descricao: (id) => `licitação ${id}`,
  },
  {
    // run.mjs (`resolverUrlsPCP`): o link colado vale se contém
    // 'portaldecompraspublicas.com.br/processos', com essa grafia. A listagem inteira
    // (/processos, /processos/tabela) também passaria lá e não é pregão nenhum: aqui
    // exige /processos/<uf>/<órgão>/<processo>, o formato da página (connector-pcp.mjs).
    conectorId: 'pcp', nome: 'Portal de Compras Públicas', hosts: ['portaldecompraspublicas.com.br', 'www.portaldecompraspublicas.com.br'], subdominios: false,
    exemplo: 'https://www.portaldecompraspublicas.com.br/processos/sp/orgao-123/pe-pregao-eletronico-…',
    id: (u) => u.pathname.match(/^\/processos\/[^/]+\/[^/]+\/([^/]+)/)?.[1] ?? null,
    descricao: () => 'processo',
  },
]

const HOSTS_COMPRASGOV = ['cnetmobile.estaleiro.serpro.gov.br', 'compras.gov.br', 'comprasnet.gov.br']

const hostBate = (host, hosts, subdominios) =>
  hosts.includes(host) || (subdominios && hosts.some((h) => host.endsWith(`.${h}`)))

/** Aceita o endereço sem "https://", como ele sai de muita barra de endereço copiada. */
function paraUrl(texto) {
  // Link copiado de e-mail ou WhatsApp vem com texto depois ("… Pregão 12/2026") ou com a
  // pontuação da frase colada no fim. `new URL` codificaria isso dentro do endereço, e o
  // coletor abriria um processo que não existe.
  const bruto = (String(texto ?? '').trim().split(/\s+/)[0] ?? '').replace(/[).,;:!?]+$/, '')
  if (!bruto) return null
  const comEsquema = /^[a-z][a-z0-9+.-]*:/i.test(bruto) ? bruto : /^[^\s/]+\.[^\s/]+(\/|$)/.test(bruto) ? `https://${bruto}` : null
  if (!comEsquema) return null
  try {
    const u = new URL(comEsquema)
    // Todos os portais servem https; quem cola http leva o mesmo endereço em https,
    // que é o único que o coletor do BLL/BNC aceita.
    if (u.protocol === 'http:') u.protocol = 'https:'
    return u.protocol === 'https:' ? u : null
  } catch { return null }
}

/**
 * Nº de controle do PNCP a partir do link da página do edital
 * (`pncp.gov.br/app/editais/<cnpj>/<ano>/<sequencial>`). O inverso de `paginaEditalPncp`
 * em AcoesLicitacao: o sequencial vai com 6 dígitos e o tipo é 1 (contratação).
 */
function numeroPncp(u) {
  if (u.hostname !== 'pncp.gov.br' && u.hostname !== 'www.pncp.gov.br') return null
  const m = u.pathname.match(/^\/app\/editais\/(\d{14})\/(\d{4})\/(\d{1,6})\/?$/)
  return m ? `${m[1]}-1-${m[3].padStart(6, '0')}/${m[2]}` : null
}

/**
 * @param {string} texto o que a pessoa colou
 * @param {Iterable<string>} leitores ids de conector que algum coletor lê
 *   (`LEITORES` de lib/radar/conectores.ts); vem de fora para o módulo continuar
 *   testável em Node puro, como em chat-externo.mjs
 * @returns {{ tipo: 'vazio' }
 *   | { tipo: 'portal', conectorId: string, nome: string, url: string, idPortal: string, descricao: string }
 *   | { tipo: 'pncp', numeroControle: string }
 *   | { tipo: 'erro', motivo: 'nao_e_link' | 'formato' | 'sem_leitor' | 'desconhecido', mensagem: string }}
 */
export function lerLink(texto, leitores = []) {
  if (!String(texto ?? '').trim()) return { tipo: 'vazio' }
  const u = paraUrl(texto)
  if (!u) return { tipo: 'erro', motivo: 'nao_e_link', mensagem: 'Cole o endereço completo da página do pregão, como aparece na barra do navegador (https://…).' }
  // Usuário, senha ou porta no endereço: nenhum portal publica assim, e o coletor do
  // BLL/BNC recusa. Melhor dizer já do que salvar um link que ninguém vai abrir.
  if (u.username || u.password || u.port) return { tipo: 'erro', motivo: 'nao_e_link', mensagem: 'Este endereço traz usuário, senha ou porta. Cole o link direto da página do pregão.' }
  const host = u.hostname.toLowerCase()

  const pncp = numeroPncp(u)
  if (pncp) return { tipo: 'pncp', numeroControle: pncp }
  if (host === 'pncp.gov.br' || host === 'www.pncp.gov.br') {
    return { tipo: 'erro', motivo: 'formato', mensagem: 'Do PNCP, cole o link da página do edital: pncp.gov.br/app/editais/<CNPJ>/<ano>/<nº>.' }
  }

  if (hostBate(host, HOSTS_COMPRASGOV, true)) {
    const compra = compraPublica(u.href)
    if (compra) return { tipo: 'portal', conectorId: 'comprasgov', nome: 'Compras.gov.br', url: compra.url, idPortal: compra.chave, descricao: descreverCompra(compra.chave) }
    return { tipo: 'erro', motivo: 'formato', mensagem: 'No Compras.gov.br, cole o link público de acompanhamento da compra: cnetmobile.estaleiro.serpro.gov.br/…/acompanhamento-compra?compra=… (17 dígitos). Ou cole o link do edital no PNCP.' }
  }

  const lidos = new Set(leitores)
  for (const regra of REGRAS) {
    if (!hostBate(host, regra.hosts, regra.subdominios)) continue
    if (!lidos.has(regra.conectorId)) return { tipo: 'erro', motivo: 'sem_leitor', mensagem: `O Radar não está lendo o ${regra.nome} no momento.` }
    const recusa = regra.recusa?.(u)
    if (recusa) return { tipo: 'erro', motivo: 'formato', mensagem: recusa }
    const idPortal = regra.id(u)
    if (!idPortal) return { tipo: 'erro', motivo: 'formato', mensagem: `Este link do ${regra.nome} não é a página de um pregão. Abra o pregão no portal e copie o endereço dele (ex.: ${regra.exemplo}).` }
    u.hash = ''
    return { tipo: 'portal', conectorId: regra.conectorId, nome: regra.nome, url: u.href, idPortal, descricao: regra.descricao(idPortal) }
  }
  return { tipo: 'erro', motivo: 'desconhecido', mensagem: 'Não reconhecemos este endereço como página de pregão de um portal que o Radar lê.' }
}

/** "compra 00243/2026 · UASG 943001", a partir da chave de 17 dígitos. */
function descreverCompra(chave) {
  return `compra ${chave.slice(8, 13)}/${chave.slice(13)} · UASG ${chave.slice(0, 6)}`
}

/**
 * Os endereços com que o PNCP pode ter gravado esta compra em `contratacoes.link_externo`.
 * O Compras.gov.br aparece em dois formatos (ver comprasgov-publico.mjs), e a igualdade
 * exata só acha o pregão se tentar os dois.
 *
 * @param {string} texto o que a pessoa colou
 * @param {{ conectorId: string, url: string, idPortal: string }} lido
 */
export function candidatosNoPncp(texto, lido) {
  const lista = [String(texto ?? '').trim(), lido.url]
  if (lido.conectorId === 'comprasgov') {
    lista.push(`https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/landing?destino=acompanhamento-compra&compra=${lido.idPortal}`)
  }
  return [...new Set(lista.filter(Boolean))]
}
