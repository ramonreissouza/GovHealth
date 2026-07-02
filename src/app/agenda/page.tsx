'use client'
// src/app/agenda/page.tsx — Agenda operacional de prazos (item #4 do TOP10 v2).
// Reúne os prazos do Pipeline CRM e dos Dossiês de Edital num só lugar, agrupados
// por urgência, com exportação .ics para Google Calendar / Outlook.

import { useState, useEffect } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import { CalendarClock, Download, ExternalLink, AlertTriangle, KanbanSquare, FolderKanban } from 'lucide-react'
import { getPrazosAgenda, baixarICS, type PrazoAgenda } from '@/lib/agenda'
import { formatDate } from '@/lib/format'

interface Grupo { chave: string; label: string; itens: PrazoAgenda[] }

function agrupar(prazos: PrazoAgenda[]): Grupo[] {
  const g: Record<string, PrazoAgenda[]> = { atrasado: [], hoje: [], semana: [], mes: [], depois: [] }
  for (const p of prazos) {
    if (p.diasRestantes < 0) g.atrasado.push(p)
    else if (p.diasRestantes === 0) g.hoje.push(p)
    else if (p.diasRestantes <= 7) g.semana.push(p)
    else if (p.diasRestantes <= 30) g.mes.push(p)
    else g.depois.push(p)
  }
  return [
    { chave: 'atrasado', label: 'Atrasados', itens: g.atrasado },
    { chave: 'hoje', label: 'Hoje', itens: g.hoje },
    { chave: 'semana', label: 'Próximos 7 dias', itens: g.semana },
    { chave: 'mes', label: 'Próximos 30 dias', itens: g.mes },
    { chave: 'depois', label: 'Mais adiante', itens: g.depois },
  ].filter((x) => x.itens.length > 0)
}

function badgeDias(dias: number): { txt: string; cls: string } {
  if (dias < 0) return { txt: `${Math.abs(dias)}d atrás`, cls: 'bg-red/15 text-red border border-red/30' }
  if (dias === 0) return { txt: 'hoje', cls: 'bg-amber/20 text-amber border border-amber/40' }
  if (dias <= 7) return { txt: `${dias}d`, cls: 'bg-amber/15 text-amber border border-amber/30' }
  if (dias <= 30) return { txt: `${dias}d`, cls: 'bg-brand-blue/15 text-brand-blue border border-brand-blue/30' }
  return { txt: `${dias}d`, cls: 'bg-bg4 text-faint border border-subtle2' }
}

