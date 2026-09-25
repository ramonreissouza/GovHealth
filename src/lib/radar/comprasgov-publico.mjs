// Rota observada na consulta pública oficial (24/09/2026).
export const ORIGEM_COMPRAS_PUBLICO = 'https://cnetmobile.estaleiro.serpro.gov.br'
// O PNCP publica o MESMO endereço de dois jeitos. Medido em 25/09/2026 nos pregões
// monitorados pelo Radar: 688 vêm com a rota da consulta e 524 com a "landing", que só
// redireciona para ela.
//   /comprasnet-web/public/compras/acompanhamento-compra?compra=<17>
//   /comprasnet-web/public/landing?destino=acompanhamento-compra&compra=<17>
// Aceitar só a primeira deixava 524 pregões sem o chat oficial. Os dois viram a rota
// canônica; uma landing com outro `destino` não é compra e continua recusada.
const ROTA_COMPRA = /^\/comprasnet-web\/public\/compras\/acompanhamento-compra(?:\/item\/-?\d+)?\/?$/
const ROTA_LANDING = /^\/comprasnet-web\/public\/landing\/?$/
export function compraPublica(valor) {
  try {
    const url = new URL(valor)
    const chave = url.searchParams.get('compra')
    const rota = ROTA_COMPRA.test(url.pathname) ||
      (ROTA_LANDING.test(url.pathname) && url.searchParams.get('destino') === 'acompanhamento-compra')
    if (url.origin !== ORIGEM_COMPRAS_PUBLICO || url.username || url.password || !rota ||
        !chave || !/^\d{6}(03|05|06|20)\d{5}20\d{2}$/.test(chave)) return null
    return { chave, url: `${ORIGEM_COMPRAS_PUBLICO}/comprasnet-web/public/compras/acompanhamento-compra?compra=${chave}` }
  } catch { return null }
}

export function horarioPublico(valor) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(valor.trim())
  if (!m || +m[3] < 2020) throw new Error('Horário público ausente ou fora do período suportado.')
  const iso = `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00-03:00`
  const data = new Date(iso)
  const local = new Date(data.getTime() - 3 * 3600_000)
  if (!Number.isFinite(data.getTime()) || local.getUTCDate() !== +m[1] || local.getUTCMonth() + 1 !== +m[2] ||
      +m[4] > 23 || +m[5] > 59) throw new Error('Horário público inválido.')
  return data.toISOString()
}

export function mensagemPublica(linha, licitacaoId, chave) {
  if (!linha.texto?.trim() || !linha.autor?.trim()) throw new Error('Mensagem pública sem texto ou remetente.')
  return {
    licitacaoId, autor: linha.autor.trim(), lote: linha.lote?.trim() || null,
    texto: linha.lote?.trim() ? `[${linha.lote.trim()}] ${linha.texto.trim()}` : linha.texto.trim(),
    horarioOrigem: horarioPublico(linha.horario), anexos: [],
    raw: { fonte: 'comprasgov-publico', chaveCompra: chave, horarioExibido: linha.horario, precisaoHorario: 'minuto', cobertura: 'mensagens-publicas' },
  }
}
