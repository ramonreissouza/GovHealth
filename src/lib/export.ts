// src/lib/export.ts
import * as XLSX from 'xlsx'

export interface ExportColumn<T = Record<string, unknown>> {
  key: keyof T & string
  label: string
  format?: (value: unknown, row: T) => string
}

function applyFormat<T>(col: ExportColumn<T>, row: T): string {
  const val = (row as Record<string, unknown>)[col.key]
  if (col.format) return col.format(val, row)
  if (val == null) return ''
  if (typeof val === 'number') return String(val)
  return String(val)
}

// Largura de coluna adaptativa (em caracteres): usa o maior conteúdo da coluna
// (cabeçalho + células), com piso e teto para não estourar. Sem isso, links longos
// (ex.: URL do edital) apareciam "cortados" na largura fixa do Excel.
function autoColWidths<T>(data: T[], columns: ExportColumn<T>[]): { wch: number }[] {
  return columns.map((col) => {
    let max = col.label.length
    for (const row of data) {
      const len = applyFormat(col, row).length
      if (len > max) max = len
    }
    return { wch: Math.min(Math.max(max + 2, 10), 80) }
  })
}

export function exportToCSV<T>(data: T[], columns: ExportColumn<T>[], filename: string) {
  const header = columns.map((c) => `"${c.label}"`).join(',')
  const rows = data.map((row) =>
    columns.map((col) => {
      const v = applyFormat(col, row).replace(/"/g, '""')
      return `"${v}"`
    }).join(',')
  )
  const csv = [header, ...rows].join('\r\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  triggerDownload(blob, `${filename}.csv`)
}

export function exportToXLSX<T>(data: T[], columns: ExportColumn<T>[], filename: string) {
  const ws_data = [
    columns.map((c) => c.label),
    ...data.map((row) => columns.map((col) => applyFormat(col, row))),
  ]
  const ws = XLSX.utils.aoa_to_sheet(ws_data)

  // Column widths — adaptáveis ao conteúdo (links longos não ficam cortados).
  ws['!cols'] = autoColWidths(data, columns)

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Dados')
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

export interface ExportSheet {
  name: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ExportColumn<any>[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[]
}

/** Exporta várias tabelas como um único .xlsx (uma aba por conjunto). */
export function exportSheetsToXLSX(sheets: ExportSheet[], filename: string) {
  const wb = XLSX.utils.book_new()
  const usados = new Set<string>()
  for (const s of sheets) {
    const ws_data = [
      s.columns.map((c) => c.label),
      ...s.data.map((row) => s.columns.map((col) => applyFormat(col, row))),
    ]
    const ws = XLSX.utils.aoa_to_sheet(ws_data)
    ws['!cols'] = autoColWidths(s.data, s.columns)
    // Nome da aba: máx 31 chars e único.
    let nome = s.name.slice(0, 31)
    let i = 2
    while (usados.has(nome)) { nome = `${s.name.slice(0, 28)} ${i++}` }
    usados.add(nome)
    XLSX.utils.book_append_sheet(wb, ws, nome)
  }
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

export function printTable<T>(data: T[], columns: ExportColumn<T>[], title: string) {
  const rows = data.map((row) =>
    `<tr>${columns.map((col) => `<td>${applyFormat(col, row)}</td>`).join('')}</tr>`
  ).join('')

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8"/>
      <title>${title}</title>
      <style>
        /* Paisagem + fonte compacta = mais largura por coluna, então links longos
           (URL do edital) cabem sem quebra feia. table-layout automático deixa cada
           coluna do tamanho do seu conteúdo (a de link fica larga, "UF" fica estreita). */
        @page { size: A4 landscape; margin: 10mm; }
        body { font-family: Arial, sans-serif; font-size: 9px; color: #111; margin: 0; }
        h1 { font-size: 13px; margin: 0 0 2px; }
        p.meta { font-size: 9px; color: #666; margin: 0 0 10px; }
        table { border-collapse: collapse; width: 100%; }
        th { background: #1a1a2e; color: #fff; padding: 4px 6px; text-align: left; font-size: 8px; text-transform: uppercase; }
        td { padding: 3px 6px; border-bottom: 1px solid #eee; font-size: 9px; overflow-wrap: anywhere; vertical-align: top; }
        tr:nth-child(even) td { background: #f9f9f9; }
      </style>
    </head>
    <body>
      <h1>${title}</h1>
      <p class="meta">Gerado em ${new Date().toLocaleString('pt-BR')} · GovHealth AI</p>
      <table>
        <thead><tr>${columns.map((c) => `<th>${c.label}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body>
    </html>
  `

  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => { win.print(); win.close() }, 400)
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
