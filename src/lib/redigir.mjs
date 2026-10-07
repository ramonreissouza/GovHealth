// src/lib/redigir.mjs — tira dado sensível de texto que vai para a telemetria (TS-540).
//
// Passam por aqui todos os spans antes de sair do processo (o exportador de
// src/lib/otel.mjs) e os erros que o navegador manda (src/lib/erro-cliente-servidor.ts).
// Em .mjs porque o otel.mjs também roda fora do Next, no worker.
//
// O que some:
// - query string e fragmento de qualquer URL ou caminho. Busca, filtros, CNPJ,
//   sessão e token costumam ir em `?…`. O `:linha:coluna` de uma stack é preservado.
// - e-mail, CPF (com ou sem pontuação) e qualquer sequência solta de 11 dígitos
//   (celular com DDD também)
// - `Bearer …`, JWT, pares `token=`/`senha=`/`secret=`… fora de URL, e sequências
//   longas de letras e dígitos com cara de chave
//
// É uma rede, não uma garantia: o código continua sem pôr dado pessoal em nome de
// span ou atributo. Esta função pega o que escapa.

const URL_COM_QUERY = /(\/[^\s?#"'<>()]*)[?#][^\s"'<>)]*?(?=(?::\d+:\d+)?(?:[\s"'<>)]|$))/g
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const BEARER = /\bBearer\s+[^\s"']+/gi
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g
const PAR_SECRETO = /\b(token|access_token|refresh_token|senha|password|secret|api[_-]?key|authorization|code)=[^\s&"']+/gi
const CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{11}\b/g
// 32+ caracteres com pelo menos uma letra e um dígito: chave, hash, UUID. Exigir os
// dois poupa identificador de SQL (`idx_contratacoes_orgao_categoria`).
const CHAVE_LONGA = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g

/** @param {string} texto */
export function redigir(texto) {
  return texto
    .replace(URL_COM_QUERY, '$1')
    .replace(EMAIL, '[email]')
    .replace(BEARER, 'Bearer [token]')
    .replace(JWT, '[token]')
    .replace(PAR_SECRETO, '$1=[redigido]')
    .replace(CPF, '[documento]')
    .replace(CHAVE_LONGA, '[token]')
}

// Chaves que já são um valor seguro e que a redação estragaria. O `digest` do Next
// é um número de até 10 dígitos e não casa com o CPF, mas fica explícito aqui.
const INTACTAS = new Set(['erro.digest', 'erro.fingerprint'])

/**
 * Atributos de span ou de evento, redigidos. `url.query` sai inteiro.
 * @param {Record<string, unknown> | undefined} atributos
 */
export function redigirAtributos(atributos) {
  if (!atributos) return atributos
  /** @type {Record<string, unknown>} */
  const saida = {}
  for (const [chave, valor] of Object.entries(atributos)) {
    if (chave === 'url.query') continue
    if (INTACTAS.has(chave)) { saida[chave] = valor; continue }
    saida[chave] = typeof valor === 'string'
      ? redigir(valor)
      : Array.isArray(valor)
        ? valor.map((v) => (typeof v === 'string' ? redigir(v) : v))
        : valor
  }
  return saida
}
