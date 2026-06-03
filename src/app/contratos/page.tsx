'use client'
// src/app/contratos/page.tsx — Contratos.gov.br (radar de vencimento + incumbentes + valores)

import React, { useState, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import {
  Search, RefreshCw, FileSignature, Building2, AlertTriangle, Clock, ExternalLink, Users,
} from 'lucide-react'
import { ExportButton } from '@/components/ui/ExportButton'
import { formatBRL, formatDate, diasRestantes } from '@/lib/format'
import type { ContratoGov } from '@/lib/types'

type Modo = 'ug' | 'cnpj'

interface Stats { total: number; vigentes: number; valorVigente: number; vencendo180d: number }

function formatCNPJ(s: string) {
  const d = (s || '').replace(/\D/g, '')
  if (d.length !== 14) return s
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`
}

export default function ContratosPage() {
  const [modo, setModo] = useState<Modo>('cnpj')
  const [valor, setValor] = useState('')
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [contratos, setContratos] = useState<ContratoGov[]>([])
  const [stats, setStats] = useState<Stats | null>(null)

  const buscar = useCallback(async () => {
    const q = valor.trim()
    if (!q) return
    setLoading(true); setSearched(true); setErro(null); setContratos([]); setStats(null)
    try {
      const param = modo === 'ug' ? `ug=${encodeURIComponent(q)}` : `cnpj=${encodeURIComponent(q)}`
      const res = await fetch(`/api/contratos?${param}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Erro')
      setContratos(data.contratos ?? [])
      setStats(data.stats ?? null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao consultar o Contratos.gov.br.')
    } finally {
      setLoading(false)
    }
  }, [valor, modo])

  // Ordena por vencimento mais próximo (vigentes primeiro)
  const ordenados = [...contratos].sort((a, b) => {
    const fa = a.vigenciaFim ? new Date(a.vigenciaFim).getTime() : Infinity
    const fb = b.vigenciaFim ? new Date(b.vigenciaFim).getTime() : Infinity
    return fa - fb
  })

  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar title="Contratos.gov.br" subtitle={searched ? (loading ? 'Consultando…' : `${contratos.length} contratos`) : 'Radar de contratos públicos'} />
        <main className="flex-1 overflow-y-auto p-6">

          <div className="mb-4 max-w-[680px]">
            <h1 className="font-heading font-bold text-[22px] text-strong leading-none">Contratos públicos</h1>
            <p className="text-[13px] text-muted mt-1.5">
              Consulte contratos vigentes, fornecedores incumbentes e valores no Contratos.gov.br.
              Busque pelo <strong>CNPJ de um fornecedor</strong> (o que um concorrente já tem e quando vence) ou
              pelo <strong>código da unidade gestora</strong> (quem fornece para aquele órgão).
            </p>
          </div>

          {/* Busca */}
          <div className="flex flex-wrap gap-2 mb-4">
            <div className="flex gap-0.5 bg-bg2 border border-subtle2 rounded-xl p-1">
              {([['cnpj','Por fornecedor (CNPJ)'],['ug','Por unidade gestora']] as [Modo,string][]).map(([k,l]) => (
                <button key={k} onClick={() => setModo(k)}
                  className={clsx('text-[11px] font-mono-custom px-3 py-1.5 rounded-lg transition-all',
                    modo === k ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong')}>
                  {l}
                </button>
              ))}
            </div>
            <div className="flex-1 min-w-[240px] flex items-center gap-2 bg-bg2 border border-subtle2 rounded-xl px-4 py-2.5">
              <Search size={15} className="text-faint flex-shrink-0" />
              <input
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && buscar()}
                placeholder={modo === 'cnpj' ? 'CNPJ do fornecedor (ex: 00.000.000/0001-00)' : 'Código da unidade gestora (SIAFI, ex: 153978)'}
                className="flex-1 bg-transparent text-[13px] text-strong placeholder:text-faint outline-none"
              />
            </div>
            <button onClick={buscar} disabled={!valor.trim() || loading}
              className="flex items-center gap-2 px-5 py-2.5 bg-accent text-black font-mono-custom font-bold text-[12px] rounded-xl hover:bg-accent/90 transition-colors disabled:opacity-40">
              {loading ? <RefreshCw size={13} className="animate-spin" /> : <Search size={13} />}
              Buscar
            </button>
          </div>

          {!searched && (
            <div className="bg-bg2 border border-subtle rounded-xl p-10 text-center max-w-[680px]">
              <FileSignature size={30} className="text-faint mx-auto mb-3" />
              <p className="text-[14px] text-strong font-medium mb-1">Radar de Contratos — Contratos.gov.br</p>
              <p className="text-[12px] text-faint max-w-md mx-auto">
                Quando o contrato de um concorrente vence, abre a janela de venda. Busque por CNPJ ou unidade gestora.
              </p>
            </div>
          )}

          {erro && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 mb-4 text-[12px] text-brand-red max-w-[680px]">
              <AlertTriangle size={14} /> {erro}
            </div>
          )}

          {!loading && searched && !erro && (
            <>
              {stats && (
                <div className="grid grid-cols-4 gap-3 mb-4">
                  {[
                    { l: 'Contratos', v: String(stats.total), s: 'no total' },
                    { l: 'Vigentes', v: String(stats.vigentes), s: 'em vigor' },
                    { l: 'Valor vigente', v: formatBRL(stats.valorVigente), s: 'somatório' },
                    { l: 'Vencendo ≤180d', v: String(stats.vencendo180d), s: 'janela de venda', warn: stats.vencendo180d > 0 },
                  ].map((k) => (
                    <div key={k.l} className="bg-bg2 border border-subtle rounded-xl px-4 py-3">
                      <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">{k.l}</div>
                      <div className={clsx('text-[20px] font-mono-custom font-bold mt-0.5 leading-tight', k.warn ? 'text-amber' : 'text-strong')}>{k.v}</div>
                      <div className="text-[10px] text-faint font-mono-custom mt-0.5">{k.s}</div>
                    </div>
                  ))}
                </div>
              )}

              {contratos.length === 0 ? (
                <div className="bg-bg2 border border-subtle rounded-xl p-10 text-center text-faint text-[13px] max-w-[680px]">
                  Nenhum contrato encontrado. Verifique o {modo === 'cnpj' ? 'CNPJ' : 'código da unidade gestora'}.
                </div>
              ) : (
                <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-subtle bg-bg3/40">
                    <span className="text-[11px] font-mono-custom text-faint">{ordenados.length} contratos · ordenados por vencimento</span>
                    <ExportButton
                      data={ordenados}
                      filename="contratos-gov"
                      title="Contratos.gov.br"
                      columns={[
                        { key: 'numero', label: 'Número' },
                        { key: 'objeto', label: 'Objeto' },
                        { key: 'fornecedorNome', label: 'Fornecedor' },
                        { key: 'fornecedorCnpj', label: 'CNPJ' },
                        { key: 'orgaoNome', label: 'Órgão' },
                        { key: 'vigenciaInicio', label: 'Vigência início' },
                        { key: 'vigenciaFim', label: 'Vigência fim' },
                        { key: 'valorGlobal', label: 'Valor global', format: (v) => `R$ ${Number(v).toLocaleString('pt-BR')}` },
                        { key: 'situacao', label: 'Situação' },
                      ]}
                    />
                  </div>
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-subtle bg-bg3/40 text-left">
                        <th className="text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Objeto / Nº</th>
                        <th className="text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5">{modo === 'cnpj' ? 'Órgão (cliente)' : 'Fornecedor (incumbente)'}</th>
                        <th className="text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5 text-center">Vigência</th>
                        <th className="text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5 text-right">Valor global</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ordenados.map((c) => {
                        const dias = c.vigenciaFim ? diasRestantes(c.vigenciaFim) : null
                        const vencido = dias !== null && dias < 0
                        const urgente = dias !== null && dias >= 0 && dias <= 180
                        return (
                          <tr key={c.id} className="border-b border-subtle last:border-0 hover:bg-bg3/50 transition-colors">
                            <td className="px-4 py-2.5 align-top">
                              <div className="text-[12px] text-strong max-w-[360px] leading-snug line-clamp-2">{c.objeto || '—'}</div>
                              <div className="text-[9px] font-mono-custom text-faint mt-0.5">
                                Nº {c.numero || '—'}{c.modalidade ? ` · ${c.modalidade}` : ''}
                                {c.linkHistorico && (
                                  <a href={c.linkHistorico} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 ml-1.5 text-faint hover:text-accent"><ExternalLink size={9} /></a>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 align-top">
                              <div className="text-[11px] text-strong max-w-[200px] leading-snug">
                                {modo === 'cnpj' ? (c.orgaoNome || '—') : (c.fornecedorNome || '—')}
                              </div>
                              <div className="text-[9px] font-mono-custom text-faint">
                                {modo === 'cnpj' ? (c.ugNome || '') : formatCNPJ(c.fornecedorCnpj)}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-center align-top whitespace-nowrap">
                              <div className="text-[11px] font-mono-custom text-muted">{formatDate(c.vigenciaInicio)} → {formatDate(c.vigenciaFim)}</div>
                              {dias !== null && (
                                <span className={clsx('inline-flex items-center gap-1 text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full mt-1 border',
                                  vencido ? 'bg-bg4 text-faint border-subtle2'
                                  : urgente ? 'bg-amber-500/15 text-amber border-amber-500/30'
                                  : 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30')}>
                                  <Clock size={9} /> {vencido ? 'encerrado' : urgente ? `vence em ${dias}d` : 'vigente'}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right align-top">
                              <div className="text-[13px] font-mono-custom font-bold text-strong whitespace-nowrap">{formatBRL(c.valorGlobal)}</div>
                              <div className="text-[9px] font-mono-custom text-faint mt-0.5">{c.situacao}</div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div className="px-4 py-3 border-t border-subtle flex items-center justify-between">
                    <span className="text-[10px] font-mono-custom text-faint flex items-center gap-1.5"><Users size={11} /> Fonte: Contratos.gov.br (Comprasnet Contratos)</span>
                    <a href="https://contratos.comprasnet.gov.br" target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[10px] font-mono-custom text-faint hover:text-accent transition-colors">
                      <ExternalLink size={10} /> Abrir no Contratos.gov.br
                    </a>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
