'use client'
// src/components/admin/AdminAnalytics.tsx — análise de acessos do admin:
// quem está acessando (usuários, estados, cidades, dispositivos) e o que é mais
// acessado (páginas), com filtro por período e por estado. Gráficos: recharts.

import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Cell, PieChart, Pie,
} from 'recharts'
import { Users, MousePointerClick, LogIn, Activity, Download, ChevronDown, FileText, Table2 } from 'lucide-react'
import { exportSheetsToXLSX, exportToCSV, type ExportSheet } from '@/lib/export'

interface Analise {
  kpis: { total: number; unicos: number; logins: number; pageviews: number }
  serie: { dia: string; logins: number; pageviews: number }[]
  porUf: { uf: string; n: number }[]
  topRotas: { rota: string; n: number }[]
  topUsuarios: { email: string | null; nome: string | null; n: number }[]
  topCidades: { cidade: string; n: number }[]
  dispositivos: { tipo: string; n: number }[]
  ufs: string[]
}

const ROTA_LABEL: Record<string, string> = {
  '/': 'Dashboard', '/oportunidades': 'Licitações', '/analise': 'Maior Atuação', '/mapa': 'Mapa',
  '/vencedores': 'Vencedores', '/fornecedores': 'Fornecedores', '/concorrentes-estado': 'Concorrentes/UF',
  '/breakdown': 'Breakdown', '/concorrentes': 'Concorrentes', '/timeline': 'Timeline', '/precos': 'Preços Ref.',
  '/crm': 'Pipeline CRM', '/agenda': 'Agenda de Prazos', '/editais': 'Dossiês de Edital', '/contratos': 'Contratos.gov',
  '/estados': 'Portais Estaduais', '/radar-verba': 'Radar de Verba', '/alertas': 'Alertas', '/portfolio': 'Meu Portfólio',
  '/perfil': 'Perfil', '/manual': 'Manual', '/copiloto': 'Copiloto IA', '/edital': 'Copiloto de Edital',
}
const rotulo = (r: string) => ROTA_LABEL[r] ?? r
const PIE = ['#2f80ed', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#dc2626']
const accent = '#2f80ed'

const diaCurto = (s: string) => { const [, m, d] = s.split('-'); return `${d}/${m}` }
const fmtDataHora = (s: string) => { if (!s) return ''; const [dt, tm] = s.split('T'); const [a, m, d] = dt.split('-'); return `${d}/${m}/${a} ${(tm || '').slice(0, 5)}` }

export default function AdminAnalytics() {
  const [dias, setDias] = useState('30')
  const [uf, setUf] = useState('todos')
  const [d, setD] = useState<Analise | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const p = new URLSearchParams({ dias })
    if (uf !== 'todos') p.set('uf', uf)
    fetch(`/api/admin/analytics?${p}`).then((r) => r.json()).then(setD).catch(() => {}).finally(() => setLoading(false))
  }, [dias, uf])

  // ── Exportação ──────────────────────────────────────────────────────────────
  const [expOpen, setExpOpen] = useState(false)
  const expRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (expRef.current && !expRef.current.contains(e.target as Node)) setExpOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const sufixo = `${dias}d${uf !== 'todos' ? `_${uf}` : ''}_${new Date().toISOString().slice(0, 10)}`
  const rotasFmt = () => (d?.topRotas ?? []).map((r) => ({ pagina: rotulo(r.rota), rota: r.rota, n: r.n }))

  const [exportando, setExportando] = useState(false)
  async function exportarExcel() {
    if (!d) return
    setExportando(true)
    // Lista detalhada de acessos (IP/cidade) — respeita período/estado ativos.
    let detalhe: Record<string, unknown>[] = []
    try {
      const p = new URLSearchParams({ dias, limit: '2000' })
      if (uf !== 'todos') p.set('uf', uf)
      const r = await fetch(`/api/admin/acessos?${p}`)
      detalhe = (await r.json()).linhas ?? []
    } catch { /* segue com o resto mesmo sem o detalhe */ }

    const sheets: ExportSheet[] = [
      { name: 'Resumo', columns: [{ key: 'm', label: 'Métrica' }, { key: 'v', label: 'Valor' }],
        data: [{ m: 'Acessos', v: d.kpis.total }, { m: 'Visitantes únicos', v: d.kpis.unicos }, { m: 'Logins', v: d.kpis.logins }, { m: 'Páginas vistas', v: d.kpis.pageviews }] },
      { name: 'Acessos por dia', columns: [{ key: 'dia', label: 'Dia' }, { key: 'logins', label: 'Logins' }, { key: 'pageviews', label: 'Páginas vistas' }], data: d.serie },
      { name: 'Por estado', columns: [{ key: 'uf', label: 'Estado (UF)' }, { key: 'n', label: 'Acessos' }], data: d.porUf },
      { name: 'Quem acessa', columns: [{ key: 'nome', label: 'Nome' }, { key: 'email', label: 'E-mail' }, { key: 'n', label: 'Acessos' }], data: d.topUsuarios },
      { name: 'Mais acessado', columns: [{ key: 'pagina', label: 'Página' }, { key: 'rota', label: 'Rota' }, { key: 'n', label: 'Acessos' }], data: rotasFmt() },
      { name: 'Cidades', columns: [{ key: 'cidade', label: 'Cidade' }, { key: 'n', label: 'Acessos' }], data: d.topCidades },
      { name: 'Dispositivos', columns: [{ key: 'tipo', label: 'Tipo' }, { key: 'n', label: 'Acessos' }], data: d.dispositivos },
      { name: 'Acessos (detalhe)', columns: [
          { key: 'criado_em', label: 'Data/hora', format: (v) => fmtDataHora(String(v ?? '')) },
          { key: 'nome', label: 'Nome' }, { key: 'email', label: 'E-mail' },
          { key: 'evento', label: 'Evento' }, { key: 'rota', label: 'Rota' },
          { key: 'ip', label: 'IP' }, { key: 'cidade', label: 'Cidade' },
          { key: 'regiao', label: 'UF/Região' }, { key: 'pais', label: 'País' },
        ], data: detalhe },
    ]
    exportSheetsToXLSX(sheets, `analise-acessos_${sufixo}`)
    setExportando(false)
    setExpOpen(false)
  }
  function csvQuem() {
    exportToCSV(d?.topUsuarios ?? [], [{ key: 'nome', label: 'Nome' }, { key: 'email', label: 'E-mail' }, { key: 'n', label: 'Acessos' }], `quem-acessa_${sufixo}`)
    setExpOpen(false)
  }
  function csvRotas() {
    exportToCSV(rotasFmt(), [{ key: 'pagina', label: 'Página' }, { key: 'rota', label: 'Rota' }, { key: 'n', label: 'Acessos' }], `mais-acessado_${sufixo}`)
    setExpOpen(false)
  }

  return (
    <div>
      {/* Filtros */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="font-heading font-bold text-[16px]">Quem acessa & o que é mais acessado</h2>
          <p className="text-[11.5px] text-muted">Análise de acessos {uf !== 'todos' ? `· estado ${uf}` : '· todos os estados'}</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={uf} onChange={(e) => setUf(e.target.value)} className="text-[12px] bg-bg2 border border-subtle rounded-lg px-2.5 py-2 focus:border-accent outline-none">
            <option value="todos">Todos os estados</option>
            {(d?.ufs ?? []).map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <select value={dias} onChange={(e) => setDias(e.target.value)} className="text-[12px] bg-bg2 border border-subtle rounded-lg px-2.5 py-2 focus:border-accent outline-none">
            <option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option>
          </select>
          {/* Exportar */}
          <div className="relative" ref={expRef}>
            <button onClick={() => setExpOpen((p) => !p)} disabled={!d || d.kpis.total === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-white text-[12px] font-semibold hover:bg-accent-2 transition-colors disabled:opacity-40">
              <Download size={13} /> Exportar <ChevronDown size={11} className={expOpen ? 'rotate-180' : ''} />
            </button>
            {expOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-bg2 border border-subtle rounded-lg shadow-lg z-50 py-1 overflow-hidden">
                <button onClick={exportarExcel} disabled={exportando} className="flex items-center gap-2.5 w-full px-3 py-2 text-[12px] text-muted hover:bg-bg3 hover:text-strong transition-colors text-left disabled:opacity-50">
                  <Table2 size={13} /> {exportando ? 'Gerando…' : 'Excel completo'} <span className="ml-auto text-[10px] font-mono-custom text-faint">.xlsx</span>
                </button>
                <div className="my-1 border-t border-subtle" />
                <button onClick={csvQuem} className="flex items-center gap-2.5 w-full px-3 py-2 text-[12px] text-muted hover:bg-bg3 hover:text-strong transition-colors text-left">
                  <FileText size={13} /> CSV — Quem acessa
                </button>
                <button onClick={csvRotas} className="flex items-center gap-2.5 w-full px-3 py-2 text-[12px] text-muted hover:bg-bg3 hover:text-strong transition-colors text-left">
                  <FileText size={13} /> CSV — Mais acessado
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {loading && !d ? (
        <div className="text-faint text-[13px] py-10 text-center">Carregando análise…</div>
      ) : !d ? (
        <div className="text-faint text-[13px] py-10 text-center">Sem dados.</div>
      ) : (
        <div className={clsx('transition-opacity', loading && 'opacity-60')}>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <KpiA icon={Activity} label="Acessos" v={d.kpis.total} />
            <KpiA icon={Users} label="Visitantes únicos" v={d.kpis.unicos} />
            <KpiA icon={LogIn} label="Logins" v={d.kpis.logins} />
            <KpiA icon={MousePointerClick} label="Páginas vistas" v={d.kpis.pageviews} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Série temporal */}
            <Card title="Acessos por dia" span2>
              {d.serie.length === 0 ? <Vazio /> : (
                <ResponsiveContainer width="100%" height={190}>
                  <AreaChart data={d.serie} margin={{ top: 6, right: 8, left: -6, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gLog" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={accent} stopOpacity={0.35} /><stop offset="100%" stopColor={accent} stopOpacity={0} /></linearGradient>
                      <linearGradient id="gPv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#16a34a" stopOpacity={0.3} /><stop offset="100%" stopColor="#16a34a" stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.06)" vertical={false} />
                    <XAxis dataKey="dia" tickFormatter={diaCurto} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} minTickGap={20} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} width={42} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid rgba(15,23,42,0.1)' }} labelFormatter={(l) => `Dia ${diaCurto(String(l))}`} />
                    <Area type="monotone" dataKey="logins" name="Logins" stroke={accent} strokeWidth={2} fill="url(#gLog)" />
                    <Area type="monotone" dataKey="pageviews" name="Páginas" stroke="#16a34a" strokeWidth={2} fill="url(#gPv)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Card>

            {/* Por estado (barras clicáveis) */}
            <Card title="Acessos por estado (clique para filtrar)">
              {d.porUf.length === 0 ? <Vazio texto="Sem geolocalização de estado ainda." /> : (
                <ResponsiveContainer width="100%" height={Math.max(150, d.porUf.length * 26)}>
                  <BarChart data={d.porUf} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis type="category" dataKey="uf" width={34} tick={{ fontSize: 11, fill: '#5b6573' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} cursor={{ fill: 'rgba(47,128,237,0.06)' }} />
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <Bar dataKey="n" name="acessos" radius={[0, 4, 4, 0]} onClick={(e: any) => e?.payload?.uf && setUf(e.payload.uf)} cursor="pointer">
                      {d.porUf.map((r) => <Cell key={r.uf} fill={r.uf === uf ? '#1f6fd6' : accent} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            {/* Quem mais acessa */}
            <Card title="Quem mais acessa">
              {d.topUsuarios.length === 0 ? <Vazio /> : (
                <BarList itens={d.topUsuarios.map((u) => ({ label: u.nome || u.email || '—', sub: u.nome ? u.email ?? undefined : undefined, n: u.n }))} />
              )}
            </Card>

            {/* O que é mais acessado */}
            <Card title="O que é mais acessado">
              {d.topRotas.length === 0 ? (
                <Vazio texto="O rastreamento de páginas começou agora — os dados aparecem conforme o uso." />
              ) : (
                <BarList itens={d.topRotas.map((r) => ({ label: rotulo(r.rota), sub: r.rota, n: r.n }))} cor="#16a34a" />
              )}
            </Card>

            {/* Cidades */}
            <Card title="Principais cidades">
              {d.topCidades.length === 0 ? <Vazio texto="Sem cidades identificadas ainda." /> : (
                <BarList itens={d.topCidades.map((c) => ({ label: c.cidade, n: c.n }))} cor="#0891b2" />
              )}
            </Card>

            {/* Dispositivos */}
            <Card title="Dispositivos">
              {d.dispositivos.length === 0 ? <Vazio /> : (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width="50%" height={150}>
                    <PieChart>
                      <Pie data={d.dispositivos} dataKey="n" nameKey="tipo" innerRadius={34} outerRadius={58} paddingAngle={2}>
                        {d.dispositivos.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-1.5">
                    {d.dispositivos.map((x, i) => (
                      <div key={x.tipo} className="flex items-center gap-2 text-[12px]">
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: PIE[i % PIE.length] }} />
                        <span className="capitalize text-muted flex-1">{x.tipo}</span>
                        <span className="font-mono-custom text-strong">{x.n}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

function KpiA({ icon: Icon, label, v }: { icon: React.ElementType; label: string; v: number }) {
  return (
    <div className="bg-bg2 border border-subtle rounded-xl p-3.5">
      <div className="flex items-center gap-1.5 text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1"><Icon size={12} /> {label}</div>
      <div className="font-heading font-bold text-[22px] text-strong">{v.toLocaleString('pt-BR')}</div>
    </div>
  )
}

function Card({ title, children, span2 }: { title: string; children: React.ReactNode; span2?: boolean }) {
  return (
    <div className={clsx('bg-bg2 border border-subtle rounded-xl p-4', span2 && 'lg:col-span-2')}>
      <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-3">{title}</div>
      {children}
    </div>
  )
}

function Vazio({ texto = 'Sem dados no período.' }: { texto?: string }) {
  return <div className="text-[12px] text-faint py-6 text-center">{texto}</div>
}

function BarList({ itens, cor = accent }: { itens: { label: string; sub?: string; n: number }[]; cor?: string }) {
  const max = Math.max(1, ...itens.map((i) => i.n))
  return (
    <div className="space-y-2">
      {itens.map((it, idx) => (
        <div key={idx} className="text-[12px]">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span className="text-strong truncate">{it.label}{it.sub && <span className="text-faint font-mono-custom text-[10.5px] ml-1.5">{it.sub}</span>}</span>
            <span className="font-mono-custom text-muted flex-shrink-0">{it.n}</span>
          </div>
          <div className="h-1.5 bg-bg4 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(it.n / max) * 100}%`, background: cor }} /></div>
        </div>
      ))}
    </div>
  )
}
