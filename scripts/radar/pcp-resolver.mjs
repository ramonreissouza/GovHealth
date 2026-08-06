// scripts/radar/pcp-resolver.mjs — AUTO-RESOLVER da URL pública do processo no PCP.
// A busca pública do PCP (compras.api…/v2/licitacao/processos?objeto=…) devolve, para
// cada processo, `urlReferencia` (o caminho da página PÚBLICA). Este módulo procura
// pelo OBJETO (título) e PONTUA os candidatos por UF, número do edital, ano e órgão,
// devolvendo o melhor com um nível de CONFIANÇA. Sem confiança suficiente → null
// (a UI então pede o link manual — o fallback escolhido pelo produto).
//
// Puro fetch (sem browser, sem DB). Rede é a única dependência.

const API = 'https://compras.api.portaldecompraspublicas.com.br/v2/licitacao/processos'
export const PCP_BASE_PROCESSOS = 'https://www.portaldecompraspublicas.com.br/processos'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const norm = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const soDigitos = (s) => (s ?? '').replace(/\D+/g, '')

// Palavras genéricas de edital: NÃO distinguem processos (inflam o match). Removê-las
// faz o casamento depender de termos específicos (medicamentos, ambulância, máscaras…).
const STOPWORDS = new Set([
  'contratacao', 'contratar', 'empresa', 'empresas', 'especializada', 'especializadas',
  'prestacao', 'servico', 'servicos', 'aquisicao', 'fornecimento', 'registro', 'precos',
  'preco', 'futura', 'eventual', 'objeto', 'edital', 'pregao', 'eletronico', 'processo',
  'licitacao', 'municipal', 'municipio', 'prefeitura', 'secretaria', 'estado', 'publica',
  'publico', 'administracao', 'para', 'com', 'dos', 'das', 'como', 'atender', 'necessidades',
  'demanda', 'diversos', 'diversas', 'itens', 'lote', 'lotes', 'conforme', 'termo', 'referencia',
])
const tokens = (s) => norm(s).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length >= 4 && !STOPWORDS.has(t))

/** Sobreposição de tokens (Jaccard simplificado) entre duas strings. */
function overlap(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / Math.min(A.size, B.size)
}

/**
 * Tira o carimbo de portal que o PNCP põe na frente do objeto — "[Portal de Compras
 * Públicas] - ", "[LICITANET] - ". É metadado de origem, não faz parte do objeto.
 */
export function semCarimboDePortal(s) {
  return String(s ?? '').replace(/^\s*\[[^\]]{3,60}\]\s*[-–—]\s*/, '').trim()
}

/** Extrai o ano de textos como "010/2024", "PE 39/2026", "2024-297860". */
function anoDe(...ss) {
  for (const s of ss) { const m = String(s ?? '').match(/\b(20\d{2})\b/); if (m) return m[1] }
  return null
}

/** URL pública completa a partir do `urlReferencia` da API. */
export function urlPublicaDe(urlReferencia) {
  if (!urlReferencia) return null
  return `${PCP_BASE_PROCESSOS}${urlReferencia.startsWith('/') ? '' : '/'}${urlReferencia}`
}

async function buscar(objeto, { limite = 50, timeoutMs = 15000 } = {}) {
  const url = `${API}?limitePagina=${limite}&pagina=1&objeto=${encodeURIComponent(objeto)}`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: ac.signal })
    if (!r.ok) return []
    const j = await r.json().catch(() => null)
    return Array.isArray(j?.result) ? j.result : []
  } catch { return [] } finally { clearTimeout(timer) }
}

/**
 * Pontua 0..1 um candidato da API contra o alvo. Pesos: objeto (0.5), UF (0.2),
 * número do edital (0.2), ano (0.1). Órgão soma bônus dentro do objeto.
 */
function pontuar(cand, alvo) {
  const objetoCand = `${cand.resumo ?? ''} ${cand.identificacao ?? ''}`
  // Objeto é o sinal PRIMÁRIO (0.7): um casamento forte de termos específicos já
  // cruza o limiar mesmo sem UF/número. UF/número/ano ajustam para cima/baixo.
  let s = 0.7 * overlap(alvo.titulo, `${objetoCand} ${cand.razaoSocial ?? ''} ${cand.nomeUnidade ?? ''}`)
  const ufCand = cand.unidadeCompradora?.uf ?? null
  if (alvo.uf && ufCand) s += ufCand.toUpperCase() === alvo.uf.toUpperCase() ? 0.2 : -0.2
  if (alvo.numero) {
    const nAlvo = soDigitos(alvo.numero), nCand = soDigitos(cand.numero)
    if (nAlvo && nCand && (nCand.endsWith(nAlvo) || nAlvo.endsWith(nCand))) s += 0.15
  }
  const anoAlvo = anoDe(alvo.ano, alvo.numero, alvo.titulo)
  const anoCand = anoDe(cand.numero, cand.identificacao, cand.urlReferencia)
  if (anoAlvo && anoCand) s += anoAlvo === anoCand ? 0.1 : -0.1
  return Math.max(0, Math.min(1, s))
}

/**
 * @param {{titulo:string, uf?:string|null, numero?:string|null, ano?:string|null}} alvo
 * @param {{limiar?:number}} [opts]  limiar de confiança p/ auto-uso (padrão 0.6)
 * @returns {Promise<{url:string, confianca:number, candidato:object}|null>}
 */
export async function resolverUrlPublicaPCP(alvo, { limiar = 0.6 } = {}) {
  // O PNCP carimba o portal de origem no começo do objeto ("[Portal de Compras
  // Públicas] - Aquisição de…"). Esse carimbo NÃO existe no objeto do lado do PCP,
  // e mandá-lo na busca fazia a API devolver zero candidato — todo processo do PCP
  // caía em "sem match confiável" e o monitoramento público nunca saía do lugar.
  // Medido nos 4 primeiros processos reais: com o prefixo, null nos quatro; sem ele,
  // confiança 0,90 nos quatro.
  const titulo = semCarimboDePortal(alvo?.titulo)
  // Precisa de ao menos um termo específico: 2+ tokens OU um único token forte (≥6).
  const toks = tokens(titulo)
  if (!titulo || (toks.length < 2 && !(toks.length === 1 && toks[0].length >= 6))) return null
  alvo = { ...alvo, titulo }
  const cands = await buscar(titulo)
  if (!cands.length) return null
  let melhor = null
  for (const c of cands) {
    const conf = pontuar(c, alvo)
    if (!melhor || conf > melhor.confianca) melhor = { candidato: c, confianca: conf }
  }
  if (!melhor || melhor.confianca < limiar) return null
  return {
    url: urlPublicaDe(melhor.candidato.urlReferencia),
    confianca: Number(melhor.confianca.toFixed(2)),
    candidato: {
      numero: melhor.candidato.numero,
      uf: melhor.candidato.unidadeCompradora?.uf ?? null,
      orgao: melhor.candidato.razaoSocial ?? melhor.candidato.nomeUnidade ?? null,
      status: melhor.candidato.status?.descricao ?? melhor.candidato.statusProcessoPublico?.descricao ?? null,
    },
  }
}
