// Identidade nativa do SIASG; não é o sequencial nem a modalidade do PNCP.
export function validarChaveCompra(valor) {
  const chave = typeof valor === 'string' ? valor.trim() : ''
  if (!/^\d{17}$/.test(chave) || !['03', '05', '06', '20'].includes(chave.slice(6, 8)) ||
      Number(chave.slice(0, 6)) === 0 || Number(chave.slice(8, 13)) === 0 ||
      Number(chave.slice(13)) < 2000 || Number(chave.slice(13)) > 2099) {
    throw new Error('Informe a chave da compra com 17 dígitos: UASG (6), modalidade SIASG (2), número (5) e ano (4).')
  }
  return chave
}

export function linkComprasgovValido(valor) {
  try {
    const url = new URL(valor)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname === 'cnetmobile.estaleiro.serpro.gov.br' ||
       ['comprasnet.gov.br', 'compras.gov.br'].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)))
  } catch { return false }
}

export function chaveDaRepresentacao(compra) {
  if (!compra || ![compra.numeroUasg, compra.idModalidade, compra.numero, compra.ano].every(Number.isInteger)) {
    throw new Error('Resposta sem identidade da compra.')
  }
  return validarChaveCompra([
    String(compra.numeroUasg).padStart(6, '0'), String(compra.idModalidade).padStart(2, '0'),
    String(compra.numero).padStart(5, '0'), String(compra.ano).padStart(4, '0'),
  ].join(''))
}
