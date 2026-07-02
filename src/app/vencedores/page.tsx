'use client'
// src/app/vencedores/page.tsx — TELA 1: Análise de Vencedores (resultados homologados do PNCP)
// Lê do banco via /api/resultados/vencedores (populado pelo ETL).

import React, { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import { Search, Trophy, Database, ChevronRight, ExternalLink, Building2, Users, ListTree } from 'lucide-react'
import { formatBRL, formatDate } from '@/lib/format'
import { CATEGORIAS, CATEGORIA_LABEL } from '@/lib/categoria-mercado'
import { publishDataStatus } from '@/lib/data-status'
import { ExportButton } from '@/components/ui/ExportButton'
import type { ExportColumn } from '@/lib/export'

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']

// cores dos badges por categoria
const CAT_COR: Record<string, string> = {
  equip_medico: 'bg-blue-500/15 text-blue-400',
  medicamento: 'bg-emerald-500/15 text-emerald-400',
  opme: 'bg-purple-500/15 text-purple-400',
  odontologico: 'bg-teal-500/15 text-teal-400',
  servico_saude: 'bg-amber-500/15 text-amber-400',
  acessorio: 'bg-cyan-500/15 text-cyan-400',
  laboratorio: 'bg-pink-500/15 text-pink-400',
  outros: 'bg-faint/10 text-faint',
}

const COLS_EXPORT: ExportColumn<Vencedor>[] = [
  { key: 'proponente', label: 'Proponente' },
  { key: 'convenio', label: 'Convênio' },
  { key: 'vencedor', label: 'Vencedor' },
  { key: 'codigo_catmat', label: 'Cód. CATMAT' },
  { key: 'nome_catmat', label: 'Item' },
  { key: 'categoria', label: 'Categoria', format: (v) => (v ? (CATEGORIA_LABEL[String(v)] ?? String(v)) : '') },
  { key: 'uf', label: 'UF' },
  { key: 'ano', label: 'Ano' },
  { key: 'qtd', label: 'Qtd' },
  { key: 'valor', label: 'Valor homologado (R$)' },
]

interface Vencedor {
  proponente: string | null
  convenio: string
  numero_item: number | null
  vencedor: string | null
  codigo_catmat: string | null
  nome_catmat: string | null
  categoria: string | null
  qtd: number | null
  valor: number | null
  uf: string | null
  ano: number | null
}
interface ApiResponse {
  kpis: { valorTotal: number; ticketMedio: number; itensUnicos: number; convenios: number; consumidores: number }
  vencedores: Vencedor[]
  categorias?: { categoria: string; n: number; valor: number }[]
  total: number
  atualizadoEm?: string
  fonte?: string
  error?: string
  instrucoes?: string
}

export default function VencedoresPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<{ msg: string; instrucoes?: string } | null>(null)

  const [ufsAtivos, setUfsAtivos] = useState<Set<string>>(new Set())
  const [empresa, setEmpresa] = useState('')
  const [empresaQuery, setEmpresaQuery] = useState('')
  const [catAtiva, setCatAtiva] = useState<string | null>(null)
  const [expandida, setExpandida] = useState<string | null>(null) // linha aberta (chave única)

  // debounce do campo empresa
  useEffect(() => { const t = setTimeout(() => setEmpresaQuery(empresa), 400); return () => clearTimeout(t) }, [empresa])

  const load = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const params = new URLSearchParams({ limit: '500' })
      if (ufsAtivos.size > 0) params.set('uf', [...ufsAtivos].join(','))
      if (empresaQuery) params.set('empresa', empresaQuery)
      if (catAtiva) params.set('categoria', catAtiva)
      const res = await fetch(`/api/resultados/vencedores?${params}`)
      const json: ApiResponse = await res.json()
      if (!res.ok) { setErro({ msg: json.error ?? 'Erro', instrucoes: json.instrucoes }); setData(null) }
      else { setData(json); publishDataStatus(json) }
    } catch (e) { setErro({ msg: String(e) }); setData(null) }
    finally { setLoading(false) }
  }, [ufsAtivos, empresaQuery, catAtiva])

  useEffect(() => { load() }, [load])

  const kpis = data?.kpis
  const vencedores = data?.vencedores ?? []
  const catMap = new Map((data?.categorias ?? []).map((c) => [c.categoria, c.n]))

  const KPI_CARDS = [
    { label: 'Valor total homologado', value: kpis ? formatBRL(kpis.valorTotal) : '—' },
    { label: 'Ticket médio', value: kpis ? formatBRL(kpis.ticketMedio) : '—' },
    { label: 'Itens únicos', value: kpis ? String(kpis.itensUnicos) : '—' },
    { label: 'Convênios', value: kpis ? String(kpis.convenios) : '—' },
    { label: 'Consumidores', value: kpis ? String(kpis.consumidores) : '—' },
  ]

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar
          title="Análise de Vencedores"
          subtitle={loading ? 'Carregando…' : `${data?.total ?? 0} resultados homologados`}
        />
        <main className="flex-1 overflow-y-auto p-6 bg-bg">

          {/* KPIs */}
          <div className="grid grid-cols-5 gap-3 mb-4">
            {KPI_CARDS.map(({ label, value }) => (
              <div key={label} className="bg-bg2 border border-subtle rounded-xl px-4 py-3">
                <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">{label}</div>
                <div className="text-[18px] font-mono-custom font-bold text-strong mt-0.5 leading-tight">{value}</div>
              </div>
            ))}
          </div>

          {/* Filtros */}
          <div className="bg-bg2 border border-subtle2 rounded-xl px-3 py-2.5 mb-3">
            <div className="flex gap-1 flex-wrap items-center">
              <button onClick={() => setUfsAtivos(new Set())}
                className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all',
                  ufsAtivos.size === 0 ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3')}>
                Todas UFs
              </button>
              {UFS.map((uf) => (
                <button key={uf} onClick={() => setUfsAtivos((p) => { const s = new Set(p); s.has(uf) ? s.delete(uf) : s.add(uf); return s })}
                  className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all',
                    ufsAtivos.has(uf) ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3')}>
                  {uf}
                </button>
              ))}
            </div>
          </div>

          {/* Filtros de categoria de mercado */}
          <div className="bg-bg2 border border-subtle2 rounded-xl px-3 py-2.5 mb-3">
            <div className="flex gap-1 flex-wrap items-center">
              <button onClick={() => setCatAtiva(null)}
                className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all',
                  catAtiva === null ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3')}>
                Todas categorias
              </button>
              {CATEGORIAS.map(({ key, label }) => {
                const n = catMap.get(key)
                return (
                  <button key={key} onClick={() => setCatAtiva((p) => (p === key ? null : key))}
                    className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all flex items-center gap-1',
                      catAtiva === key ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3')}>
                    {label}
                    {n != null && <span className={clsx('text-[9px]', catAtiva === key ? 'text-black/60' : 'text-faint')}>{n}</span>}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex items-center gap-2 mb-4">
            <div className="flex items-center gap-2 bg-bg2 border border-subtle2 rounded-lg px-3 py-2 max-w-md flex-1">
              <Search size={13} className="text-faint flex-shrink-0" />
              <input value={empresa} onChange={(e) => setEmpresa(e.target.value)}
                placeholder="Buscar empresa vencedora…"
                className="flex-1 bg-transparent text-[12px] text-strong placeholder:text-faint outline-none" />
            </div>
            <ExportButton data={vencedores} columns={COLS_EXPORT} filename="govhealth-vencedores" title="Vencedores — GovHealth AI" />
          </div>

          {/* Conteúdo */}
          {loading ? (
            <div className="bg-bg2 border border-subtle rounded-xl p-10 text-center text-faint text-[13px]">Carregando vencedores…</div>
          ) : erro ? (
            <div className="bg-bg2 border border-amber/30 rounded-xl p-8 text-center">
              <Database size={28} className="text-amber mx-auto mb-3" />
              <div className="text-[13px] text-strong mb-1">{erro.msg}</div>
              {erro.instrucoes && <div className="text-[12px] text-muted max-w-[520px] mx-auto font-mono-custom">{erro.instrucoes}</div>}
            </div>
          ) : vencedores.length === 0 ? (
            <div className="bg-bg2 border border-subtle rounded-xl p-10 text-center text-faint text-[13px]">
              Nenhum resultado homologado ainda. Rode o ETL (<span className="font-mono-custom">npm run etl</span>) para popular o banco.
            </div>
          ) : (
            <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-subtle bg-bg3/30">
                    <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Proponente</th>
                    <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5">Convênio</th>
                    <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Vencedor</th>
                    <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Item</th>
                    <th className="text-center text-[9px] font-mono-custom text-faint uppercase tracking-wider px-2 py-2.5 w-10">UF</th>
                    <th className="text-right text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5">Qtd</th>
                    <th className="text-right text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Valor vencedor</th>
                  </tr>
                </thead>
                <tbody>
                  {vencedores.map((v, i) => {
                    const chave = `${v.convenio}::${v.numero_item ?? '-'}::${i}`
                    const aberta = expandida === chave
                    return (
                      <React.Fragment key={chave}>
                        <tr
                          onClick={() => setExpandida(aberta ? null : chave)}
                          className={clsx('border-b border-subtle last:border-0 cursor-pointer transition-colors',
                            aberta ? 'bg-bg3' : 'hover:bg-bg3')}
                        >
                          <td className="px-4 py-2.5 text-[11px] text-strong max-w-[200px]">
                            <div className="flex items-center gap-1.5">
                              <ChevronRight size={12} className={clsx('text-faint flex-shrink-0 transition-transform', aberta && 'rotate-90')} />
                              <span className="truncate">{v.proponente ?? '—'}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-[10px] font-mono-custom text-faint max-w-[140px] truncate">{v.convenio}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1.5 text-[12px] text-strong max-w-[200px] truncate">
                              <Trophy size={11} className="text-amber flex-shrink-0" />
                              {v.vencedor ?? '—'}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 max-w-[260px]">
                            {v.categoria && (
                              <span className={clsx('inline-block text-[8px] font-mono-custom uppercase tracking-wide px-1.5 py-0.5 rounded mb-0.5', CAT_COR[v.categoria] ?? CAT_COR.outros)}>
                                {CATEGORIA_LABEL[v.categoria] ?? v.categoria}
                              </span>
                            )}
                            <div className="text-[11px] text-muted truncate" title={v.nome_catmat ?? undefined}>
                              {v.codigo_catmat ? <span className="font-mono-custom text-faint">{v.codigo_catmat} · </span> : null}{v.nome_catmat ?? '—'}
                            </div>
                          </td>
                          <td className="px-2 py-2.5 text-center text-[11px] font-mono-custom text-faint">{v.uf ?? '—'}</td>
                          <td className="px-3 py-2.5 text-right text-[11px] font-mono-custom text-muted">{v.qtd ?? '—'}</td>
                          <td className="px-4 py-2.5 text-right text-[12px] font-mono-custom font-bold text-strong">{v.valor != null ? formatBRL(v.valor) : '—'}</td>
                        </tr>
                        {aberta && (
                          <tr className="bg-bg/40">
                            <td colSpan={7} className="px-4 py-4 border-b border-subtle">
                              <DetalheResultado convenio={v.convenio} numeroItem={v.numero_item} vencedorAtual={v.vencedor} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

// ── Detalhe expandido de um resultado ────────────────────────────────────────
interface Detalhe {
  cabecalho: {
    razao_social_orgao: string | null
    cnpj_orgao: string | null
    municipio: string | null
    uf: string | null
    modalidade_nome: string | null
    objeto_compra: string | null
    ano_compra: number | null
    valor_total_estimado: number | null
    data_publicacao: string | null
    situacao_label: string | null
    pncp_url: string | null
  }
  item: {
    numero_item: number | null
    descricao: string | null
    codigo_catmat: string | null
    quantidade: number | null
    valor_unitario_estimado: number | null
  } | null
  concorrentes: {
    ni_fornecedor: string | null
    nome_fornecedor: string | null
    porte_fornecedor: string | null
    qtd: number | null
    valor_unitario: number | null
    valor: number | null
    ordem: number | null
  }[]
  processoItens: {
    numero_item: number | null
    item: string | null
    codigo_catmat: string | null
    vencedor: string | null
    valor: number | null
  }[]
  error?: string
}

function DetalheResultado({ convenio, numeroItem, vencedorAtual }: { convenio: string; numeroItem: number | null; vencedorAtual: string | null }) {
  const [det, setDet] = useState<Detalhe | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setLoading(true); setErro(null)
    const params = new URLSearchParams({ convenio })
    if (numeroItem != null) params.set('item', String(numeroItem))
    fetch(`/api/resultados/detalhe?${params}`)
      .then(async (r) => {
        const j: Detalhe = await r.json()
        if (!vivo) return
        if (!r.ok) setErro(j.error ?? 'Erro ao carregar detalhe')
        else setDet(j)
      })
      .catch((e) => { if (vivo) setErro(String(e)) })
      .finally(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [convenio, numeroItem])

  if (loading) return <div className="text-[12px] text-faint py-2">Carregando detalhes do processo…</div>
  if (erro) return <div className="text-[12px] text-amber py-2">{erro}</div>
  if (!det) return null

  const cab = det.cabecalho
  const norm = (s: string | null) => (s ?? '').trim().toLowerCase()
  const temMaisDeUm = det.concorrentes.length > 1

  return (
    <div className="grid grid-cols-3 gap-4">
      {/* Convênio / processo */}
      <div className="col-span-1 bg-bg2 border border-subtle2 rounded-lg p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Building2 size={12} className="text-accent" />
          <span className="text-[10px] font-mono-custom uppercase tracking-wider text-faint">Convênio / Processo</span>
        </div>
        <dl className="space-y-1.5 text-[11px]">
          <div><dt className="text-faint">Órgão</dt><dd className="text-strong">{cab.razao_social_orgao ?? '—'}</dd></div>
          <div className="flex gap-4">
            <div><dt className="text-faint">CNPJ</dt><dd className="text-muted font-mono-custom">{cab.cnpj_orgao ?? '—'}</dd></div>
            <div><dt className="text-faint">Local</dt><dd className="text-muted">{[cab.municipio, cab.uf].filter(Boolean).join(' / ') || '—'}</dd></div>
          </div>
          <div className="flex gap-4">
            <div><dt className="text-faint">Modalidade</dt><dd className="text-muted">{cab.modalidade_nome ?? '—'}</dd></div>
            <div><dt className="text-faint">Situação</dt><dd className="text-muted">{cab.situacao_label ?? '—'}</dd></div>
          </div>
          <div className="flex gap-4">
            <div><dt className="text-faint">Publicação</dt><dd className="text-muted font-mono-custom">{formatDate(cab.data_publicacao)}</dd></div>
            <div><dt className="text-faint">Valor estimado</dt><dd className="text-muted font-mono-custom">{formatBRL(cab.valor_total_estimado)}</dd></div>
          </div>
          {cab.objeto_compra && (
            <div><dt className="text-faint">Objeto</dt><dd className="text-muted leading-snug">{cab.objeto_compra}</dd></div>
          )}
          <div className="font-mono-custom text-[10px] text-faint pt-1">Nº controle PNCP: {convenio}</div>
        </dl>
        {cab.pncp_url && (
          <a href={cab.pncp_url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-2 text-[11px] text-accent hover:underline">
            <ExternalLink size={11} /> Ver processo no PNCP
          </a>
        )}
      </div>

      {/* Concorrentes do item */}
      <div className="col-span-1 bg-bg2 border border-subtle2 rounded-lg p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Users size={12} className="text-accent" />
          <span className="text-[10px] font-mono-custom uppercase tracking-wider text-faint">
            Concorrentes do item{det.item?.codigo_catmat ? ` (${det.item.codigo_catmat})` : ''}
          </span>
        </div>
        {det.concorrentes.length === 0 ? (
          <div className="text-[11px] text-faint">Nenhum fornecedor registrado para este item.</div>
        ) : (
          <>
            <div className="space-y-1">
              {det.concorrentes.map((f, idx) => {
                const venceu = norm(f.nome_fornecedor) === norm(vencedorAtual) || (idx === 0 && !vencedorAtual)
                return (
                  <div key={`${f.ni_fornecedor}-${idx}`}
                    className={clsx('flex items-center justify-between gap-2 rounded px-2 py-1',
                      venceu ? 'bg-amber/10' : 'bg-bg3/40')}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      {venceu
                        ? <Trophy size={10} className="text-amber flex-shrink-0" />
                        : <span className="text-[9px] font-mono-custom text-faint w-2.5 text-center flex-shrink-0">{f.ordem ?? idx + 1}</span>}
                      <div className="min-w-0">
                        <div className="text-[11px] text-strong truncate">{f.nome_fornecedor ?? '—'}</div>
                        <div className="text-[9px] text-faint font-mono-custom">
                          {f.ni_fornecedor ?? '—'}{f.porte_fornecedor ? ` · ${f.porte_fornecedor}` : ''}
                        </div>
                      </div>
                    </div>
                    <div className="text-[11px] font-mono-custom font-bold text-strong flex-shrink-0">{formatBRL(f.valor)}</div>
                  </div>
                )
              })}
            </div>
            {!temMaisDeUm && (
              <div className="text-[10px] text-faint mt-2 leading-snug">
                Apenas o vencedor foi homologado/registrado neste item pelo PNCP.
              </div>
            )}
          </>
        )}
      </div>

      {/* Itens do processo */}
      <div className="col-span-1 bg-bg2 border border-subtle2 rounded-lg p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <ListTree size={12} className="text-accent" />
          <span className="text-[10px] font-mono-custom uppercase tracking-wider text-faint">Itens do processo ({det.processoItens.length})</span>
        </div>
        {det.processoItens.length === 0 ? (
          <div className="text-[11px] text-faint">Sem itens homologados neste processo.</div>
        ) : (
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {det.processoItens.map((it, idx) => {
              const atual = it.numero_item === numeroItem
              return (
                <div key={`${it.numero_item}-${idx}`}
                  className={clsx('rounded px-2 py-1', atual ? 'bg-accent/10 border border-accent/30' : 'bg-bg3/40')}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] text-strong truncate">
                      {it.codigo_catmat ? <span className="font-mono-custom text-faint">{it.codigo_catmat} · </span> : null}{it.item}
                    </div>
                    <div className="text-[10px] font-mono-custom font-bold text-strong flex-shrink-0">{formatBRL(it.valor)}</div>
                  </div>
                  <div className="text-[9px] text-faint truncate">Vencedor: {it.vencedor ?? '—'}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
