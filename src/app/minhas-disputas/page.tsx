'use client'
// src/app/minhas-disputas/page.tsx — "Minhas Disputas"
// As licitações que a conta (fornecedor) participou, com o valor homologado dela,
// o vencedor de cada item e — quando houver — os concorrentes. Filtro por estado.
// Honesto sobre o gap: preços/specs de concorrentes quase não existem no dado aberto.

import React, { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import { MapPin, ChevronDown, ChevronUp, Trophy, AlertTriangle, ExternalLink, Building2, FileText } from 'lucide-react'
import { formatBRL } from '@/lib/format'
import { useSetupUFDefault } from '@/lib/use-setup-uf'

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']

interface Concorrente { nome: string | null; valor: number | null; ordem: number | null }
interface ItemDisputa {
  numeroItem: number; descricao: string; meuValor: number | null; minhaOrdem: number | null
  venciEste: boolean; vencedor: { nome: string | null; valor: number | null } | null; concorrentes: Concorrente[]
}
interface Disputa {
  nc: string; uf: string | null; orgao: string | null; objeto: string | null; data: string | null
  meusItens: number; meuValor: number; itensVencidos: number; venci: 'total' | 'parcial' | 'nao'; link: string; itens: ItemDisputa[]
}
interface Resp {
  fornecedor: { cnpj: string | null; nome: string | null }
  semCnpj?: boolean
  disputas: Disputa[]
  totais?: { licitacoes: number; itens: number; valor: number; itensVencidos: number }
  ufs: string[]
  concorrentesDisponiveis?: number
  aviso?: string
}

function fmtData(s: string | null) {
  if (!s) return '—'
  try { return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) } catch { return s }
}

