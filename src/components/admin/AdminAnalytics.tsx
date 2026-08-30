'use client'
// src/components/admin/AdminAnalytics.tsx — análise de acessos do admin:
// quem está acessando (usuários, estados, cidades, dispositivos) e o que é mais
// acessado (páginas), com filtro por período, por estado e por usuário. Com um
// usuário escolhido, todo o painel passa a falar dele e aparece a linha do
// tempo: que página ele abriu, em que dia e a que horas. Gráficos: recharts.

import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Cell, PieChart, Pie,
} from 'recharts'
import { Users, MousePointerClick, LogIn, Activity, Download, ChevronDown, FileText, Table2, Filter } from 'lucide-react'
import { exportSheetsToXLSX, exportToCSV, type ExportSheet } from '@/lib/export'

interface Analise {
  kpis: { total: number; unicos: number; logins: number; pageviews: number }
  serie: { dia: string; logins: number; pageviews: number }[]
  porUf: { uf: string; n: number }[]
  topRotas: { rota: string; n: number }[]
  topUsuarios: { email: string | null; nome: string | null; n: number }[]
  topCidades: { cidade: string; n: number }[]
  dispositivos: { tipo: string; n: number }[]
  porHora: { hora: number; n: number }[]
  ufs: string[]
  usuarios: { email: string; nome: string | null; n: number }[]
  visitas: { criado_em: string; evento: string; rota: string | null; cidade: string | null; regiao: string | null }[]
  resumo: { primeiro: string; ultimo: string; diasAtivos: number; total: number } | null
}

