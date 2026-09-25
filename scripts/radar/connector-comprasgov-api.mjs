import { createHash } from 'node:crypto'
import { validarChaveCompra, chaveDaRepresentacao } from '../../src/lib/radar/comprasgov-identidade.mjs'

export class ErroCompras extends Error {
  constructor(message, status = 0, retryAfter = 300) {
    super(message)
    this.status = status
    this.retryAfter = retryAfter
  }
}

export function dataUTC(valor) {
  // O contrato declara UTC; o guia também mostra datas sem Z e com espaço.
  if (typeof valor !== 'string' || !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)?$/.test(valor)) {
    throw new ErroCompras('Resposta com data de mensagem inválida.')
  }
  const data = valor.replace(' ', 'T')
  const utc = /(?:Z|[+-]\d\d:\d\d)$/.test(data) ? data : `${data}Z`
  if (!Number.isFinite(Date.parse(utc))) throw new ErroCompras('Resposta com data de mensagem inválida.')
  return new Date(utc).toISOString()
}

/**
 * O que do payload do Integra Compras vai para `radar_mensagens.raw`. Era `raw: m` —
 * o objeto inteiro, com todo campo que o provedor mandar hoje e amanhã (revisão da #39).
 * Minimização (LGPD, art. 6º III): só o que serve para DIAGNOSTICAR uma mensagem, que é
 * exatamente o que este normalizador já lê. O `texto` tem coluna própria e não se repete
 * aqui. Campo novo do provedor não entra sem alguém decidir que ele é necessário.
 */
export const CAMPOS_RAW = ['chaveMensagem', 'categoria', 'tipoRemetente', 'identificadorItem', 'dataHora']
const TETO_CAMPO_RAW = 120

export function rawMinimo(m, chave) {
  const raw = { chaveCompra: chave }
  for (const campo of CAMPOS_RAW) {
    const v = m?.[campo]
    if (v == null) continue
    // Só escalar: um objeto ou lista aninhados seriam, de novo, "o que vier".
    if (!['string', 'number', 'boolean'].includes(typeof v)) continue
    raw[campo] = typeof v === 'string' ? v.slice(0, TETO_CAMPO_RAW) : v
  }
  return raw
}

export function normalizarMensagem(m, chave, canal) {
  let chaveRecebida
  try { chaveRecebida = chaveDaRepresentacao(m?.chaveCompra) } catch { throw new ErroCompras('Resposta sem identidade válida da compra.') }
  if (chaveRecebida !== chave) throw new ErroCompras('Resposta pertence a outra compra.')
  if (typeof m.chaveMensagem !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(m.chaveMensagem) ||
      typeof m.texto !== 'string' || !m.texto.trim()) throw new ErroCompras('Resposta sem identificador ou texto da mensagem.')
  const categorias = []
  if (canal === 'diligencias') categorias.push('diligencia')
  if (String(m.categoria) === '8') categorias.push('convocacao')
  if (String(m.categoria) === '12') categorias.push('recurso')
  if (/prazo|até|ate\s+\d/i.test(m.texto)) categorias.push('prazo')
  return {
    id: m.chaveMensagem.toLowerCase(), texto: m.texto,
    autor: ({ '0': 'Sistema', '1': 'Fornecedor', '3': 'Pregoeiro' })[String(m.tipoRemetente)] ?? 'Portal',
    horario: dataUTC(m.dataHora), lote: m.identificadorItem == null ? null : String(m.identificadorItem),
    categorias, prioridade: categorias.length ? 'alta' : 'normal', raw: rawMinimo(m, chave),
  }
}

export function hashMensagem(titularId, processoId, canal, id) {
  return createHash('sha256').update(JSON.stringify(['integra-compras', titularId, processoId, canal, id])).digest('hex')
}

export function retryAfterSegundos(valor, agora = Date.now()) {
  const n = Number(valor)
  const segundos = valor && Number.isFinite(n) ? n : (Date.parse(valor ?? '') - agora) / 1000
  return Number.isFinite(segundos) ? Math.max(1, Math.ceil(segundos)) : 300
}

