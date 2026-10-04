// scripts/lib/zip.mjs — lê arquivos de dentro de um .zip, só com o zlib do Node.
//
// Existe porque a imagem da VPS (Linux) não tem `unzip`, e o `tar` do GNU não abre zip
// (o do Windows abre, o que esconderia o problema em teste local). Cobre o que os
// arquivos de dados abertos usam: zip comum, entradas "stored" (0) ou "deflate" (8),
// sem criptografia. ZIP64 (> 4 GB) recusa com erro claro em vez de ler errado.

import zlib from 'node:zlib'

const ASSIN_FIM = 0x06054b50   // End Of Central Directory
const ASSIN_CENTRAL = 0x02014b50
const ASSIN_LOCAL = 0x04034b50

/** Lista as entradas do zip: nome, método, tamanhos e onde começa o cabeçalho local. */
export function entradasZip(buf) {
  // O EOCD fica nos últimos 22 bytes + até 64 KB de comentário.
  let fim = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === ASSIN_FIM) { fim = i; break }
  }
  if (fim < 0) throw new Error('não é um arquivo zip (fim do diretório não encontrado)')
  const total = buf.readUInt16LE(fim + 10)
  let p = buf.readUInt32LE(fim + 16)
  if (p === 0xffffffff || total === 0xffff) throw new Error('zip64 não suportado')
  const out = []
  for (let k = 0; k < total; k++) {
    if (buf.readUInt32LE(p) !== ASSIN_CENTRAL) throw new Error('diretório central do zip corrompido')
    const metodo = buf.readUInt16LE(p + 10)
    const flags = buf.readUInt16LE(p + 8)
    const comprimido = buf.readUInt32LE(p + 20)
    const tamanho = buf.readUInt32LE(p + 24)
    const nLen = buf.readUInt16LE(p + 28), xLen = buf.readUInt16LE(p + 30), cLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const nome = buf.toString((flags & 0x800) ? 'utf8' : 'latin1', p + 46, p + 46 + nLen)
    out.push({ nome, metodo, flags, comprimido, tamanho, local })
    p += 46 + nLen + xLen + cLen
  }
  return out
}

/** O conteúdo de uma entrada (Buffer). */
export function lerEntrada(buf, e) {
  if (e.flags & 0x1) throw new Error(`${e.nome}: entrada criptografada`)
  if (buf.readUInt32LE(e.local) !== ASSIN_LOCAL) throw new Error(`${e.nome}: cabeçalho local corrompido`)
  const ini = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28)
  const dados = buf.subarray(ini, ini + e.comprimido)
  const bruto = e.metodo === 0 ? dados : e.metodo === 8 ? zlib.inflateRawSync(dados) : null
  if (!bruto) throw new Error(`${e.nome}: método de compressão ${e.metodo} não suportado`)
  if (bruto.length !== e.tamanho) throw new Error(`${e.nome}: tamanho lido ${bruto.length} ≠ ${e.tamanho}`)
  return bruto
}

/** As entradas cujo nome termina com algum dos sufixos pedidos: sufixo → Buffer. */
export function lerDoZip(buf, sufixos) {
  const r = new Map()
  for (const e of entradasZip(buf)) {
    const s = sufixos.find((x) => e.nome.endsWith(x))
    if (s) r.set(s, lerEntrada(buf, e))
  }
  return r
}
