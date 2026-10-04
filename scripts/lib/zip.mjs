// scripts/lib/zip.mjs — lê arquivos de dentro de um .zip, só com o zlib do Node.
//
// Existe porque a imagem da VPS (Linux) não tem `unzip`, e o `tar` do GNU não abre zip
// (o do Windows abre, o que esconderia o problema em teste local). Cobre o que os
// arquivos de dados abertos usam: zip comum, entradas "stored" (0) ou "deflate" (8),
// sem criptografia. ZIP64 (> 4 GB) recusa com erro claro em vez de ler errado.
//
// O ZIP VEM DE FORA (servidor da CGU), então nada nele é confiado: toda posição é
// conferida contra o tamanho do arquivo, o tamanho descomprimido de cada entrada e do
// total tem teto (o pod tem memória limitada; um arquivo corrompido ou adulterado que
// declarasse uma entrada enorme derrubaria o pod), a descompressão nunca passa do
// tamanho declarado, e o CRC de cada entrada é conferido antes de o CSV ser aceito.

import zlib from 'node:zlib'

const ASSIN_FIM = 0x06054b50   // End Of Central Directory
const ASSIN_CENTRAL = 0x02014b50
const ASSIN_LOCAL = 0x04034b50

/** Tetos padrão: os CSVs diários da CGU têm ~25 MB cada e ~70 MB juntos. */
export const LIMITES_ZIP = { porEntrada: 256 * 1024 * 1024, total: 512 * 1024 * 1024 }

// CRC-32 (o do zip). zlib.crc32 existe a partir do Node 22.2; a tabela é o plano B.
let tabelaCrc = null
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0
  if (!tabelaCrc) {
    tabelaCrc = new Uint32Array(256)
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tabelaCrc[n] = c >>> 0 }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = tabelaCrc[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dentro(buf, ini, tam, oQue) {
  if (!Number.isInteger(ini) || ini < 0 || tam < 0 || ini + tam > buf.length) {
    throw new Error(`zip inválido: ${oQue} fora do arquivo`)
  }
}

/** Lista as entradas do zip: nome, método, tamanhos, CRC e onde começa o cabeçalho local. */
export function entradasZip(buf) {
  // O EOCD fica nos últimos 22 bytes + até 64 KB de comentário.
  let fim = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === ASSIN_FIM) { fim = i; break }
  }
  if (fim < 0) throw new Error('não é um arquivo zip (fim do diretório não encontrado)')
  const total = buf.readUInt16LE(fim + 10)
  const tamCentral = buf.readUInt32LE(fim + 12)
  let p = buf.readUInt32LE(fim + 16)
  if (p === 0xffffffff || total === 0xffff) throw new Error('zip64 não suportado')
  dentro(buf, p, tamCentral, 'diretório central')
  const out = []
  for (let k = 0; k < total; k++) {
    dentro(buf, p, 46, 'entrada do diretório central')
    if (buf.readUInt32LE(p) !== ASSIN_CENTRAL) throw new Error('diretório central do zip corrompido')
    const nLen = buf.readUInt16LE(p + 28), xLen = buf.readUInt16LE(p + 30), cLen = buf.readUInt16LE(p + 32)
    dentro(buf, p + 46, nLen + xLen + cLen, 'nome da entrada')
    const flags = buf.readUInt16LE(p + 8)
    out.push({
      nome: buf.toString((flags & 0x800) ? 'utf8' : 'latin1', p + 46, p + 46 + nLen),
      metodo: buf.readUInt16LE(p + 10),
      flags,
      crc: buf.readUInt32LE(p + 16),
      comprimido: buf.readUInt32LE(p + 20),
      tamanho: buf.readUInt32LE(p + 24),
      local: buf.readUInt32LE(p + 42),
    })
    p += 46 + nLen + xLen + cLen
  }
  return out
}

/** O conteúdo de uma entrada (Buffer), conferido contra o tamanho e o CRC declarados. */
export function lerEntrada(buf, e, limites = LIMITES_ZIP) {
  if (e.flags & 0x1) throw new Error(`${e.nome}: entrada criptografada`)
  if (e.tamanho > limites.porEntrada) throw new Error(`${e.nome}: ${e.tamanho} bytes descomprimidos, acima do teto de ${limites.porEntrada}`)
  dentro(buf, e.local, 30, `${e.nome}: cabeçalho local`)
  if (buf.readUInt32LE(e.local) !== ASSIN_LOCAL) throw new Error(`${e.nome}: cabeçalho local corrompido`)
  const ini = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28)
  dentro(buf, ini, e.comprimido, `${e.nome}: dados`)
  const dados = buf.subarray(ini, ini + e.comprimido)
  let bruto
  if (e.metodo === 0) bruto = dados
  else if (e.metodo === 8) {
    // maxOutputLength: mesmo com o tamanho declarado mentindo, não passa dele.
    try { bruto = zlib.inflateRawSync(dados, { maxOutputLength: Math.max(1, e.tamanho) }) }
    catch (err) { throw new Error(`${e.nome}: descompressão falhou (${err.code ?? err.message})`) }
  } else throw new Error(`${e.nome}: método de compressão ${e.metodo} não suportado`)
  if (bruto.length !== e.tamanho) throw new Error(`${e.nome}: tamanho lido ${bruto.length} ≠ ${e.tamanho}`)
  if (crc32(bruto) !== e.crc) throw new Error(`${e.nome}: CRC não confere (arquivo corrompido)`)
  return bruto
}

/** As entradas cujo nome termina com algum dos sufixos pedidos: sufixo → Buffer. */
export function lerDoZip(buf, sufixos, limites = LIMITES_ZIP) {
  const r = new Map()
  let total = 0
  for (const e of entradasZip(buf)) {
    const s = sufixos.find((x) => e.nome.endsWith(x))
    if (!s) continue
    total += e.tamanho
    if (total > limites.total) throw new Error(`zip: ${total} bytes descomprimidos no total, acima do teto de ${limites.total}`)
    r.set(s, lerEntrada(buf, e, limites))
  }
  return r
}
