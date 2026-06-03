'use client'
// src/app/crm/page.tsx — Pipeline CRM (Kanban)

import React, { useState, useEffect, useRef, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import { clsx } from 'clsx'
import {
  Plus, Trash2, Edit2, X, TrendingUp, DollarSign, CheckCircle2,
  Percent, Clock, ChevronRight, GripVertical, ExternalLink, Save,
} from 'lucide-react'
import { ExportButton } from '@/components/ui/ExportButton'
import {
  STAGES, getDeals, createDeal, updateDeal, deleteDeal, calcularCRMStats, diasNoStage,
  type PipelineDeal, type PipelineStage, type CRMStats,
} from '@/lib/crm'
import { CATEGORIA_COLOR } from '@/lib/categorias'
import { formatBRL } from '@/lib/format'

// ── Helpers ───────────────────────────────────────────────────────────────────

const DIAS_ALERTA = 14   // card fica em destaque se parado > N dias

// ── Deal Card ─────────────────────────────────────────────────────────────────

function DealCard({
  deal,
  draggingId,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  deal: PipelineDeal
  draggingId: string | null
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onClick: (deal: PipelineDeal) => void
}) {
  const dias = diasNoStage(deal)
  const stalled = dias >= DIAS_ALERTA && deal.stage !== 'ganho' && deal.stage !== 'perdido'

  return (
    <div
      draggable
      onDragStart={() => onDragStart(deal.id)}
      onDragEnd={onDragEnd}
      onClick={() => onClick(deal)}
      className={clsx(
        'bg-bg3 border rounded-xl p-3 cursor-pointer select-none transition-all group',
        draggingId === deal.id
          ? 'opacity-40 scale-95 border-accent'
          : stalled
          ? 'border-amber/40 hover:border-amber/60'
          : 'border-subtle2 hover:border-accent/50',
      )}
    >
      {/* Hospital */}
      <div className="flex items-start gap-1.5 mb-1">
        <GripVertical size={12} className="text-faint mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-strong truncate leading-tight">{deal.hospital}</div>
          <div className="text-[10px] font-mono-custom text-faint">{deal.municipio} / {deal.uf}</div>
        </div>
      </div>

      {/* Description */}
      <p className="text-[11px] text-muted leading-snug line-clamp-2 mb-2 pl-[17px]">{deal.descricao}</p>

      {/* Footer */}
      <div className="flex items-center justify-between pl-[17px]">
        <div className="flex items-center gap-1.5">
          <span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase', CATEGORIA_COLOR[deal.categoria] ?? CATEGORIA_COLOR.outros)}>
            {deal.categoria}
          </span>
          {stalled && (
            <span className="text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full bg-amber/15 text-amber border border-amber/30 flex items-center gap-0.5">
              <Clock size={8} />
              {dias}d
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-mono-custom font-bold text-accent">{formatBRL(deal.valorEstimado)}</span>
          <ScoreBadge score={deal.score} status={deal.score >= 75 ? 'quente' : deal.score >= 50 ? 'morno' : 'frio'} size="sm" />
        </div>
      </div>

      {/* Responsável */}
      {deal.responsavel && (
        <div className="mt-2 pt-1.5 border-t border-subtle/50 text-[9px] font-mono-custom text-faint pl-[17px]">
          {deal.responsavel}
          {deal.prazo && ` · prazo ${new Date(deal.prazo).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`}
        </div>
      )}
    </div>
  )
}

// ── Kanban Column ─────────────────────────────────────────────────────────────

function KanbanColumn({
  stage,
  deals,
  draggingId,
  dragOverStage,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onCardClick,
  onAddClick,
}: {
  stage: (typeof STAGES)[number]
  deals: PipelineDeal[]
  draggingId: string | null
  dragOverStage: PipelineStage | null
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDragOver: (s: PipelineStage) => void
  onDragLeave: () => void
  onDrop: (s: PipelineStage) => void
  onCardClick: (deal: PipelineDeal) => void
  onAddClick: (s: PipelineStage) => void
}) {
  const total = deals.reduce((s, d) => s + d.valorEstimado, 0)
  const isOver = dragOverStage === stage.id && draggingId !== null

  return (
    <div className={clsx(
      'w-[256px] flex-shrink-0 flex flex-col rounded-xl border border-t-2 transition-colors',
      isOver ? `bg-bg3 ${stage.dropClass}` : 'bg-bg2 border-subtle',
      stage.borderClass,
    )}>
      {/* Column header */}
      <div className="px-3 py-2.5 border-b border-subtle flex-shrink-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className={clsx('text-[10px] font-mono-custom font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide', stage.colorClass)}>
            {stage.label}
          </span>
          <span className="text-[11px] font-mono-custom font-bold text-faint">
            {deals.length}
          </span>
        </div>
        {total > 0 && (
          <div className="text-[10px] font-mono-custom text-faint">{formatBRL(total)}</div>
        )}
      </div>

      {/* Drop zone */}
      <div
        className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px]"
        onDragOver={(e) => { e.preventDefault(); onDragOver(stage.id) }}
        onDragLeave={onDragLeave}
        onDrop={(e) => { e.preventDefault(); onDrop(stage.id) }}
      >
        {deals.map((deal) => (
          <DealCard
            key={deal.id}
            deal={deal}
            draggingId={draggingId}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onClick={onCardClick}
          />
        ))}
        {deals.length === 0 && !isOver && (
          <div className="h-16 flex items-center justify-center">
            <span className="text-[11px] text-faint">Vazio</span>
          </div>
        )}
        {isOver && (
          <div className={clsx('h-16 border-2 border-dashed rounded-xl flex items-center justify-center', stage.dropClass)}>
            <span className="text-[11px] text-faint">Soltar aqui</span>
          </div>
        )}
      </div>

      {/* Add button */}
      <div className="p-2 border-t border-subtle flex-shrink-0">
        <button
          onClick={() => onAddClick(stage.id)}
          className="w-full flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-mono-custom text-faint hover:text-strong hover:bg-bg4 transition-colors"
        >
          <Plus size={12} />
          Adicionar
        </button>
      </div>
    </div>
  )
}

// ── Deal Modal (create / edit) ────────────────────────────────────────────────

const EMPTY_FORM: Omit<PipelineDeal, 'id' | 'createdAt' | 'updatedAt' | 'movedAt'> = {
  titulo: '',
  hospital: '',
  municipio: '',
  uf: '',
  descricao: '',
  valorEstimado: 0,
  score: 60,
  categoria: 'outros',
  stage: 'prospeccao',
  responsavel: '',
  contato: '',
  contatoEmail: '',
  contatoTelefone: '',
  prazo: '',
  probabilidade: 50,
  notas: '',
  licitacaoLink: '',
}

const CATEGORIAS = ['imagem', 'uti', 'laboratorio', 'cirurgia', 'oncologia', 'outros']
const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']

function DealModal({
  deal,
  defaultStage,
  onSave,
  onDelete,
  onClose,
}: {
  deal: PipelineDeal | null
  defaultStage: PipelineStage
  onSave: (data: Omit<PipelineDeal, 'id' | 'createdAt' | 'updatedAt' | 'movedAt'>) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<Omit<PipelineDeal, 'id' | 'createdAt' | 'updatedAt' | 'movedAt'>>(
    deal
      ? { ...deal }
      : { ...EMPTY_FORM, stage: defaultStage }
  )
  const [confirmDelete, setConfirmDelete] = useState(false)

  const set = <K extends keyof typeof form>(key: K, value: typeof form[K]) =>
    setForm((p) => ({ ...p, [key]: value }))

  const handleSave = () => {
    if (!form.hospital.trim()) return
    onSave(form)
  }

  const inputCls = 'w-full bg-bg3 border border-subtle2 rounded-lg px-3 py-2 text-[12px] text-strong placeholder:text-faint outline-none focus:border-accent/60 transition-colors'
  const labelCls = 'block text-[9px] font-mono-custom text-faint uppercase tracking-wider mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[520px] h-full bg-bg2 border-l border-subtle overflow-y-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-subtle flex-shrink-0">
          <div>
            <div className="text-[14px] font-semibold text-strong">
              {deal ? 'Editar deal' : 'Novo deal'}
            </div>
            <div className="text-[10px] text-faint font-mono-custom mt-0.5">Pipeline CRM</div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-faint hover:text-strong hover:bg-bg4 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 p-5 space-y-4">

          {/* Stage */}
          <div>
            <label className={labelCls}>Estágio</label>
            <div className="flex gap-1.5 flex-wrap">
              {STAGES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => set('stage', s.id)}
                  className={clsx(
                    'text-[10px] font-mono-custom px-2.5 py-1 rounded-full border transition-all uppercase tracking-wide',
                    form.stage === s.id ? s.colorClass : 'border-subtle2 text-faint hover:text-strong'
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Hospital + Município */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Hospital / Proponente *</label>
              <input
                value={form.hospital}
                onChange={(e) => set('hospital', e.target.value)}
                placeholder="Nome do hospital ou órgão"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Município</label>
              <input
                value={form.municipio}
                onChange={(e) => set('municipio', e.target.value)}
                placeholder="Cidade"
                className={inputCls}
              />
            </div>
          </div>

          {/* UF + Categoria */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>UF</label>
              <select value={form.uf} onChange={(e) => set('uf', e.target.value)} className={inputCls}>
                <option value="">Selecione</option>
                {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Categoria</label>
              <select value={form.categoria} onChange={(e) => set('categoria', e.target.value)} className={inputCls}>
                {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Descrição */}
          <div>
            <label className={labelCls}>Descrição do equipamento</label>
            <textarea
              value={form.descricao}
              onChange={(e) => set('descricao', e.target.value)}
              rows={2}
              placeholder="Ex: Aquisição de tomógrafo 64 canais..."
              className={clsx(inputCls, 'resize-none')}
            />
          </div>

          {/* Valor + Score + Probabilidade */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Valor estimado (R$)</label>
              <input
                type="number"
                value={form.valorEstimado || ''}
                onChange={(e) => set('valorEstimado', Number(e.target.value))}
                placeholder="0"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Score (0-100)</label>
              <input
                type="number"
                min={0} max={100}
                value={form.score}
                onChange={(e) => set('score', Math.min(100, Math.max(0, Number(e.target.value))))}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Prob. fechamento %</label>
              <input
                type="number"
                min={0} max={100}
                value={form.probabilidade}
                onChange={(e) => set('probabilidade', Math.min(100, Math.max(0, Number(e.target.value))))}
                className={inputCls}
              />
            </div>
          </div>

          {/* Responsável + Prazo */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Responsável (vendedor)</label>
              <input
                value={form.responsavel ?? ''}
                onChange={(e) => set('responsavel', e.target.value)}
                placeholder="Nome do vendedor"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Prazo estimado de fechamento</label>
              <input
                type="date"
                value={form.prazo ?? ''}
                onChange={(e) => set('prazo', e.target.value)}
                className={clsx(inputCls, 'dark:[color-scheme:dark]')}
              />
            </div>
          </div>

          {/* Contato comprador */}
          <div>
            <label className={labelCls}>Contato no órgão comprador</label>
            <div className="grid grid-cols-3 gap-2">
              <input value={form.contato ?? ''} onChange={(e) => set('contato', e.target.value)} placeholder="Nome" className={inputCls} />
              <input value={form.contatoEmail ?? ''} onChange={(e) => set('contatoEmail', e.target.value)} placeholder="E-mail" className={inputCls} />
              <input value={form.contatoTelefone ?? ''} onChange={(e) => set('contatoTelefone', e.target.value)} placeholder="Telefone" className={inputCls} />
            </div>
          </div>

          {/* Link edital */}
          <div>
            <label className={labelCls}>Link do edital / PNCP</label>
            <input
              value={form.licitacaoLink ?? ''}
              onChange={(e) => set('licitacaoLink', e.target.value)}
              placeholder="https://..."
              className={inputCls}
            />
          </div>

          {/* Notas */}
          <div>
            <label className={labelCls}>Notas internas</label>
            <textarea
              value={form.notas ?? ''}
              onChange={(e) => set('notas', e.target.value)}
              rows={3}
              placeholder="Histórico de conversas, observações..."
              className={clsx(inputCls, 'resize-none')}
            />
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-5 py-4 border-t border-subtle flex items-center justify-between flex-shrink-0">
          <div>
            {deal && (
              confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-red">Confirmar exclusão?</span>
                  <button
                    onClick={() => { onDelete(deal.id); onClose() }}
                    className="text-[11px] font-mono-custom px-3 py-1 rounded-lg bg-red/20 text-red border border-red/30 hover:bg-red/30 transition-colors"
                  >
                    Excluir
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="text-[11px] font-mono-custom text-faint hover:text-strong"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1.5 text-[11px] font-mono-custom text-faint hover:text-red transition-colors"
                >
                  <Trash2 size={13} />
                  Excluir deal
                </button>
              )
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[12px] font-mono-custom text-faint hover:text-strong transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={!form.hospital.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-accent text-black text-[12px] font-mono-custom font-bold rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Save size={13} />
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CRMPage() {
  const [deals, setDeals]         = useState<PipelineDeal[]>([])
  const [stats, setStats]         = useState<CRMStats | null>(null)
  const [mounted, setMounted]     = useState(false)

  // Drag state
  const [draggingId, setDraggingId]         = useState<string | null>(null)
  const [dragOverStage, setDragOverStage]   = useState<PipelineStage | null>(null)

  // Modal state
  const [selectedDeal, setSelectedDeal]     = useState<PipelineDeal | null>(null)
  const [modalOpen, setModalOpen]           = useState(false)
  const [defaultStage, setDefaultStage]     = useState<PipelineStage>('prospeccao')

  const reload = useCallback(() => {
    const d = getDeals()
    setDeals(d)
    setStats(calcularCRMStats(d))
  }, [])

  useEffect(() => {
    reload()
    setMounted(true)
  }, [reload])

  // ── Drag handlers ──────────────────────────────────────────────────────────

  const handleDragStart = (id: string) => setDraggingId(id)
  const handleDragEnd   = () => { setDraggingId(null); setDragOverStage(null) }

  const handleDrop = (targetStage: PipelineStage) => {
    if (!draggingId) return
    const deal = deals.find((d) => d.id === draggingId)
    if (!deal || deal.stage === targetStage) { handleDragEnd(); return }
    updateDeal(draggingId, { stage: targetStage })
    reload()
    handleDragEnd()
  }

  // ── Modal handlers ─────────────────────────────────────────────────────────

  const openNew = (stage: PipelineStage) => {
    setSelectedDeal(null)
    setDefaultStage(stage)
    setModalOpen(true)
  }

  const openEdit = (deal: PipelineDeal) => {
    setSelectedDeal(deal)
    setDefaultStage(deal.stage)
    setModalOpen(true)
  }

  const handleSave = (data: Omit<PipelineDeal, 'id' | 'createdAt' | 'updatedAt' | 'movedAt'>) => {
    if (selectedDeal) {
      updateDeal(selectedDeal.id, data)
    } else {
      createDeal(data)
    }
    reload()
    setModalOpen(false)
  }

  const handleDelete = (id: string) => {
    deleteDeal(id)
    reload()
  }

  // ── Group deals by stage ───────────────────────────────────────────────────

  const byStage = Object.fromEntries(
    STAGES.map((s) => [s.id, deals.filter((d) => d.stage === s.id)])
  ) as Record<PipelineStage, PipelineDeal[]>

  if (!mounted) {
    return (
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <Topbar title="Pipeline CRM" />
          <main className="flex-1 flex items-center justify-center bg-bg">
            <span className="text-faint text-[13px]">Carregando…</span>
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar
          title="Pipeline CRM"
          subtitle={`${deals.length} deals · ${formatBRL(stats?.valorTotal ?? 0)} em pipeline`}
        />

        <main className="flex-1 overflow-hidden bg-bg flex flex-col">

          {/* ── Toolbar ────────────────────────────────────────────────────── */}
          <div className="flex items-center justify-end gap-2 px-4 pt-3 flex-shrink-0">
            <ExportButton
              data={deals}
              filename="crm-pipeline"
              title="Pipeline CRM — GovHealth AI"
              columns={[
                { key: 'hospital', label: 'Hospital / Proponente' },
                { key: 'municipio', label: 'Município' },
                { key: 'uf', label: 'UF' },
                { key: 'categoria', label: 'Categoria' },
                { key: 'stage', label: 'Estágio' },
                { key: 'score', label: 'Score' },
                { key: 'valorEstimado', label: 'Valor', format: (v) => `R$ ${Number(v).toLocaleString('pt-BR')}` },
                { key: 'descricao', label: 'Descrição' },
                { key: 'contato', label: 'Contato' },
                { key: 'createdAt', label: 'Criado em' },
              ]}
            />
          </div>

          {/* ── KPI strip ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-5 gap-3 p-4 pb-0 flex-shrink-0">
            {[
              {
                label: 'Total pipeline',
                value: formatBRL(stats?.valorTotal ?? 0),
                sub: `${stats?.total ?? 0} deals`,
                icon: DollarSign,
                color: 'text-strong',
              },
              {
                label: 'Ganhos',
                value: formatBRL(stats?.valorGanho ?? 0),
                sub: `${stats?.ganhos ?? 0} fechados`,
                icon: CheckCircle2,
                color: 'text-emerald-400',
              },
              {
                label: 'Taxa conversão',
                value: `${stats?.taxaConversao ?? 0}%`,
                sub: `${stats?.perdidos ?? 0} perdidos`,
                icon: Percent,
                color: stats && stats.taxaConversao >= 50 ? 'text-emerald-400' : 'text-amber',
              },
              {
                label: 'Proposta + Negociação',
                value: String(
                  (stats?.porStage.proposta.count ?? 0) +
                  (stats?.porStage.negociacao.count ?? 0)
                ),
                sub: 'deals ativos',
                icon: TrendingUp,
                color: 'text-accent',
              },
              {
                label: 'Score médio',
                value: deals.length
                  ? String(Math.round(deals.reduce((s, d) => s + d.score, 0) / deals.length))
                  : '—',
                sub: 'dos deals',
                icon: ChevronRight,
                color: 'text-strong',
              },
            ].map(({ label, value, sub, icon: Icon, color }) => (
              <div key={label} className="bg-bg2 border border-subtle rounded-xl px-4 py-3 flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-bg4 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon size={14} className="text-faint" />
                </div>
                <div>
                  <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">{label}</div>
                  <div className={clsx('text-[18px] font-mono-custom font-bold leading-tight mt-0.5', color)}>{value}</div>
                  <div className="text-[10px] text-faint font-mono-custom mt-0.5">{sub}</div>
                </div>
              </div>
            ))}
          </div>

          {/* ── Kanban board ───────────────────────────────────────────────── */}
          <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
            <div className="flex gap-3 h-full">
              {STAGES.map((stage) => (
                <KanbanColumn
                  key={stage.id}
                  stage={stage}
                  deals={byStage[stage.id]}
                  draggingId={draggingId}
                  dragOverStage={dragOverStage}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragOver={setDragOverStage}
                  onDragLeave={() => setDragOverStage(null)}
                  onDrop={handleDrop}
                  onCardClick={openEdit}
                  onAddClick={openNew}
                />
              ))}
            </div>
          </div>
        </main>
      </div>

      {/* ── Deal modal ──────────────────────────────────────────────────────── */}
      {modalOpen && (
        <DealModal
          deal={selectedDeal}
          defaultStage={defaultStage}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  )
}
