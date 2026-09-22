// scripts/radar/sessao-escopo.mjs — RECORTE do storage_state antes de cifrar.
//
// O QUE ESTE ARQUIVO IMPEDE
//
// O cofre do Radar guardava o `storageState()` inteiro do navegador, sem filtro nenhum.
// Medido no cofre de produção em 22/09/2026, a sessão mais recente do `comprasgov`
// tinha 11 cookies:
//
//   sso.acesso.gov.br   9 cookies  (Session_Gov_Br_Prod, Govbrid, GovbrUid_*, TSPD_*, ...)
//   www.comprasnet.gov.br  2 cookies  (ASPSESSIONID*)
//
// Os 9 primeiros NÃO são a sessão do Compras.gov.br. São a sessão do **Login Único da
// pessoa física** — a mesma que abre e-CAC, Meu INSS, FGTS e Conecte SUS (dado de saúde,
// art. 11 da LGPD). O fornecedor consentiu em ser monitorado num portal de licitação;
// guardar a chave da vida civil dele inteira não é o que ele consentiu, e o vazamento
// desse cofre teria consequência muito maior do que o serviço justifica.
//
// Duas sessões mais antigas do mesmo cofre guardavam APENAS `_ga` e `_ga_623FPXHZ7K` do
// `.serpro.gov.br`: analytics do Google, cifrado e guardado como se fosse credencial.
//
// A REGRA: só sobrevive cookie de domínio que o conector daquele portal precisa para
// ler. Tudo o mais é descartado ANTES de cifrar — não depois, não "na leitura".
//
// ── SOBRE DESCARTAR O sso.acesso.gov.br ──────────────────────────────────────────────
//
// É deliberado, e tem um custo possível: se o portal renova sozinho a sessão dele
// seguindo um repasse pelo SSO, sem os cookies do SSO essa renovação silenciosa deixa de
// acontecer e a sessão passa a expirar de verdade — o conector então devolve
// `sessao_expirada` e o fornecedor reconecta. É uma troca consciente: perder uma
// renovação automática vale menos do que guardar a identidade civil do cliente.
//
// Se a medição mostrar que a renovação era real e frequente, `RADAR_SESSAO_MANTER_SSO=1`
// devolve o comportamento antigo sem deploy — mas isso é um remendo para comparar, não
// uma configuração para ficar ligada.

import { PORTAIS } from './portais.mjs'

/**
 * Domínios de sessão por portal.
 *
 * Quando um portal não aparece aqui, a lista é derivada dos hosts de `loginUrl` e
 * `areaUrl` do próprio registro — que é exatamente onde o conector navega. Só entra
 * nesta tabela o portal cujo conector precisa de um host que não está nas duas URLs.
 */
const DOMINIOS_POR_PORTAL = {
  // O Compras.gov.br é o único que atravessa TRÊS hosts: o portal ASP clássico
  // (`www.comprasnet.gov.br`), a SPA do fornecedor (`cnetmobile.estaleiro.serpro.gov.br`)
  // e o SSO do gov.br. Os dois primeiros ficam; o SSO sai, pelo motivo no topo.
  //
  // `cnetmobile.estaleiro.serpro.gov.br` está por extenso de propósito: escrever
  // `serpro.gov.br` traria junto os cookies de analytics do `.serpro.gov.br`, que é
  // exatamente o lixo que este arquivo existe para não guardar.
  comprasgov: [
    'comprasnet.gov.br',
    'cnetmobile.estaleiro.serpro.gov.br',
    'compras.gov.br',
    'comprasgovernamentais.gov.br',
  ],
}

/** `.Sso.Acesso.GOV.BR` → `sso.acesso.gov.br`. */
function normalizar(dominio) {
  return String(dominio ?? '').trim().toLowerCase().replace(/^\./, '')
}

/**
 * Um domínio genérico demais na lista permitiria TUDO — `gov.br` casaria com
 * `sso.acesso.gov.br`, e o recorte viraria enfeite. Sufixos públicos de dois rótulos
 * (`gov.br`, `com.br`, `org.br`...) exigem pelo menos três rótulos para valer.
 */
export function dominioEspecificoBastante(dominio) {
  const d = normalizar(dominio)
  if (!d || d.includes('/') || d.includes(':')) return false
  const partes = d.split('.')
  if (partes.length < 2) return false
  const doisUltimos = partes.slice(-2).join('.')
  const sufixosCompostos = /^(gov|com|org|net|edu|mil|leg|jus)\.(br|ar|uk|au|za)$/
  return sufixosCompostos.test(doisUltimos) ? partes.length >= 3 : partes.length >= 2
}

