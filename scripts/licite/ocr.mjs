// scripts/licite/ocr.mjs — OCR gratuito do CAPTCHA do Licitações-e (tesseract.js + jimp).
// O CAPTCHA é texto simples de 5 caracteres (minúsculas + dígitos) com uma linha
// diagonal e gradiente azul. Pré-processamos (escala + cinza + binariza) e lemos.
// Não acerta 100% por tentativa — o chamador faz RETRY com imagem nova (é grátis).

import { Jimp } from 'jimp'
import { createWorker } from 'tesseract.js'

const WHITELIST = 'abcdefghijklmnopqrstuvwxyz0123456789'

// Binariza para realçar o texto preto sobre o gradiente. `scale` amplia (ajuda o
// Tesseract em fontes pequenas). Retorna PNG buffer.
async function preprocessar(buffer, threshold = 110) {
  const img = await Jimp.read(buffer)
  img.scale(3).greyscale().contrast(0.6)
  img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, i) {
    const v = this.bitmap.data[i]
    const b = v < threshold ? 0 : 255
    this.bitmap.data[i] = b; this.bitmap.data[i + 1] = b; this.bitmap.data[i + 2] = b
  })
  return img.getBuffer('image/png')
}

// Limpa a leitura do Tesseract → 5 chars alfanuméricos minúsculos.
// A linha diagonal costuma virar caractere fantasma nas pontas; se vier >5, mantemos
// os 5 primeiros (o ruído tende a ficar no fim).
function limpar(texto) {
  const s = (texto || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return s.length > 5 ? s.slice(0, 5) : s
}

/**
 * Cria um solver reutilizável (o worker do Tesseract é caro de instanciar).
 *   const ocr = await criarSolver(); const guess = await ocr.solve(buf); await ocr.fechar()
 */
export async function criarSolver() {
  const worker = await createWorker('eng')
  await worker.setParameters({ tessedit_char_whitelist: WHITELIST, tessedit_pageseg_mode: '8' })

  return {
    async solve(buffer) {
      // Vota entre 2 thresholds; prefere um palpite de exatamente 5 chars.
      const cands = []
      for (const thr of [110, 135]) {
        try {
          const pre = await preprocessar(buffer, thr)
          const { data } = await worker.recognize(pre)
          cands.push(limpar(data.text))
        } catch { /* ignora */ }
      }
      const cinco = cands.find((c) => c.length === 5)
      return cinco || cands.sort((a, b) => b.length - a.length)[0] || ''
    },
    async fechar() { await worker.terminate() },
  }
}