export default function AgendaPage() {
  const [mounted, setMounted] = useState(false)
  const [prazos, setPrazos] = useState<PrazoAgenda[]>([])

  useEffect(() => {
    setPrazos(getPrazosAgenda())
    setMounted(true)
  }, [])

  // Ativos = ainda não concluídos (o que precisa de ação e vai para o .ics).
  const ativos = prazos.filter((p) => !p.concluido)
  const grupos = agrupar(ativos)
  const atrasados = ativos.filter((p) => p.diasRestantes < 0).length
  const proximos7 = ativos.filter((p) => p.diasRestantes >= 0 && p.diasRestantes <= 7).length

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar title="Agenda de prazos" />
        <main className="flex-1 overflow-y-auto p-6 bg-bg">

          {/* Cabeçalho + exportação */}
          <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
            <div>
              <h1 className="font-heading font-bold text-[20px] text-strong">Agenda de prazos</h1>
              <p className="text-[12px] text-muted mt-1 max-w-[560px]">
                Prazos do seu Pipeline CRM e dos Dossiês de Edital reunidos. Exporte para o
                Google Calendar ou Outlook — prazo perdido é venda perdida.
              </p>
            </div>
            <button
              onClick={() => baixarICS(ativos)}
              disabled={ativos.length === 0}
              className={clsx(
                'flex items-center gap-2 text-[12px] font-semibold px-3.5 py-2 rounded-lg transition-colors flex-shrink-0',
                ativos.length === 0 ? 'bg-bg3 text-faint cursor-not-allowed' : 'bg-accent text-black hover:bg-accent2',
              )}
            >
              <Download size={14} /> Exportar agenda (.ics)
            </button>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <Kpi label="Prazos ativos" valor={ativos.length} />
            <Kpi label="Atrasados" valor={atrasados} tom={atrasados > 0 ? 'red' : undefined} />
            <Kpi label="Próximos 7 dias" valor={proximos7} tom={proximos7 > 0 ? 'amber' : undefined} />
          </div>

          {/* Lista agrupada / vazio */}
          {!mounted ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-bg2 border border-subtle rounded-xl animate-pulse" />)}
            </div>
          ) : ativos.length === 0 ? (
            <div className="bg-bg2 border border-subtle rounded-2xl p-10 text-center">
              <CalendarClock size={30} className="text-faint mx-auto mb-3" />
              <h2 className="font-heading font-semibold text-[16px] text-strong mb-1.5">Nenhum prazo na agenda</h2>
              <p className="text-[13px] text-muted max-w-[460px] mx-auto">
                Os prazos aparecem aqui quando você define a <strong className="text-strong">data de fechamento</strong> de
                um negócio no Pipeline CRM ou adiciona <strong className="text-strong">prazos do certame</strong> num
                Dossiê de Edital.
              </p>
              <div className="flex items-center justify-center gap-3 mt-4">
                <a href="/crm" className="inline-flex items-center gap-1.5 text-[12px] text-accent hover:underline"><KanbanSquare size={13} /> Ir ao Pipeline CRM</a>
                <a href="/editais" className="inline-flex items-center gap-1.5 text-[12px] text-accent hover:underline"><FolderKanban size={13} /> Ir aos Dossiês</a>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {grupos.map((grupo) => (
                <div key={grupo.chave}>
                  <div className="flex items-center gap-2 mb-2">
                    {grupo.chave === 'atrasado' && <AlertTriangle size={13} className="text-red" />}
                    <span className="text-[11px] font-mono-custom text-faint uppercase tracking-wider">{grupo.label}</span>
                    <span className="text-[11px] text-faint">· {grupo.itens.length}</span>
                  </div>
                  <div className="space-y-2">
                    {grupo.itens.map((p) => {
                      const b = badgeDias(p.diasRestantes)
                      return (
                        <div key={p.id} className="bg-bg2 border border-subtle rounded-xl p-3.5 flex items-center gap-3">
                          {/* Data */}
                          <div className="text-center flex-shrink-0 w-16">
                            <div className="text-[13px] font-mono-custom font-bold text-strong">{formatDate(p.data)}</div>
                            <span className={clsx('inline-block mt-1 text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full', b.cls)}>{b.txt}</span>
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[13px] font-semibold text-strong truncate">{p.titulo}</span>
                              <span className={clsx(
                                'text-[8px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase tracking-wide flex-shrink-0',
                                p.origem === 'crm' ? 'bg-purple/15 text-brand-purple border border-purple/30' : 'bg-brand-blue/15 text-brand-blue border border-brand-blue/30',
                              )}>
                                {p.origem === 'crm' ? 'CRM' : 'Edital'}
                              </span>
                            </div>
                            {p.subtitulo && <p className="text-[11px] text-muted mt-0.5 truncate">{p.subtitulo}</p>}
                          </div>

                          {/* Ações */}
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {p.link && (
                              <a href={p.link} target="_blank" rel="noopener noreferrer" title="Abrir edital"
                                className="text-faint hover:text-accent transition-colors"><ExternalLink size={14} /></a>
                            )}
                            <button
                              onClick={() => baixarICS([p], `prazo-${p.id}.ics`)}
                              title="Exportar este prazo (.ics)"
                              className="flex items-center gap-1 text-[11px] text-faint hover:text-strong transition-colors"
                            >
                              <Download size={13} /> .ics
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function Kpi({ label, valor, tom }: { label: string; valor: number; tom?: 'red' | 'amber' }) {
  return (
    <div className="bg-bg2 border border-subtle rounded-xl p-4">
      <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1.5">{label}</div>
      <div className={clsx('font-heading font-bold text-[26px] leading-none',
        tom === 'red' ? 'text-red' : tom === 'amber' ? 'text-amber' : 'text-strong')}>
        {valor}
      </div>
    </div>
  )
}
