'use client'
// src/app/radar-verba/page.tsx — Radar de Verba (item #3 do TOP10 v2).
// Onde a verba de saúde existe (empenhada) mas ainda não virou compra (não paga).
// Cada emenda é um LEAD A QUALIFICAR — nunca "venda garantida".

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import { Loader2, AlertTriangle, ExternalLink, Plus, Check, Flame, MapPin, X, Building2, FileText, ArrowRight } from 'lucide-react'
import { formatBRL } from '@/lib/format'
import { createDeal, dealExists } from '@/lib/crm'
import { parseValorBR, type EmendaDetalhe } from '@/lib/emendas'
import { Paginacao } from '@/components/ui/Paginacao'
import { PAGE_SIZE_PADRAO as POR_PAGINA } from '@/components/ui/PageSizeSelector'
import type { EmendaRadar, Temperatura } from '@/lib/radar-verba'
import { getTerritorio } from '@/lib/territorio'
import { useSetupUFDefault } from '@/lib/use-setup-uf'
import TerritorioToggle from '@/components/ui/TerritorioToggle'
import CapagBadge from '@/components/ui/CapagBadge'

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

function RadarVerbaConteudo() {
  const anoAtual = new Date().getFullYear()
  // Deep-link vindo dos Alertas (?emenda=<codigo>&uf=&ano=): foca a emenda clicada.
  const searchParams = useSearchParams()
  const focoEmenda = searchParams.get('emenda')
  const [uf, setUf] = useState(searchParams.get('uf') ?? '')
  // UF única: foca no estado do Setup só quando o vendedor atua em um estado (item 4);
  // multi-estado usa o Território. Deep-link (?uf=) dos Alertas tem prioridade.
  const { marcarTocado: marcarUFTocado } = useSetupUFDefault((ufs) => setUf(ufs[0]), {
    apenasSeUnica: true, pular: !!searchParams.get('uf'),
  })
  const [ano, setAno] = useState(searchParams.get('ano') ?? '')
  const [subfuncao, setSubfuncao] = useState('')
  const [soQuentes, setSoQuentes] = useState(false)
  const [terrAtivo, setTerrAtivo] = useState(false)
  const [terr, setTerr] = useState<string[]>([])
  useEffect(() => { setTerr(getTerritorio()) }, [])
  const usandoTerritorio = terrAtivo && terr.length > 0
  const [data, setData] = useState<Resposta | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<Resposta | null>(null)
  const [addedCrm, setAddedCrm] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<EmendaRadar | null>(null)
  const [detalhe, setDetalhe] = useState<EmendaDetalhe | null>(null)
  const [detalheLoading, setDetalheLoading] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  // A rota devolve TODAS as emendas do filtro (vinham do cache, sem recorte), e a
  // tabela imprimia as centenas de uma vez. A paginação aqui e client-side por isso:
  // os dados ja estao na mao, so faltava a regua.
  const [pagina, setPagina] = useState(1)
  const focadoRef = useRef(false)

  function abrirDetalhe(e: EmendaRadar) {
    setSelected(e)
    setDetalhe(null)
    setDetalheLoading(true)
    fetch(`/api/emendas/detalhe?codigo=${encodeURIComponent(e.codigoEmenda)}`)
      .then((r) => r.json())
      .then((d: EmendaDetalhe & { error?: string }) => { if (!d.error) setDetalhe(d) })
      .catch(() => {})
      .finally(() => setDetalheLoading(false))
  }

  const carregar = useCallback(() => {
    setLoading(true)
    setErro(null)
    const p = new URLSearchParams()
    if (usandoTerritorio) p.set('ufs', terr.join(','))
    else if (uf) p.set('uf', uf)
    if (ano) p.set('ano', ano)
    if (subfuncao) p.set('subfuncao', subfuncao)
    if (soQuentes) p.set('soQuentes', '1')
    fetch(`/api/radar-verba?${p}`)
      .then((r) => r.json())
      .then((d: Resposta) => { if (d.error) setErro(d); else setData(d) })
      .catch(() => setErro({ error: 'Falha ao carregar o radar.' } as Resposta))
      .finally(() => setLoading(false))
  }, [uf, ano, subfuncao, soQuentes, usandoTerritorio, terr])

  useEffect(() => { carregar() }, [carregar])
  // Filtro novo, pagina 1.
  useEffect(() => { setPagina(1) }, [uf, ano, subfuncao, soQuentes, usandoTerritorio])

  // Deep-link ?emenda=<codigo>: quando os dados chegam, abre o detalhe e destaca/rola
  // até a emenda que o usuário clicou nos Alertas. Roda uma única vez (focadoRef).
  useEffect(() => {
    if (!focoEmenda || focadoRef.current || !data?.emendas?.length) return
    const idx = data.emendas.findIndex((e) => e.codigoEmenda === focoEmenda)
    if (idx < 0) return
    const alvo = data.emendas[idx]
    focadoRef.current = true
    setPagina(Math.floor(idx / POR_PAGINA) + 1) // sem isto o deep-link caía numa página que não mostra a emenda
    abrirDetalhe(alvo)
    setHighlightId(alvo.codigoEmenda)
    setTimeout(() => document.getElementById(`emenda-row-${alvo.codigoEmenda}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120)
    setTimeout(() => setHighlightId(null), 3500)
  }, [focoEmenda, data])

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
              <select value={uf} onChange={(e) => { marcarUFTocado(); setUf(e.target.value) }} disabled={usandoTerritorio} title={usandoTerritorio ? 'Território ativo comanda as UFs' : undefined} className="text-[12px] bg-bg2 border border-subtle rounded-md px-2 py-1.5 text-strong focus:border-accent outline-none disabled:opacity-50">
                <option value="">Todas UFs</option>
                {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <TerritorioToggle ativo={terrAtivo} onToggle={setTerrAtivo} />
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
                      <th className="text-center font-medium px-3 py-2.5" title="Capacidade de pagamento (CAPAG do Tesouro) do ente beneficiário">CAPAG</th>
                      <th className="text-right font-medium px-3 py-2.5">Empenhado</th>
                      <th className="text-right font-medium px-3 py-2.5">Pago</th>
                      <th className="text-right font-medium px-3 py-2.5">Disponível</th>
                      <th className="text-left font-medium px-3 py-2.5 w-[90px]">% exec.</th>
                      <th className="text-right font-medium px-3 py-2.5">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.emendas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA).map((e) => {
                      const tm = TEMP_META[e.temperatura]
                      const added = addedCrm.has(e.codigoEmenda)
                      return (
                        <tr
                          key={e.codigoEmenda}
                          id={`emenda-row-${e.codigoEmenda}`}
                          onClick={() => abrirDetalhe(e)}
                          className={clsx('border-b border-subtle last:border-0 hover:bg-bg3 transition-colors cursor-pointer',
                            selected?.codigoEmenda === e.codigoEmenda && 'bg-bg3',
                            highlightId === e.codigoEmenda && 'ring-2 ring-accent ring-inset bg-accent/5')}
                        >
                          <td className="px-3 py-2.5">
                            <span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase', tm.cls)}>{tm.label} {e.score}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="text-strong">{e.municipio || '—'}</span>
                            <span className="text-faint"> / {e.uf || '—'}</span>
                            {e.esfera === 'estadual' && (
                              <span title="Emenda de deputado estadual (portal de transparência do estado)"
                                className="ml-1.5 text-[8px] font-mono-custom px-1 py-0.5 rounded bg-brand-purple/15 text-brand-purple border border-brand-purple/30 uppercase align-middle">Est</span>
                            )}
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
                          <td className="px-3 py-2.5 text-center">
                            <CapagBadge cap={e.capacidadePagamento} />
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono-custom text-muted">{formatBRL(e.empenhado)}</td>
                          <td className="px-3 py-2.5 text-right font-mono-custom text-muted">
                            {e.execucaoInformada ? formatBRL(e.pago) : <span className="text-faint italic" title="O Portal não informou pagamento/liquidação — diferente de pago R$0">n/inf.</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono-custom font-bold text-strong">{formatBRL(e.disponivel)}</td>
                          <td className="px-3 py-2.5">
                            {e.execucaoInformada ? (
                              <div className="flex items-center gap-1.5">
                                <div className="flex-1 h-1.5 bg-bg4 rounded-full overflow-hidden min-w-[36px]">
                                  <div className="h-full bg-accent rounded-full" style={{ width: `${Math.min(e.percentualExecutado, 100)}%` }} />
                                </div>
                                <span className="text-[10px] text-faint font-mono-custom w-8 text-right">{e.percentualExecutado}%</span>
                              </div>
                            ) : (
                              <span className="text-[10px] text-faint font-mono-custom italic" title="Execução não informada pelo Portal (≠ pago R$0)">não informado</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5" onClick={(ev) => ev.stopPropagation()}>
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
              <Paginacao
                pagina={pagina} totalItens={data.emendas.length} porPagina={POR_PAGINA}
                onPagina={setPagina} rotuloItens="emendas"
                className="border-t border-subtle"
              />
            </div>
          )}

          {data && (
            <p className="text-[10px] text-faint mt-3">
              Fonte: Portal da Transparência (emendas de saúde, ano {data.ano}). Clique numa emenda para ver os empenhos (para onde o dinheiro vai). O score é auxílio de priorização, não previsão. ⚠️ = emenda PIX (baixa rastreabilidade do destino). "n/inf." = Portal não informou pagamento (≠ pago R$0).
            </p>
          )}
        </main>

        {/* Slide-over: detalhe da emenda */}
        {selected && (
          <div className="fixed inset-0 z-40" onClick={() => setSelected(null)}>
            <div className="absolute inset-0 bg-black/40" />
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-0 h-full w-full max-w-[440px] bg-bg2 border-l border-subtle shadow-2xl overflow-y-auto"
            >
              {/* Cabeçalho */}
              <div className="sticky top-0 bg-bg2 border-b border-subtle px-5 py-4 flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase', TEMP_META[selected.temperatura].cls)}>
                      {TEMP_META[selected.temperatura].label} {selected.score}
                    </span>
                    {selected.baixaRastreabilidade && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-amber"><AlertTriangle size={11} /> PIX</span>
                    )}
                    {selected.capacidadePagamento && selected.capacidadePagamento.fonte !== 'na' && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted" title="Capacidade de pagamento da instituição">
                        <CapagBadge cap={selected.capacidadePagamento} /> capac. pgto
                      </span>
                    )}
                  </div>
                  <h2 className="font-heading font-bold text-[16px] text-strong mt-1.5">{selected.municipio || '—'} / {selected.uf || '—'}</h2>
                  <p className="text-[11px] text-muted">{selected.autor || 'Autor N/D'} · emenda {selected.numeroEmenda || selected.codigoEmenda}</p>
                </div>
                <button onClick={() => setSelected(null)} className="text-faint hover:text-strong transition-colors flex-shrink-0"><X size={18} /></button>
              </div>

              <div className="p-5 space-y-5">
                {/* Resumo financeiro */}
                <div className="grid grid-cols-3 gap-2">
                  <MiniStat label="Empenhado" valor={formatBRL(selected.empenhado)} />
                  <MiniStat label="Pago" valor={formatBRL(selected.pago)} />
                  <MiniStat label="Disponível" valor={formatBRL(selected.disponivel)} destaque />
                </div>
                <div className="text-[11px] text-muted">
                  <span className="text-faint">Subfunção:</span> {selected.subfuncao || '—'} · <span className="text-faint">Tipo:</span> {selected.tipo || '—'} · <span className="text-faint">% executado:</span> {selected.percentualExecutado}%
                </div>

                {/* Empenhos = para onde o dinheiro vai */}
                <div>
                  <div className="mb-2">
                    <div className="flex items-center gap-2">
                      <FileText size={13} className="text-accent" />
                      <span className="text-[11px] font-mono-custom text-faint uppercase tracking-wider">Empenhos já executados</span>
                    </div>
                    <p className="text-[10px] text-faint mt-1 leading-snug">
                      O que já foi comprometido. O valor <strong className="text-muted">disponível ({formatBRL(selected.disponivel)})</strong> ainda não tem destino definido — é a oportunidade a trabalhar.
                    </p>
                  </div>

                  {detalheLoading ? (
                    <div className="flex items-center gap-2 text-[12px] text-faint py-6 justify-center">
                      <Loader2 size={14} className="animate-spin" /> Carregando empenhos do Portal…
                    </div>
                  ) : !detalhe || detalhe.empenhos.length === 0 ? (
                    <p className="text-[12px] text-muted py-3">
                      Sem empenhos detalhados disponíveis para esta emenda no Portal
                      {detalhe && ` (fases: ${detalhe.fases.empenho} empenho, ${detalhe.fases.liquidacao} liquidação, ${detalhe.fases.pagamento} pagamento).`}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {detalhe.empenhos.map((emp, i) => (
                        <div key={i} className="bg-bg3 border border-subtle rounded-lg p-3">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-[12px] font-semibold text-strong">{emp.favorecido || 'Favorecido N/D'}</span>
                            <span className="text-[12px] font-mono-custom text-accent flex-shrink-0">{formatBRL(parseValorBR(emp.valor))}</span>
                          </div>
                          {(emp.orgao || emp.ug) && (
                            <div className="flex items-center gap-1 text-[10px] text-muted mt-1">
                              <Building2 size={10} className="text-faint" /> {[emp.orgao, emp.ug].filter(Boolean).join(' · ')}
                              {emp.ufFavorecido && <span className="text-faint">({emp.ufFavorecido})</span>}
                            </div>
                          )}
                          {emp.observacao && (
                            <p className="text-[11px] text-muted mt-1.5 leading-snug">{emp.observacao}</p>
                          )}
                          {emp.data && <p className="text-[10px] text-faint font-mono-custom mt-1">{emp.data}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Próximos passos — para o lead NÃO morrer no detalhe. */}
                <div className="space-y-2">
                  <div className="text-[11px] font-mono-custom text-faint uppercase tracking-wider">Próximos passos</div>
                  {selected.uf && (
                    <a href={`/oportunidades?uf=${selected.uf}&status=aberto`}
                       className="flex items-center justify-between bg-bg3 border border-subtle rounded-lg px-3 py-2.5 hover:border-accent transition-colors">
                      <span className="text-[12px] text-strong">Ver licitações abertas em {selected.uf}</span>
                      <ArrowRight size={14} className="text-accent flex-shrink-0" />
                    </a>
                  )}
                  <a href={PORTAL_URL} target="_blank" rel="noopener noreferrer"
                     className="flex items-center justify-between bg-bg3 border border-subtle rounded-lg px-3 py-2.5 hover:border-accent transition-colors">
                    <span className="text-[12px] text-strong">Abrir no Portal da Transparência</span>
                    <ExternalLink size={13} className="text-accent flex-shrink-0" />
                  </a>
                  <button onClick={() => adicionarCrm(selected)} disabled={addedCrm.has(selected.codigoEmenda)}
                     className="w-full flex items-center justify-between bg-bg3 border border-subtle rounded-lg px-3 py-2.5 hover:border-accent transition-colors disabled:opacity-60">
                    <span className="text-[12px] text-strong">{addedCrm.has(selected.codigoEmenda) ? 'Já no seu CRM' : 'Adicionar ao CRM (qualificar)'}</span>
                    {addedCrm.has(selected.codigoEmenda) ? <Check size={14} className="text-emerald-400 flex-shrink-0" /> : <Plus size={14} className="text-accent flex-shrink-0" />}
                  </button>
                </div>

                <p className="text-[10px] text-faint">
                  Lead a qualificar — a verba disponível não é venda garantida. Ligue, entenda o objeto e trabalhe o contato cedo.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// useSearchParams (deep-link ?emenda=) exige um Suspense boundary no App Router.
export default function RadarVerbaPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center bg-bg"><Loader2 size={22} className="animate-spin text-faint" /></div>}>
      <RadarVerbaConteudo />
    </Suspense>
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

function MiniStat({ label, valor, destaque }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div className={clsx('rounded-lg border p-2', destaque ? 'border-red/30 bg-red/5' : 'border-subtle bg-bg3')}>
      <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wide">{label}</div>
      <div className={clsx('text-[13px] font-mono-custom font-bold mt-0.5', destaque ? 'text-red' : 'text-strong')}>{valor}</div>
    </div>
  )
}