export class ClienteComprasgov {
  constructor({ key, secret, ambiente = 'producao', maxRequests = 20, fetchImpl = fetch }) {
    if (!key || !secret) throw new ErroCompras('Credenciais do Integra Compras não configuradas.')
    if (!['producao', 'homologacao'].includes(ambiente)) throw new ErroCompras('Ambiente Integra Compras inválido.')
    if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 1000) throw new ErroCompras('Limite de consultas inválido (1 a 1000).')
    this.key = key
    this.secret = secret
    this.fetch = fetchImpl
    this.base = `https://gateway.apiserpro.serpro.gov.br/integra-compras${ambiente === 'homologacao' ? '-hom' : ''}/v1`
    this.maxRequests = maxRequests
    this.requests = 0
    this.token = null
    this.expira = 0
  }

  async requisitar(url, options) {
    try {
      return await this.fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(25_000) })
    } catch { throw new ErroCompras('Falha de rede ao consultar o Serpro. A leitura será retomada.') }
  }

  async autenticar() {
    if (this.token && Date.now() < this.expira) return
    const r = await this.requisitar('https://gateway.apiserpro.serpro.gov.br/token', {
      method: 'POST', headers: {
        Authorization: `Basic ${Buffer.from(`${this.key}:${this.secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json',
      }, body: 'grant_type=client_credentials',
    })
    if (!r.ok) throw new ErroCompras('Autenticação Serpro recusada. Verifique as credenciais e o contrato.', r.status, retryAfterSegundos(r.headers.get('retry-after')))
    const json = await r.json().catch(() => null)
    if (!json?.access_token || !Number.isFinite(Number(json.expires_in)) || Number(json.expires_in) <= 0) {
      throw new ErroCompras('Resposta de autenticação Serpro inválida.')
    }
    this.token = json.access_token
    this.expira = Date.now() + Math.max(0, Number(json.expires_in) - 60) * 1000
  }

  async pagina({ chave, canal, desde = null, pagina = 0 }) {
    validarChaveCompra(chave)
    if (!['chat', 'diligencias'].includes(canal) || !Number.isInteger(pagina) || pagina < 0) throw new ErroCompras('Canal ou página inválida.')
    const url = new URL(`${this.base}/chat/${chave}${canal === 'diligencias' ? '/diligencias' : ''}`)
    url.searchParams.set('ordem', 'asc')
    url.searchParams.set('page', String(pagina))
    url.searchParams.set('size', '20')
    if (desde) url.searchParams.set('desde', new Date(desde).toISOString().replace(/Z$/, ''))
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      if (this.requests >= this.maxRequests) throw new ErroCompras('Limite de consultas desta rodada atingido.', 0, 60)
      await this.autenticar()
      this.requests++ // Inclui falhas, repetições e 404 (também tarifados).
      const r = await this.requisitar(url, { headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' } })
      if (r.status === 401 && tentativa === 0) { this.token = null; continue }
      if (r.status === 404) return { mensagens: [], naoEncontrado: true, parcial: false }
      if (![200, 206].includes(r.status)) {
        const detalhe = r.status === 403 ? 'Contrato sem autorização para o Integra Compras.' :
          r.status === 429 ? 'Limite do Serpro atingido; aguardando nova tentativa.' : `Consulta Serpro falhou (HTTP ${r.status}).`
        throw new ErroCompras(detalhe, r.status, retryAfterSegundos(r.headers.get('retry-after')))
      }
      const json = await r.json().catch(() => null)
      if (!Array.isArray(json) || (r.status === 206 && json.length === 0)) throw new ErroCompras('Resposta inesperada do Serpro; leitura não confirmada.')
      const mensagens = json.map((m) => normalizarMensagem(m, chave, canal))
      return { mensagens, naoEncontrado: false, parcial: r.status === 206 }
    }
    throw new ErroCompras('Autenticação Serpro não foi aceita após renovação.', 401)
  }
}