// Mesmos nomes da Sidebar — é o vocabulário que o cliente vê. Rota sem nome aqui
// aparecia crua e duplicada na tela ("/radar  /radar"); ver `rotulo`/`subRota`.
const ROTA_LABEL: Record<string, string> = {
  '/': 'Dashboard', '/oportunidades': 'Licitações', '/analise': 'Maior Atuação', '/mapa': 'Mapa',
  '/vencedores': 'Vencedores', '/fornecedores': 'Fornecedores', '/concorrentes-estado': 'Concorrentes/UF',
  '/breakdown': 'Breakdown', '/concorrentes': 'Concorrentes', '/timeline': 'Timeline', '/precos': 'Preços Ref.',
  '/crm': 'Pipeline CRM', '/agenda': 'Agenda de Prazos', '/editais': 'Dossiês de Edital', '/contratos': 'Contratos.gov',
  '/estados': 'Portais Estaduais', '/radar-verba': 'Radar de Verba', '/alertas': 'Alertas', '/portfolio': 'Meu Portfólio',
  '/perfil': 'Setup da Empresa', '/manual': 'Manual do usuário', '/copiloto': 'Copiloto IA', '/edital': 'Copiloto de Edital',
  '/radar': 'Radar de Chat', '/conta': 'Minha Conta', '/equipe': 'Equipe', '/documentos': 'Cofre de Documentos',
  '/minhas-disputas': 'Minhas Disputas', '/assinar': 'Assinar', '/metodologia': 'Metodologia', '/privacidade': 'Privacidade',
}
const rotulo = (r: string) => ROTA_LABEL[r] ?? r
/** A rota como legenda — vazia quando ela JÁ é o rótulo, para não repetir. */
const subRota = (r: string) => (ROTA_LABEL[r] ? r : undefined)
const PIE = ['#2f80ed', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#dc2626']
const accent = '#2f80ed'

const diaCurto = (s: string) => { const [, m, d] = s.split('-'); return `${d}/${m}` }
const fmtDataHora = (s: string) => { if (!s) return ''; const [dt, tm] = s.split('T'); const [a, m, d] = dt.split('-'); return `${d}/${m}/${a} ${(tm || '').slice(0, 5)}` }

export default function AdminAnalytics() {
  const [dias, setDias] = useState('30')
  const [uf, setUf] = useState('todos')
  const [usuario, setUsuario] = useState('todos')
  const [d, setD] = useState<Analise | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const p = new URLSearchParams({ dias })
    if (uf !== 'todos') p.set('uf', uf)
    if (usuario !== 'todos') p.set('usuario', usuario)
    fetch(`/api/admin/analytics?${p}`).then((r) => r.json()).then(setD).catch(() => {}).finally(() => setLoading(false))
  }, [dias, uf, usuario])

  // O seletor é a lista do período — que não muda ao escolher alguém. Mas se o
  // usuário escolhido não tiver acesso NENHUM na janela (trocou-se o período
  // depois de escolher), ele sumiria da lista e o select mostraria outro nome
  // sem avisar. Aqui ele continua na lista, marcado como fora do período.
  const listaUsuarios = d?.usuarios ?? []
  const escolhidoSumiu = usuario !== 'todos' && !listaUsuarios.some((u) => u.email === usuario)
  // Quem sai da janela sai da lista e levaria o nome junto, deixando o e-mail
  // cru na tela. O nome já visto uma vez fica guardado.
  const nomesVistos = useRef(new Map<string, string>())
  useEffect(() => {
    for (const u of d?.usuarios ?? []) if (u.nome) nomesVistos.current.set(u.email, u.nome)
  }, [d])
  const nomeUsuario = listaUsuarios.find((u) => u.email === usuario)?.nome
    || nomesVistos.current.get(usuario) || usuario
  const filtrando = usuario !== 'todos'
  // Sem o nome no título de cada card, o painel filtrado é indistinguível do
  // painel inteiro — os números mudam, mas nada na tela diz de quem eles são.
  const de = (titulo: string, comFiltro: string) => (filtrando ? comFiltro.replace('{}', nomeUsuario) : titulo)

  // ── Exportação ──────────────────────────────────────────────────────────────
  const [expOpen, setExpOpen] = useState(false)
  const expRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (expRef.current && !expRef.current.contains(e.target as Node)) setExpOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const sufixo = `${dias}d${uf !== 'todos' ? `_${uf}` : ''}${usuario !== 'todos' ? `_${usuario.split('@')[0]}` : ''}_${new Date().toISOString().slice(0, 10)}`
  const rotasFmt = () => (d?.topRotas ?? []).map((r) => ({ pagina: rotulo(r.rota), rota: r.rota, n: r.n }))
  const visitasFmt = () => (d?.visitas ?? []).map((v) => ({
    criado_em: v.criado_em, evento: v.evento, pagina: v.rota ? rotulo(v.rota) : '', rota: v.rota, cidade: v.cidade, regiao: v.regiao,
  }))

  const [exportando, setExportando] = useState(false)
  async function exportarExcel() {
    if (!d) return
    setExportando(true)
    // Lista detalhada de acessos (IP/cidade) — respeita período/estado ativos.
    let detalhe: Record<string, unknown>[] = []
    try {
      const p = new URLSearchParams({ dias, limit: '2000' })
      if (uf !== 'todos') p.set('uf', uf)
      if (usuario !== 'todos') p.set('email', usuario)
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
      { name: 'Horários', columns: [{ key: 'hora', label: 'Hora (Brasília)', format: (v) => `${v}h` }, { key: 'n', label: 'Acessos' }], data: d.porHora },
      { name: 'Acessos (detalhe)', columns: [
          { key: 'criado_em', label: 'Data/hora', format: (v) => fmtDataHora(String(v ?? '')) },
          { key: 'nome', label: 'Nome' }, { key: 'email', label: 'E-mail' },
          { key: 'evento', label: 'Evento' }, { key: 'rota', label: 'Rota' },
          { key: 'ip', label: 'IP' }, { key: 'cidade', label: 'Cidade' },
          { key: 'regiao', label: 'UF/Região' }, { key: 'pais', label: 'País' },
        ], data: detalhe },
    ]
    // Com um usuário escolhido, a linha do tempo é a planilha que interessa —
    // entra logo depois do resumo, não no fim junto do apêndice.
    if (usuario !== 'todos' && (d.visitas?.length ?? 0) > 0) {
      sheets.splice(1, 0, {
        name: 'Linha do tempo',
        columns: [
          { key: 'criado_em', label: 'Data/hora', format: (v) => fmtDataHora(String(v ?? '')) },
          { key: 'evento', label: 'Evento' }, { key: 'pagina', label: 'Página' },
          { key: 'rota', label: 'Rota' }, { key: 'cidade', label: 'Cidade' }, { key: 'regiao', label: 'UF/Região' },
        ],
        data: visitasFmt(),
      })
    }
    exportSheetsToXLSX(sheets, `analise-acessos_${sufixo}`)
    setExportando(false)
    setExpOpen(false)
  }
  function csvVisitas() {
    exportToCSV(visitasFmt(), [
      { key: 'criado_em', label: 'Data/hora', format: (v) => fmtDataHora(String(v ?? '')) },
      { key: 'evento', label: 'Evento' }, { key: 'pagina', label: 'Página' },
      { key: 'rota', label: 'Rota' }, { key: 'cidade', label: 'Cidade' }, { key: 'regiao', label: 'UF/Região' },
    ], `linha-do-tempo_${sufixo}`)
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
          <h2 className="font-heading font-bold text-[16px]">
            {usuario !== 'todos' ? nomeUsuario : 'Quem acessa & o que é mais acessado'}
          </h2>
          <p className="text-[11.5px] text-muted">
            {usuario !== 'todos' ? (
              <>
                <span className="font-mono-custom">{usuario}</span>
                {' · '}
                <button onClick={() => setUsuario('todos')} className="text-accent hover:underline">ver todos</button>
              </>
            ) : 'Análise de acessos'}
            {uf !== 'todos' ? ` · estado ${uf}` : usuario === 'todos' ? ' · todos os estados' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={usuario} onChange={(e) => setUsuario(e.target.value)} title="Filtrar por usuário"
            className="text-[12px] bg-bg2 border border-subtle rounded-lg px-2.5 py-2 focus:border-accent outline-none max-w-[230px]">
            <option value="todos">Todos os usuários</option>
            {escolhidoSumiu && <option value={usuario}>{nomeUsuario} — sem acesso no período</option>}
            {listaUsuarios.map((u) => (
              <option key={u.email} value={u.email}>{u.nome || u.email} ({u.n})</option>
            ))}
          </select>
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
                {usuario !== 'todos' && (
                  <button onClick={csvVisitas} disabled={!d?.visitas?.length} className="flex items-center gap-2.5 w-full px-3 py-2 text-[12px] text-muted hover:bg-bg3 hover:text-strong transition-colors text-left disabled:opacity-40">
                    <FileText size={13} /> CSV — Linha do tempo
                  </button>
                )}
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

          {filtrando && (
            <div className="flex items-center gap-2 flex-wrap text-[11.5px] mb-3 px-3 py-2 rounded-lg bg-accent/10 border border-accent/20">
              <Filter size={12} className="text-accent flex-shrink-0" />
              <span className="text-strong">
                Tudo nesta seção é só de <strong className="font-semibold">{nomeUsuario}</strong> — últimos {dias} dias
                {uf !== 'todos' ? `, estado ${uf}` : ''}.
              </span>
              <span className="text-muted">
                A única exceção é o card <em>Todos os usuários</em>, que segue inteiro para você poder trocar de pessoa.
              </span>
              <button onClick={() => setUsuario('todos')} className="ml-auto text-accent hover:underline font-medium">
                remover filtro
              </button>
            </div>
          )}

          {/* Linha do tempo do usuário escolhido — a resposta ao "quando". */}
          {usuario !== 'todos' && (
            <div className="bg-bg2 border border-subtle rounded-xl p-4 mb-3">
              <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
                <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">
                  Linha do tempo — o que {nomeUsuario} abriu e quando
                </div>
                {d.resumo && (
                  <div className="text-[11px] text-muted font-mono-custom">
                    {d.resumo.diasAtivos} dia(s) com acesso · último em {fmtDataHora(d.resumo.ultimo)}
                  </div>
                )}
              </div>
              {d.visitas.length === 0 ? (
                <Vazio texto={`Nenhum acesso de ${nomeUsuario} ${uf !== 'todos' ? `no estado ${uf} ` : ''}nos últimos ${dias} dias.`} />
              ) : (
                <>
                  <LinhaDoTempo visitas={d.visitas} />
                  {d.resumo && d.resumo.total > d.visitas.length && (
                    <div className="text-[11px] text-faint mt-3 pt-3 border-t border-subtle">
                      Mostrando os {d.visitas.length} mais recentes de {d.resumo.total.toLocaleString('pt-BR')}.
                      O histórico completo do período sai no Excel e na aba Acessos.
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Série temporal */}
            <Card title={de('Acessos por dia', 'Acessos por dia — {}')} span2>
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
            <Card title={de('Acessos por estado (clique para filtrar)', 'De onde {} acessa (clique para filtrar)')}>
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

            {/* Quem mais acessa — o ÚNICO card que segue mostrando todo mundo,
                porque é por ele que se troca de usuário. Precisa gritar isso. */}
            <Card title={de('Quem mais acessa (clique para filtrar)', 'Todos os usuários — clique para trocar de pessoa')}>
              {d.topUsuarios.length === 0 ? <Vazio /> : (
                <BarList itens={d.topUsuarios.map((u) => ({
                  label: u.nome || u.email || '—',
                  sub: u.nome ? u.email ?? undefined : undefined,
                  n: u.n,
                  ativo: !!u.email && u.email === usuario,
                  // Com alguém selecionado, os demais recuam para o segundo plano.
                  atenuado: filtrando && u.email !== usuario,
                  // Clicar de novo em quem já está filtrado volta para todos.
                  onClick: u.email ? () => setUsuario((a) => (a === u.email ? 'todos' : u.email as string)) : undefined,
                }))} />
              )}
            </Card>

            {/* O que é mais acessado */}
            <Card title={de('O que é mais acessado', 'O que {} mais acessa')}>
              {d.topRotas.length === 0 ? (
                <Vazio texto="O rastreamento de páginas começou agora — os dados aparecem conforme o uso." />
              ) : (
                <BarList itens={d.topRotas.map((r) => ({ label: rotulo(r.rota), sub: subRota(r.rota), n: r.n }))} cor="#16a34a" />
              )}
            </Card>

            {/* Cidades */}
            <Card title={de('Principais cidades', 'Cidades de onde {} acessa')}>
              {d.topCidades.length === 0 ? <Vazio texto="Sem cidades identificadas ainda." /> : (
                <BarList itens={d.topCidades.map((c) => ({ label: c.cidade, n: c.n }))} cor="#0891b2" />
              )}
            </Card>

            {/* Horário do dia — responde "quando" em forma de gráfico, não de tabela. */}
            <Card title={de('Horários de acesso (Brasília)', 'Horários em que {} usa o sistema')}>
              {d.porHora.every((h) => h.n === 0) ? <Vazio /> : (
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={d.porHora} margin={{ top: 6, right: 6, left: -14, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.06)" vertical={false} />
                    <XAxis dataKey="hora" tickFormatter={(h) => `${h}h`} tick={{ fontSize: 10, fill: '#94a3b8' }}
                      axisLine={false} tickLine={false} interval={2} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} width={34} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} cursor={{ fill: 'rgba(47,128,237,0.06)' }}
                      labelFormatter={(h) => `${h}h às ${Number(h) + 1}h`} />
                    <Bar dataKey="n" name="acessos" fill="#7c3aed" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            {/* Dispositivos */}
            <Card title={de('Dispositivos', 'Dispositivos de {}')}>
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

interface BarItem { label: string; sub?: string; n: number; ativo?: boolean; atenuado?: boolean; onClick?: () => void }

function BarList({ itens, cor = accent }: { itens: BarItem[]; cor?: string }) {
  const max = Math.max(1, ...itens.map((i) => i.n))
  return (
    <div className="space-y-2">
      {itens.map((it, idx) => {
        const conteudo = (
          <div className={clsx(it.atenuado && 'opacity-40')}>
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <span className={clsx('truncate', it.ativo ? 'text-accent font-semibold' : 'text-strong')}>
                {it.label}{it.sub && <span className="text-faint font-mono-custom text-[10.5px] ml-1.5">{it.sub}</span>}
              </span>
              <span className="font-mono-custom text-muted flex-shrink-0">{it.n}</span>
            </div>
            <div className="h-1.5 bg-bg4 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(it.n / max) * 100}%`, background: it.ativo ? '#1f6fd6' : cor }} />
            </div>
          </div>
        )
        // Sem onClick continua sendo texto: virar botão sempre daria foco de
        // teclado a uma lista que não faz nada quando acionada.
        return it.onClick ? (
          <button key={idx} onClick={it.onClick} type="button"
            className="text-[12px] w-full text-left rounded-md px-1 -mx-1 py-0.5 hover:bg-bg3 focus:outline-none focus:ring-2 focus:ring-accent/50 transition-colors">
            {conteudo}
          </button>
        ) : (
          <div key={idx} className="text-[12px]">{conteudo}</div>
        )
      })}
    </div>
  )
}

const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
// Data construída campo a campo: `new Date('2026-08-30')` é lido como UTC e o
// getDay() do navegador devolveria o dia da semana errado a oeste de Greenwich.
const diaLongo = (iso: string) => {
  const [a, m, d] = iso.split('-').map(Number)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')} · ${SEMANA[new Date(a, m - 1, d).getDay()]}`
}

function LinhaDoTempo({ visitas }: { visitas: Analise['visitas'] }) {
  // Já vêm do banco em ordem decrescente; o Map preserva a ordem de inserção.
  const porDia = new Map<string, Analise['visitas']>()
  for (const v of visitas) {
    const dia = v.criado_em.slice(0, 10)
    const lista = porDia.get(dia)
    if (lista) lista.push(v); else porDia.set(dia, [v])
  }
  return (
    <div className="max-h-[420px] overflow-y-auto pr-1 space-y-3">
      {[...porDia.entries()].map(([dia, itens]) => (
        <div key={dia}>
          <div className="flex items-baseline justify-between gap-2 mb-1.5 sticky top-0 bg-bg2 py-1">
            <span className="text-[11.5px] font-semibold text-strong">{diaLongo(dia)}</span>
            <span className="text-[10.5px] font-mono-custom text-faint">{itens.length} acesso(s)</span>
          </div>
          <div className="border-l border-subtle pl-3 space-y-1">
            {itens.map((v, i) => (
              <div key={i} className="flex items-baseline gap-2.5 text-[12px]">
                <span className="font-mono-custom text-faint flex-shrink-0 w-[38px]">{v.criado_em.slice(11)}</span>
                {v.evento === 'login' ? (
                  <span className="text-accent font-medium">Entrou no sistema</span>
                ) : (
                  <span className="text-strong truncate">
                    {v.rota ? rotulo(v.rota) : 'página não identificada'}
                    {v.rota && subRota(v.rota) && <span className="text-faint font-mono-custom text-[10.5px] ml-1.5">{v.rota}</span>}
                  </span>
                )}
                {v.cidade && v.cidade !== 'local/dev' && (
                  <span className="text-faint text-[10.5px] ml-auto flex-shrink-0 truncate max-w-[120px]">{v.cidade}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
