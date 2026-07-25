// src/lib/pdf.ts
// Extração de texto de PDF no cliente (pdfjs-dist). Roda só no browser.
//
// O worker é servido SAME-ORIGIN (public/pdf.worker.min.js), NÃO de CDN: a CSP do app
// (next.config: `worker-src 'self' blob:`) bloqueia workers cross-origin (unpkg), o que
// fazia a leitura do PDF falhar com "não foi possível ler o PDF".
// ⚠️ O arquivo em /public é uma cópia de node_modules/pdfjs-dist/build/pdf.worker.min.mjs
// e DEVE casar a versão do pacote — ao atualizar pdfjs-dist, recopie o worker.

const PDF_WORKER_SRC = '/pdf.worker.min.js'

/** Extrai o texto de todas as páginas de um PDF. Lança erro se o arquivo for inválido. */
export async function extrairTextoPDF(
  file: File,
  onProgress?: (pagina: number, total: number) => void,
): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC

  const buffer = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buffer }).promise

  const partes: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const texto = content.items.map((it) => ('str' in it ? it.str : '')).join(' ')
    partes.push(texto)
    onProgress?.(i, doc.numPages)
  }
  return partes.join('\n\n').replace(/[ \t]+/g, ' ').trim()
}