/** Lista de domínios permitidos para um portal. Lança se a lista for genérica demais. */
export function dominiosDoPortal(conectorId) {
  const explicita = DOMINIOS_POR_PORTAL[conectorId]
  const lista = explicita ?? derivarDoRegistro(conectorId)
  const ruins = lista.filter((d) => !dominioEspecificoBastante(d))
  if (ruins.length) {
    throw new Error(
      `dominio generico demais na lista de sessao de '${conectorId}': ${ruins.join(', ')} ` +
      '— um sufixo publico (gov.br, com.br) casa com o SSO inteiro e anula o recorte')
  }
  return lista
}

function derivarDoRegistro(conectorId) {
  const meta = PORTAIS[conectorId]
  if (!meta) return []
  const hosts = new Set()
  for (const u of [meta.loginUrl, meta.areaUrl]) {
    if (!u) continue
    try { hosts.add(new URL(u).hostname.toLowerCase().replace(/^www\./, '')) } catch { /* ignora */ }
  }
  return [...hosts]
}

/** O domínio do cookie está coberto por algum permitido? */
function permitido(dominio, lista) {
  const d = normalizar(dominio)
  if (!d) return false
  return lista.some((alvo) => {
    const a = normalizar(alvo)
    return d === a || d.endsWith('.' + a)
  })
}

/**
 * Recorta o storage_state, mantendo só o que o conector do portal precisa.
 *
 * NÃO muta a entrada. Devolve o estado novo e o inventário do que saiu, para que o
 * chamador possa REGISTRAR o descarte — um recorte silencioso é indistinguível de um
 * recorte que não aconteceu, e este repositório já pagou caro por silêncio.
 *
 * @param {{cookies?: Array, origins?: Array}} estado  saída de `context.storageState()`
 * @param {string} conectorId
 * @returns {{ estado: object, mantidos: number, descartados: Array<{dominio: string, n: number}> }}
 */
export function recortarSessao(estado, conectorId) {
  const entrada = estado && typeof estado === 'object' ? estado : {}
  const cookies = Array.isArray(entrada.cookies) ? entrada.cookies : []
  const origins = Array.isArray(entrada.origins) ? entrada.origins : []

  // Escape hatch para COMPARAR, não para ficar ligado. Ver o cabeçalho.
  if (process.env.RADAR_SESSAO_MANTER_SSO === '1') {
    return { estado: entrada, mantidos: cookies.length, descartados: [] }
  }

  const lista = dominiosDoPortal(conectorId)
  // Sem lista não há recorte possível — e recortar contra lista vazia apagaria a sessão
  // inteira, transformando um ganho de privacidade em perda de serviço. Devolve intacto
  // e deixa o rastro, para que a ausência apareça em vez de virar um cofre vazio.
  if (!lista.length) {
    return { estado: entrada, mantidos: cookies.length, descartados: [], semLista: conectorId }
  }

  const fora = new Map()
  const mantidos = cookies.filter((c) => {
    if (permitido(c?.domain, lista)) return true
    const d = normalizar(c?.domain) || '(sem dominio)'
    fora.set(d, (fora.get(d) ?? 0) + 1)
    return false
  })

  const origensMantidas = origins.filter((o) => {
    let host = ''
    try { host = new URL(o?.origin ?? '').hostname } catch { host = '' }
    if (permitido(host, lista)) return true
    const d = host || '(origin invalida)'
    fora.set(d, (fora.get(d) ?? 0) + 1)
    return false
  })

  return {
    estado: { ...entrada, cookies: mantidos, origins: origensMantidas },
    mantidos: mantidos.length,
    descartados: [...fora.entries()].map(([dominio, n]) => ({ dominio, n })).sort((a, b) => b.n - a.n),
  }
}

/** Uma linha legível do que foi descartado, para log e auditoria. */
export function resumoDescarte(descartados) {
  if (!descartados?.length) return 'nada fora do escopo'
  return descartados.map((d) => `${d.dominio}:${d.n}`).join(' ')
}

/**
 * Serializa já recortado. É este o ponto que os chamadores devem usar — trocar
 * `JSON.stringify(await ctx.storageState())` por esta chamada é a mudança inteira.
 */
export function serializarSessaoRecortada(estado, conectorId, { aoDescartar } = {}) {
  const r = recortarSessao(estado, conectorId)
  if (r.semLista) {
    console.warn(`[sessao-escopo] portal '${r.semLista}' sem dominios conhecidos — nada recortado`)
  } else if (r.descartados.length && aoDescartar) {
    aoDescartar(r.descartados)
  }
  return { json: JSON.stringify(r.estado), ...r }
}
