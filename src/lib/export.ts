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

  // Column widths
  ws['!cols'] = columns.map(() => ({ wch: 22 }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Dados')
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
        body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 20px; }
        h1 { font-size: 14px; margin-bottom: 4px; }
        p.meta { font-size: 10px; color: #666; margin-bottom: 12px; }
        table { border-collapse: collapse; width: 100%; }
        th { background: #1a1a2e; color: #fff; padding: 6px 8px; text-align: left; font-size: 10px; text-transform: uppercase; }
        td { padding: 5px 8px; border-bottom: 1px solid #eee; font-size: 11px; }
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
