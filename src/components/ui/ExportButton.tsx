'use client'
// src/components/ui/ExportButton.tsx

import { useState, useRef, useEffect } from 'react'
import { Download, ChevronDown, FileText, Table2, Printer, Loader2 } from 'lucide-react'
import { exportToCSV, exportToXLSX, printTable, type ExportColumn } from '@/lib/export'

interface Props<T> {
  data: T[]
  columns: ExportColumn<T>[]
  filename: string
  title?: string
  disabled?: boolean
  /**
   * Quando presente, o export busca o conjunto COMPLETO do filtro (normalmente no
   * servidor, sem offset/limit) em vez de exportar as linhas que estão na tela.
   *
   * Existe porque telas paginadas de verdade só têm ~50 linhas em memória: sem isto
   * o botão "Exportar" entrega a PÁGINA e não o filtro, calado, e o cliente monta
   * análise sobre um recorte que ele não pediu.
   *
   * Devolver `null` cancela o export sem erro (ex.: o usuário desistiu no aviso de
   * "são N linhas").
   */
  fetchAll?: () => Promise<T[] | null>
}

export function ExportButton<T>({ data, columns, filename, title, disabled, fetchAll }: Props<T>) {
  const [open, setOpen] = useState(false)
  const [buscando, setBuscando] = useState(false)
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

  // Resolve as linhas ANTES de gerar o arquivo: com `fetchAll`, o que sai é o filtro
  // inteiro; sem ele, o que está na tela (comportamento das telas não paginadas).
  async function rodar(gerar: (rows: T[]) => void) {
    setOpen(false)
    if (!fetchAll) { gerar(data); return }
    setBuscando(true)
    try {
      const rows = await fetchAll()
      if (rows === null) return               // cancelado pelo usuário
      if (rows.length === 0) { alert('Sem linhas para exportar com os filtros atuais.'); return }
      gerar(rows)
    } catch {
      alert('Não foi possível montar o export agora. Tente de novo.')
    } finally {
      setBuscando(false)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((p) => !p)}
        disabled={disabled || isEmpty || buscando}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg3 border border-subtle text-[12px] text-muted hover:text-strong hover:border-subtle2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {buscando ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
        {buscando ? 'Montando…' : 'Exportar'}
        <ChevronDown size={11} className={open ? 'rotate-180' : ''} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-bg2 border border-subtle rounded-lg shadow-lg z-50 py-1 overflow-hidden">
          <button
            onClick={() => void rodar((rows) => exportToCSV(rows, columns, filename))}
            className="flex items-center gap-2.5 w-full px-3 py-2 text-[12px] text-muted hover:bg-bg3 hover:text-strong transition-colors text-left"
          >
            <FileText size={13} />
            CSV
            <span className="ml-auto text-[10px] font-mono-custom text-faint">.csv</span>
          </button>
          <button
            onClick={() => void rodar((rows) => exportToXLSX(rows, columns, filename))}
            className="flex items-center gap-2.5 w-full px-3 py-2 text-[12px] text-muted hover:bg-bg3 hover:text-strong transition-colors text-left"
          >
            <Table2 size={13} />
            Excel
            <span className="ml-auto text-[10px] font-mono-custom text-faint">.xlsx</span>
          </button>
          <div className="my-1 border-t border-subtle" />
          <button
            onClick={() => void rodar((rows) => printTable(rows, columns, label))}
            title="Abre a janela de impressão — escolha 'Salvar como PDF'"
            className="flex items-center gap-2.5 w-full px-3 py-2 text-[12px] text-muted hover:bg-bg3 hover:text-strong transition-colors text-left"
          >
            <Printer size={13} />
            PDF
            <span className="ml-auto text-[10px] font-mono-custom text-faint">.pdf</span>
          </button>
        </div>
      )}
    </div>
  )
}