export default function MinhasDisputasPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [uf, setUf] = useState<string | null>(null)
  // UF única: se o vendedor atua em UM estado só, foca nele (item 4). Multi-estado
  // mantém "Todos" (esta tela mostra uma UF por vez e não deve esconder disputas).
  const { marcarTocado: marcarUFTocado } = useSetupUFDefault((ufs) => setUf(ufs[0]), { apenasSeUnica: true })
  const [aberta, setAberta] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams()
      if (uf) p.set('uf', uf)
      const r = await fetch(`/api/minhas-disputas?${p}`)
      setData(await r.json())
    } catch { setData(null) }
    finally { setLoading(false) }
  }, [uf])
  useEffect(() => { load() }, [load])

  const disputas = data?.disputas ?? []
  // KPIs = histórico COMPLETO (vem de `totais`, não da lista que traz só as 10 recentes).
  const totalLicitacoes = data?.totais?.licitacoes ?? disputas.length
  const totalValor = data?.totais?.valor ?? disputas.reduce((s, d) => s + d.meuValor, 0)
  const totalItens = data?.totais?.itens ?? disputas.reduce((s, d) => s + d.meusItens, 0)
  const ufsComDados = data?.ufs ?? []

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar
          title="Minhas Disputas"
          subtitle={loading ? 'Carregando…' : `${data?.fornecedor?.nome ?? 'Sua empresa'}${data?.fornecedor?.cnpj ? ' · ' + data.fornecedor.cnpj : ''}`}
        />
        <main className="flex-1 overflow-y-auto p-6 bg-bg space-y-4">

          {data?.semCnpj ? (
            <div className="bg-bg2 border border-amber/30 rounded-xl p-8 text-center">
              <Building2 size={28} className="text-amber mx-auto mb-3" />
              <div className="text-[14px] text-strong mb-1">Cadastre o CNPJ da sua empresa</div>
              <div className="text-[12px] text-muted">As disputas são casadas pelo CNPJ da conta contra os resultados homologados do PNCP. Adicione o CNPJ no seu perfil para ver as licitações que você participou.</div>
            </div>
          ) : (
            <>
              {/* Aviso honesto sobre o gap de dados de concorrentes */}
              {data?.aviso && (
                <div className="bg-amber/5 border border-amber/25 rounded-xl px-4 py-3 flex items-start gap-2.5">
                  <AlertTriangle size={15} className="text-amber flex-shrink-0 mt-0.5" />
                  <div className="text-[12px] text-muted leading-relaxed">
                    <span className="text-amber font-semibold">Dado de concorrentes é limitado. </span>
                    {data.aviso}
                    {typeof data.concorrentesDisponiveis === 'number' && (
                      <span className="block mt-1 text-faint">
                        Concorrentes com proposta estruturada encontrados nas suas disputas: <span className="font-mono-custom text-strong">{data.concorrentesDisponiveis}</span>.
                        Para preço/spec dos concorrentes seria preciso extrair a <strong>ata de julgamento</strong> (PDF) do edital — fonte não estruturada.
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* KPIs */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Licitações participadas', value: String(totalLicitacoes) },
                  { label: 'Itens homologados', value: String(totalItens) },
                  { label: 'Valor homologado (você)', value: formatBRL(totalValor) },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-bg2 border border-subtle rounded-xl px-4 py-3">
                    <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">{label}</div>
                    <div className="text-[18px] font-mono-custom font-bold text-strong mt-0.5">{value}</div>
                  </div>
                ))}
              </div>

              {/* Filtro por estado */}
              <div className="bg-bg2 border border-subtle2 rounded-xl px-3 py-2.5">
                <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider mb-2">Estado</div>
                <div className="flex gap-1 flex-wrap items-center">
                  <button onClick={() => { marcarUFTocado(); setUf(null) }}
                    className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all',
                      uf === null ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3')}>
                    Todos
                  </button>
                  {UFS.map((u) => {
                    const tem = ufsComDados.includes(u)
                    return (
                      <button key={u} onClick={() => { marcarUFTocado(); tem && setUf(u) }} disabled={!tem}
                        className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all',
                          uf === u ? 'bg-accent text-black font-bold' : tem ? 'text-muted hover:text-strong hover:bg-bg3' : 'text-faint/30 cursor-not-allowed')}>
                        {u}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Lista de disputas */}
              {loading ? (
                <div className="bg-bg2 border border-subtle rounded-xl p-10 text-center text-faint text-[13px]">Carregando disputas…</div>
              ) : disputas.length === 0 ? (
                <div className="bg-bg2 border border-subtle rounded-xl p-10 text-center text-faint text-[13px]">
                  Nenhuma disputa encontrada para este CNPJ{uf ? ` em ${uf}` : ''}.
                </div>
              ) : (
                <div className="space-y-2">
                  {totalLicitacoes > disputas.length && (
                    <div className="text-[10px] font-mono-custom text-faint px-1">
                      Mostrando as {disputas.length} licitações mais recentes de {totalLicitacoes}{uf ? ` em ${uf}` : ''}. Os KPIs acima somam o histórico completo.
                    </div>
                  )}
                  {disputas.map((d) => {
                    const open = aberta === d.nc
                    return (
                      <div key={d.nc} className="bg-bg2 border border-subtle rounded-xl overflow-hidden">
                        <button onClick={() => setAberta(open ? null : d.nc)} className="w-full text-left px-4 py-3 hover:bg-bg3 transition-colors flex items-center gap-3">
                          <span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase flex-shrink-0',
                            d.venci === 'total' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : d.venci === 'parcial' ? 'bg-amber/15 text-amber border border-amber/30'
                            : 'bg-bg4 text-faint border border-subtle2')}>
                            {d.venci === 'total' ? 'Venci' : d.venci === 'parcial' ? 'Parcial' : 'Participei'}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[12px] text-strong truncate">{d.orgao ?? '—'}</div>
                            <div className="text-[9px] font-mono-custom text-faint flex items-center gap-1.5 mt-0.5">
                              <MapPin size={9} /> {d.uf ?? '—'} · {fmtData(d.data)} · {d.meusItens} item{d.meusItens !== 1 ? 's' : ''} ({d.itensVencidos} vencido{d.itensVencidos !== 1 ? 's' : ''})
                            </div>
                          </div>
                          <div className="text-[13px] font-mono-custom font-bold text-accent flex-shrink-0">{formatBRL(d.meuValor)}</div>
                          {open ? <ChevronUp size={14} className="text-faint flex-shrink-0" /> : <ChevronDown size={14} className="text-faint flex-shrink-0" />}
                        </button>

                        {open && (
                          <div className="border-t border-subtle px-4 py-3 space-y-3">
                            {d.objeto && (
                              <div className="text-[11px] text-muted leading-relaxed"><span className="text-faint">Objeto: </span>{d.objeto}</div>
                            )}
                            <div className="space-y-1.5">
                              {d.itens.map((it) => (
                                <div key={it.numeroItem} className="bg-bg3/40 rounded-lg px-3 py-2">
                                  <div className="flex items-start gap-3">
                                    <span className="text-[9px] font-mono-custom text-faint w-5 flex-shrink-0 mt-0.5">{it.numeroItem}</span>
                                    <span className="text-[11px] text-strong flex-1 leading-snug">{it.descricao}</span>
                                    <div className="flex-shrink-0 text-right">
                                      <div className="text-[9px] font-mono-custom text-faint">meu preço</div>
                                      <div className="text-[12px] font-mono-custom font-bold text-strong">{it.meuValor != null ? formatBRL(it.meuValor) : '—'}</div>
                                    </div>
                                    {it.venciEste ? (
                                      <span title="Você venceu este item" className="flex-shrink-0 mt-0.5"><Trophy size={13} className="text-amber" /></span>
                                    ) : (
                                      <span className="text-[9px] font-mono-custom text-faint flex-shrink-0 mt-1 w-16 text-right truncate" title={it.vencedor?.nome ?? ''}>
                                        {it.vencedor?.nome ? `venc: ${it.vencedor.nome.split(' ')[0]}` : ''}
                                      </span>
                                    )}
                                  </div>
                                  {/* Concorrentes: só aparecem quando o dado existe (raro). */}
                                  {it.concorrentes.length > 0 ? (
                                    <div className="mt-1.5 pl-8 space-y-0.5">
                                      {it.concorrentes.map((cc, i) => (
                                        <div key={i} className="flex items-center gap-2 text-[10px] font-mono-custom text-muted">
                                          <span className="text-faint w-4">{cc.ordem ?? '·'}º</span>
                                          <span className="flex-1 truncate">{cc.nome ?? '—'}</span>
                                          <span className="text-strong">{cc.valor != null ? formatBRL(cc.valor) : '—'}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="mt-1 pl-8 text-[9px] font-mono-custom text-faint flex items-center gap-1">
                                      <FileText size={9} /> propostas dos concorrentes não publicadas neste item (só o vencedor consta no dado aberto)
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                            <a href={d.link} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-[11px] text-faint hover:text-accent transition-colors">
                              <ExternalLink size={11} /> Ver no PNCP
                            </a>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
