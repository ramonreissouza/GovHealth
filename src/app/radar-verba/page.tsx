'use client'
// src/app/radar-verba/page.tsx — Radar de Verba (item #3 do TOP10 v2).
// Onde a verba de saúde existe (empenhada) mas ainda não virou compra (não paga).
// Cada emenda é um LEAD A QUALIFICAR — nunca "venda garantida".

import { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import { Loader2, AlertTriangle, ExternalLink, Plus, Check, Flame, MapPin } from 'lucide-react'
import { formatBRL } from '@/lib/format'
import { createDeal, dealExists } from '@/lib/crm'
import type { EmendaRadar, Temperatura } from '@/lib/radar-verba'

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']
const PORTAL_URL = 'https://portaldatransparencia.gov.br/emendas'

const TEMP_META: Record<Temperatura, { label: string; cls: string }> = {
  quente: { label: 'Quente', cls: 'bg-red/15 text-red border border-red/30' },
  morno: { label: 'Morno', cls: 'bg-amber/15 text-amber border border-amber/30' },
  frio: { label: 'Frio', cls: 'bg-brand-blue/15 text-brand-blue border border-brand-blue/30' },
}

interface Resposta {
  kpis: { verbaDisponivel: number; emendasQuentes: number; municipiosComVerba: number; ticketMedioDisponivel: number }
  emendas: EmendaRadar[]
  ano: number
  total: number
  facetas: { subfuncoes: string[]; tipos: string[] }
  error?: string
  instrucoes?: string
}

export default function RadarVerbaPage() {
  const anoAtual = new Date().getFullYear()
  const [uf, setUf] = useState('')
  const [ano, setAno] = useState('')
  const [subfuncao, setSubfuncao] = useState('')
  const [soQuentes, setSoQuentes] = useState(false)
  const [data, setData] = useState<Resposta | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<Resposta | null>(null)
  const [addedCrm, setAddedCrm] = useState<Set<string>>(new Set())

  const carregar = useCallback(() => {
    setLoading(true)
    setErro(null)
    const p = new URLSearchParams()
    if (uf) p.set('uf', uf)
    if (ano) p.set('ano', ano)
    if (subfuncao) p.set('subfuncao', subfuncao)
    if (soQuentes) p.set('soQuentes', '1')
    fetch(`/api/radar-verba?${p}`)
      .then((r) => r.json())
      .then((d: Resposta) => { if (d.error) setErro(d); else setData(d) })
      .catch(() => setErro({ error: 'Falha ao carregar o radar.' } as Resposta))
      .finally(() => setLoading(false))
  }, [uf, ano, subfuncao, soQuentes])

  useEffect(() => { carregar() }, [carregar])

  function adicionarCrm(e: EmendaRadar) {
    const oportunidadeId = `emenda-${e.codigoEmenda}`
    if (dealExists(oportunidadeId)) { setAddedCrm((s) => new Set(s).add(e.codigoEmenda)); return }
    createDeal({
      oportunidadeId,
      titulo: `Emenda ${e.numeroEmenda || e.codigoEmenda} — ${e.municipio || e.uf}`,
      hospital: e.autor ? `Autor: ${e.autor}` : 'Emenda parlamentar',
      municipio: e.municipio || 'N/D',
      uf: e.uf || 'N/D',
      descricao: `${e.subfuncao || 'Saúde'} · verba disponível ${formatBRL(e.disponivel)} · ${e.tipo}`,
      valorEstimado: e.disponivel,
      score: e.score,
      categoria: 'outros',
      stage: 'prospeccao',
      probabilidade: e.score,
      licitacaoLink: PORTAL_URL,
    })
    setAddedCrm((s) => new Set(s).add(e.codigoEmenda))
  }

  const subfuncoes = data?.facetas?.subfuncoes ?? []

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar title="Radar de Verba" />
        <main className="flex-1 overflow-y-auto p-6 bg-bg">

          {/* Header + disclaimer */}
          <div className="mb-5">
            <div className="flex items-center gap-2">
              <Flame size={18} className="text-red" />
              <h1 className="font-heading font-bold text-[20px] text-strong">Radar de Verba</h1>
            </div>
            <p className="text-[12px] text-muted mt-1 max-w-[620px]">
              Emendas de saúde com verba <strong className="text-strong">empenhada mas ainda não paga</strong> — o sinal
              mais precoce de compra futura. Cada linha é um <strong className="text-strong">lead a qualificar</strong>,
              não venda garantida.
            </p>
          </div>

          {/* Filtros */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <div className="flex items-center gap-1.5">
              <MapPin size={13} className="text-faint" />
              <select value={uf} onChange={(e) => setUf(e.target.value)} className="text-[12px] bg-bg2 border border-subtle rounded-md px-2 py-1.5 text-strong focus:border-accent outline-none">
                <option value="">Todas UFs</option>
                {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <select value={ano} onChange={(e) => setAno(e.target.value)} className="text-[12px] bg-bg2 border border-subtle rounded-md px-2 py-1.5 text-strong focus:border-accent outline-none">
              <option value="">Ano (auto)</option>
              {[anoAtual, anoAtual - 1, anoAtual - 2, anoAtual - 3].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={subfuncao} onChange={(e) => setSubfuncao(e.target.value)} className="text-[12px] bg-bg2 border border-subtle rounded-md px-2 py-1.5 text-strong focus:border-accent outline-none max-w-[220px]">
              <option value="">Todas subfunções</option>
              {subfuncoes.map((s) => <option key={s} value={s.toLowerCase()}>{s}</option>)}
            </select>
            <button
              onClick={() => setSoQuentes((v) => !v)}
              className={clsx('flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-full border transition-colors',
                soQuentes ? 'bg-red/15 text-red border-red/30' : 'border-subtle2 text-faint hover:text-strong')}
            >
              <Flame size={12} /> Só quentes
            </button>
          </div>

          {/* KPIs */}
          {data && (
            <div className="grid grid-cols-4 gap-3 mb-5">
              <Kpi label="Verba disponível" valor={formatBRL(data.kpis.verbaDisponivel)} destaque />
              <Kpi label="Emendas quentes" valor={String(data.kpis.emendasQuentes)} />
              <Kpi label="Municípios com verba" valor={String(data.kpis.municipiosComVerba)} />
              <Kpi label="Ticket médio disponível" valor={formatBRL(data.kpis.ticketMedioDisponivel)} />
            </div>
          )}

          {/* Conteúdo */}
          {loading ? (
            <div className="space-y-2">
              {[1,2,3,4,5].map((i) => <div key={i} className="h-12 bg-bg2 border border-subtle rounded-lg animate-pulse" />)}
            </div>
          ) : erro ? (
            <div className="bg-bg2 border border-subtle rounded-2xl p-8 text-center">
              <AlertTriangle size={26} className="text-amber mx-auto mb-3" />
              <p className="text-[13px] text-strong mb-1">{erro.error}</p>
              {erro.instrucoes && <p className="text-[12px] text-muted max-w-[460px] mx-auto">{erro.instrucoes}</p>}
            </div>
          ) : !data || data.emendas.length === 0 ? (
            <div className="bg-bg2 border border-subtle rounded-2xl p-10 text-center">
              <Flame size={28} className="text-faint mx-auto mb-3" />
              <p className="text-[14px] text-strong mb-1">Nenhuma emenda com os filtros atuais</p>
              <p className="text-[12px] text-muted">Tente ampliar o ano ou remover filtros.</p>
            </div>
          ) : (
            <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-faint text-[10px] font-mono-custom uppercase tracking-wider border-b border-subtle">
                      <th className="text-left font-medium px-3 py-2.5">Temp.</th>
                      <th className="text-left font-medium px-3 py-2.5">Município / UF</th>
                      <th className="text-left font-medium px-3 py-2.5">Autor</th>
                      <th className="text-left font-medium px-3 py-2.5">Subfunção</th>
                      <th className="text-right font-medium px-3 py-2.5">Empenhado</th>
                      <th className="text-right font-medium px-3 py-2.5">Pago</th>
                      <th className="text-right font-medium px-3 py-2.5">Disponível</th>
                      <th className="text-left font-medium px-3 py-2.5 w-[90px]">% exec.</th>
                      <th className="text-right font-medium px-3 py-2.5">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.emendas.map((e) => {
                      const tm = TEMP_META[e.temperatura]
                      const added = addedCrm.has(e.codigoEmenda)
                      return (
                        <tr key={e.codigoEmenda} className="border-b border-subtle last:border-0 hover:bg-bg3 transition-colors">
                          <td className="px-3 py-2.5">
                            <span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase', tm.cls)}>{tm.label} {e.score}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="text-strong">{e.municipio || '—'}</span>
                            <span className="text-faint"> / {e.uf || '—'}</span>
                          </td>
                          <td className="px-3 py-2.5 text-muted truncate max-w-[160px]">{e.autor || '—'}</td>
                          <td className="px-3 py-2.5">
                            <span className="text-muted">{e.subfuncao || '—'}</span>
                            {e.baixaRastreabilidade && (
                              <span title="Emenda PIX / transferência especial — destino de baixa rastreabilidade" className="ml-1 inline-flex items-center align-middle">
                                <AlertTriangle size={11} className="text-amber" />
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono-custom text-muted">{formatBRL(e.empenhado)}</td>
                          <td className="px-3 py-2.5 text-right font-mono-custom text-muted">{formatBRL(e.pago)}</td>
                          <td className="px-3 py-2.5 text-right font-mono-custom font-bold text-strong">{formatBRL(e.disponivel)}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <div className="flex-1 h-1.5 bg-bg4 rounded-full overflow-hidden min-w-[36px]">
                                <div className="h-full bg-accent rounded-full" style={{ width: `${Math.min(e.percentualExecutado, 100)}%` }} />
                              </div>
                              <span className="text-[10px] text-faint font-mono-custom w-8 text-right">{e.percentualExecutado}%</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center justify-end gap-2">
                              <a href={PORTAL_URL} target="_blank" rel="noopener noreferrer" title="Ver no Portal da Transparência" className="text-faint hover:text-accent transition-colors">
                                <ExternalLink size={14} />
                              </a>
                              <button
                                onClick={() => adicionarCrm(e)}
                                disabled={added}
                                title={added ? 'Já no pipeline' : 'Adicionar ao pipeline (lead a qualificar)'}
                                className={clsx('flex items-center gap-1 text-[10px] px-1.5 py-1 rounded-md border transition-colors',
                                  added ? 'border-emerald-500/30 text-emerald-400' : 'border-subtle2 text-faint hover:text-strong')}
                              >
                                {added ? <Check size={12} /> : <Plus size={12} />} CRM
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data && (
            <p className="text-[10px] text-faint mt-3">
              Fonte: Portal da Transparência (emendas de saúde, ano {data.ano}). O score é auxílio de priorização, não previsão. ⚠️ do símbolo = emenda PIX (baixa rastreabilidade do destino).
            </p>
          )}
        </main>
      </div>
    </div>
  )
}

function Kpi({ label, valor, destaque }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div className={clsx('bg-bg2 border rounded-xl p-4', destaque ? 'border-red/30' : 'border-subtle')}>
      <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1.5">{label}</div>
      <div className={clsx('font-heading font-bold text-[22px] leading-none', destaque ? 'text-red' : 'text-strong')}>{valor}</div>
    </div>
  )
}
