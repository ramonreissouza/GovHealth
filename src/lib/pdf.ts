// src/lib/pdf.ts
// Extração de texto de PDF no cliente (pdfjs-dist). Roda só no browser — o worker
// é carregado via CDN na mesma versão do pacote instalado, evitando configurar
// bundling de worker no Next. Usado pelo Copiloto de Edital para ler o PDF.

/** Extrai o texto de todas as páginas de um PDF. Lança erro se o arquivo for inválido. */
export async function extrairTextoPDF(
  file: File,
  onProgress?: (pagina: number, total: number) => void,
): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

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
