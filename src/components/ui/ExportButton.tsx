'use client'
// src/components/ui/ExportButton.tsx

import { useState, useRef, useEffect } from 'react'
import { Download, ChevronDown, FileText, Table2, Printer } from 'lucide-react'
import { exportToCSV, exportToXLSX, printTable, type ExportColumn } from '@/lib/export'

interface Props<T> {
  data: T[]
  columns: ExportColumn<T>[]
  filename: string
  title?: string
  disabled?: boolean
}

export function ExportButton<T>({ data, columns, filename, title, disabled }: Props<T>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const isEmpty = data.length === 0
  const label = title ?? filename

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((p) => !p)}
        disabled={disabled || isEmpty}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg3 border border-subtle text-[12px] text-muted hover:text-strong hover:border-subtle2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Download size={13} />
        Exportar
        <ChevronDown size={11} className={open ? 'rotate-180' : ''} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-bg2 border border-subtle rounded-lg shadow-lg z-50 py-1 overflow-hidden">
          <button
            onClick={() => { exportToCSV(data, columns, filename); setOpen(false) }}
            className="flex items-center gap-2.5 w-full px-3 py-2 text-[12px] text-muted hover:bg-bg3 hover:text-strong transition-colors text-left"
          >
            <FileText size={13} />
            CSV
            <span className="ml-auto text-[10px] font-mono-custom text-faint">.csv</span>
          </button>
          <button
            onClick={() => { exportToXLSX(data, columns, filename); setOpen(false) }}
            className="flex items-center gap-2.5 w-full px-3 py-2 text-[12px] text-muted hover:bg-bg3 hover:text-strong transition-colors text-left"
          >
            <Table2 size={13} />
            Excel
            <span className="ml-auto text-[10px] font-mono-custom text-faint">.xlsx</span>
          </button>
          <div className="my-1 border-t border-subtle" />
          <button
            onClick={() => { printTable(data, columns, label); setOpen(false) }}
            className="flex items-center gap-2.5 w-full px-3 py-2 text-[12px] text-muted hover:bg-bg3 hover:text-strong transition-colors text-left"
          >
            <Printer size={13} />
            Imprimir
          </button>
        </div>
      )}
    </div>
  )
}
