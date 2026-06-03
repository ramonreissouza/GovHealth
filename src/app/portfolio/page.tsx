'use client'
// src/app/portfolio/page.tsx — Meu Portfólio (catálogo de produtos do fornecedor)

import React, { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import {
  Plus, Trash2, Edit2, X, Save, Search, Loader2, Boxes, Tag, Package,
  CheckCircle2, Circle, Link2, ShieldCheck,
} from 'lucide-react'
import {
  getProdutos, createProduto, updateProduto, deleteProduto, toggleAtivo,
  calcularPortfolioStats,
  type ProdutoPortfolio, type ProdutoInput, type CatmatVinculo,
} from '@/lib/portfolio'
import type { CategoriaEquipamento, TipoFornecimento, CatmatMaterial } from '@/lib/types'
import { CATEGORIA_META, CATEGORIA_COLOR, TIPO_LABEL } from '@/lib/categorias'

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORIAS = Object.keys(CATEGORIA_META) as CategoriaEquipamento[]
const TIPOS = Object.keys(TIPO_LABEL) as TipoFornecimento[]

const EMPTY_FORM: ProdutoInput = {
  nome: '',
  marca: '',
  modelo: '',
  categoria: 'imagem',
  tipoFornecimento: 'equipamento',
  catmats: [],
  palavrasChave: [],
  registroAnvisa: '',
  validadeAnvisa: '',
  ativo: true,
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const [mounted, setMounted] = useState(false)
  const [produtos, setProdutos] = useState<ProdutoPortfolio[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  const refresh = useCallback(() => setProdutos(getProdutos()), [])

  useEffect(() => {
    refresh()
    setMounted(true)
  }, [refresh])

  const stats = calcularPortfolioStats(produtos)

  function openNovo() {
    setEditId(null)
    setModalOpen(true)
  }

  function openEdit(id: string) {
    setEditId(id)
    setModalOpen(true)
  }

  function handleDelete(id: string) {
    if (!confirm('Remover este produto do portfólio?')) return
    deleteProduto(id)
    refresh()
  }

  function handleToggle(id: string) {
    toggleAtivo(id)
    refresh()
  }

  const editing = editId ? produtos.find((p) => p.id === editId) ?? null : null

  if (!mounted) {
    return (
      <div className="flex h-screen bg-bg">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar title="Meu Portfólio" />
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={22} className="animate-spin text-faint" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar title="Meu Portfólio" subtitle={`${stats.ativos} produto${stats.ativos !== 1 ? 's' : ''} ativo${stats.ativos !== 1 ? 's' : ''}`} />
        <div className="flex-1 overflow-y-auto p-6">

          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div className="max-w-[560px]">
              <h1 className="font-heading font-bold text-[22px] text-strong leading-none">Meu Portfólio</h1>
              <p className="text-[13px] text-muted mt-1.5">
                Cadastre os produtos que sua empresa vende. A plataforma casa cada produto a códigos
                CATMAT e palavras-chave para filtrar as oportunidades pelo que você realmente comercializa.
              </p>
            </div>
            <button
              onClick={openNovo}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-black text-[13px] font-semibold hover:bg-accent/90 transition-colors flex-shrink-0"
            >
              <Plus size={14} />
              Adicionar produto
            </button>
          </div>

          {/* Stats strip */}
          <div className="grid grid-cols-4 gap-3 mb-6 max-w-[760px]">
            {[
              { label: 'Produtos', value: stats.total, icon: Package },
              { label: 'Ativos', value: stats.ativos, icon: CheckCircle2 },
              { label: 'Categorias', value: stats.categorias, icon: Tag },
              { label: 'CATMAT vinculados', value: stats.catmatsVinculados, icon: Link2 },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="bg-bg2 border border-subtle rounded-xl px-4 py-3">
                <div className="flex items-center gap-1.5 text-[10px] font-mono-custom text-faint uppercase tracking-wider">
                  <Icon size={11} /> {label}
                </div>
                <div className="text-[22px] font-mono-custom font-bold text-strong mt-1 leading-none">{value}</div>
              </div>
            ))}
          </div>

          {/* Empty state */}
          {produtos.length === 0 ? (
            <div className="bg-bg2 border border-dashed border-subtle2 rounded-xl py-16 flex flex-col items-center text-center max-w-[760px]">
              <Boxes size={34} className="text-faint mb-3" />
              <h3 className="text-[15px] font-semibold text-strong">Seu portfólio está vazio</h3>
              <p className="text-[13px] text-muted mt-1 mb-5 max-w-[380px]">
                Adicione seu primeiro produto para personalizar as oportunidades e ativar o filtro
                &quot;Meu Portfólio&quot; nas licitações.
              </p>
              <button
                onClick={openNovo}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-black text-[13px] font-semibold hover:bg-accent/90 transition-colors"
              >
                <Plus size={14} /> Adicionar produto
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 max-w-[980px]">
              {produtos.map((p) => (
                <ProdutoCard
                  key={p.id}
                  produto={p}
                  onEdit={() => openEdit(p.id)}
                  onDelete={() => handleDelete(p.id)}
                  onToggle={() => handleToggle(p.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {modalOpen && (
        <ProdutoModal
          produto={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); refresh() }}
        />
      )}
    </div>
  )
}

// ── Product card ─────────────────────────────────────────────────────────────

function ProdutoCard({
  produto, onEdit, onDelete, onToggle,
}: {
  produto: ProdutoPortfolio
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
}) {
  const p = produto
  return (
    <div className={clsx(
      'bg-bg2 border rounded-xl p-4 transition-all',
      p.ativo ? 'border-subtle' : 'border-subtle2 opacity-60',
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full', CATEGORIA_COLOR[p.categoria] ?? 'bg-bg4 text-faint')}>
              {CATEGORIA_META[p.categoria]?.label ?? p.categoria}
            </span>
            <span className="text-[9px] font-mono-custom text-faint">{TIPO_LABEL[p.tipoFornecimento] ?? p.tipoFornecimento}</span>
          </div>
          <h3 className="text-[14px] font-semibold text-strong mt-1.5 truncate">{p.nome || 'Sem nome'}</h3>
          {(p.marca || p.modelo) && (
            <p className="text-[11px] text-faint font-mono-custom truncate">
              {[p.marca, p.modelo].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onToggle} title={p.ativo ? 'Ativo — clique para desativar' : 'Inativo — clique para ativar'}
            className="p-1.5 rounded hover:bg-bg3 text-faint hover:text-strong transition-colors">
            {p.ativo ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Circle size={14} />}
          </button>
          <button onClick={onEdit} title="Editar" className="p-1.5 rounded hover:bg-bg3 text-faint hover:text-strong transition-colors">
            <Edit2 size={13} />
          </button>
          <button onClick={onDelete} title="Remover" className="p-1.5 rounded hover:bg-bg3 text-faint hover:text-red-400 transition-colors">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {p.palavrasChave.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {p.palavrasChave.map((t) => (
            <span key={t} className="text-[10px] font-mono-custom bg-bg3 border border-subtle text-muted px-2 py-0.5 rounded-full">{t}</span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-subtle text-[10px] font-mono-custom text-faint">
        <span className="flex items-center gap-1"><Link2 size={11} /> {p.catmats.length} CATMAT</span>
        {p.registroAnvisa && (
          <span className="flex items-center gap-1 text-brand-blue"><ShieldCheck size={11} /> ANVISA {p.registroAnvisa}</span>
        )}
      </div>
    </div>
  )
}

// ── Create / edit modal ────────────────────────────────────────────────────────

function ProdutoModal({
  produto, onClose, onSaved,
}: {
  produto: ProdutoPortfolio | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<ProdutoInput>(
    produto
      ? { ...EMPTY_FORM, ...produto }
      : EMPTY_FORM
  )
  const [kwInput, setKwInput] = useState('')

  // CATMAT search state
  const [catmatQuery, setCatmatQuery] = useState('')
  const [catmatResults, setCatmatResults] = useState<CatmatMaterial[]>([])
  const [catmatLoading, setCatmatLoading] = useState(false)
  const [catmatError, setCatmatError] = useState<string | null>(null)

  const set = <K extends keyof ProdutoInput>(k: K, v: ProdutoInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  function addKeyword() {
    const t = kwInput.trim()
    if (!t || form.palavrasChave.includes(t)) { setKwInput(''); return }
    set('palavrasChave', [...form.palavrasChave, t])
    setKwInput('')
  }

  function removeKeyword(t: string) {
    set('palavrasChave', form.palavrasChave.filter((x) => x !== t))
  }

  async function buscarCatmat() {
    const q = catmatQuery.trim()
    if (!q) return
    setCatmatLoading(true)
    setCatmatError(null)
    setCatmatResults([])
    try {
      const res = await fetch(`/api/comprasgov/catmat?descricao=${encodeURIComponent(q)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Erro')
      setCatmatResults(data.materiais ?? [])
      if ((data.materiais ?? []).length === 0) setCatmatError('Nenhum item CATMAT encontrado para este termo.')
    } catch (e) {
      setCatmatError('Não foi possível consultar o CATMAT agora (a API pública pode estar limitando o acesso). Tente novamente em instantes.')
      console.error('[portfolio/catmat]', e)
    } finally {
      setCatmatLoading(false)
    }
  }

  function addCatmat(m: CatmatMaterial) {
    if (form.catmats.some((c) => c.codigo === m.codigo)) return
    const vinculo: CatmatVinculo = { codigo: m.codigo, descricao: m.descricao, pdm: m.pdm }
    set('catmats', [...form.catmats, vinculo])
  }

  function removeCatmat(codigo: string) {
    set('catmats', form.catmats.filter((c) => c.codigo !== codigo))
  }

  function handleSave() {
    if (!form.nome.trim()) { alert('Informe o nome do produto.'); return }
    if (produto) updateProduto(produto.id, form)
    else createProduto(form)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-[300] flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Slide-over */}
      <div className="relative w-full max-w-[520px] bg-bg2 border-l border-subtle h-full overflow-y-auto">
        <div className="sticky top-0 bg-bg2 border-b border-subtle px-5 py-4 flex items-center justify-between z-10">
          <h2 className="text-[15px] font-semibold text-strong">
            {produto ? 'Editar produto' : 'Novo produto'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-bg3 text-faint hover:text-strong transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Nome */}
          <div>
            <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">Nome do produto *</label>
            <input
              value={form.nome}
              onChange={(e) => set('nome', e.target.value)}
              placeholder="Ex: Ventilador Pulmonar de UTI"
              className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent"
            />
          </div>

          {/* Marca / Modelo */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">Marca</label>
              <input value={form.marca ?? ''} onChange={(e) => set('marca', e.target.value)} placeholder="Ex: Mindray"
                className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">Modelo</label>
              <input value={form.modelo ?? ''} onChange={(e) => set('modelo', e.target.value)} placeholder="Ex: SV-300"
                className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent" />
            </div>
          </div>

          {/* Categoria / Tipo */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">Categoria</label>
              <select value={form.categoria} onChange={(e) => set('categoria', e.target.value as CategoriaEquipamento)}
                className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong focus:outline-none focus:border-accent">
                {CATEGORIAS.map((c) => <option key={c} value={c}>{CATEGORIA_META[c].label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">Tipo de fornecimento</label>
              <select value={form.tipoFornecimento} onChange={(e) => set('tipoFornecimento', e.target.value as TipoFornecimento)}
                className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong focus:outline-none focus:border-accent">
                {TIPOS.map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
              </select>
            </div>
          </div>

          {/* Palavras-chave */}
          <div>
            <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">
              Palavras-chave <span className="text-faint/70 normal-case">(dirigem o matching das oportunidades)</span>
            </label>
            <div className="flex gap-2 mb-2">
              <input
                value={kwInput}
                onChange={(e) => setKwInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
                placeholder="Ex: ventilador pulmonar — Enter para adicionar"
                className="flex-1 bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent"
              />
              <button onClick={addKeyword} disabled={!kwInput.trim()}
                className="px-3 py-2 rounded-lg bg-bg4 border border-subtle text-[12px] text-strong hover:border-accent transition-colors disabled:opacity-50">
                Adicionar
              </button>
            </div>
            {form.palavrasChave.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {form.palavrasChave.map((t) => (
                  <span key={t} className="flex items-center gap-1 bg-accent/10 border border-accent/20 text-accent text-[11px] font-mono-custom px-2.5 py-1 rounded-full">
                    {t}
                    <button onClick={() => removeKeyword(t)} className="text-accent/60 hover:text-accent"><X size={10} /></button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Vínculo CATMAT */}
          <div className="border-t border-subtle pt-4">
            <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">
              Vincular códigos CATMAT <span className="text-faint/70 normal-case">(catálogo Compras.gov)</span>
            </label>

            {/* selecionados */}
            {form.catmats.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {form.catmats.map((c) => (
                  <div key={c.codigo} className="flex items-start gap-2 bg-bg3 border border-subtle rounded-lg px-3 py-2">
                    <span className="text-[11px] font-mono-custom font-bold text-accent flex-shrink-0">{c.codigo}</span>
                    <span className="text-[11px] text-muted flex-1 leading-snug">{c.descricao}</span>
                    <button onClick={() => removeCatmat(c.codigo)} className="text-faint hover:text-red-400 flex-shrink-0"><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}

            {/* busca */}
            <div className="flex gap-2">
              <input
                value={catmatQuery}
                onChange={(e) => setCatmatQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), buscarCatmat())}
                placeholder="Buscar no catálogo: ex. ventilador, ultrassom…"
                className="flex-1 bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent"
              />
              <button onClick={buscarCatmat} disabled={catmatLoading || !catmatQuery.trim()}
                className="px-3 py-2 rounded-lg bg-bg4 border border-subtle text-[12px] text-strong hover:border-accent transition-colors disabled:opacity-50 flex items-center gap-1.5">
                {catmatLoading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                Buscar
              </button>
            </div>

            {catmatError && <p className="text-[11px] text-amber mt-2">{catmatError}</p>}

            {catmatResults.length > 0 && (
              <div className="mt-2 max-h-[220px] overflow-y-auto space-y-1 border border-subtle rounded-lg p-1.5 bg-bg">
                {catmatResults.map((m) => {
                  const added = form.catmats.some((c) => c.codigo === m.codigo)
                  return (
                    <button
                      key={m.codigo}
                      onClick={() => addCatmat(m)}
                      disabled={added}
                      className={clsx(
                        'w-full flex items-start gap-2 text-left px-2.5 py-2 rounded-md transition-colors',
                        added ? 'opacity-40 cursor-default' : 'hover:bg-bg3'
                      )}
                    >
                      <span className="text-[11px] font-mono-custom font-bold text-accent flex-shrink-0">{m.codigo}</span>
                      <span className="text-[11px] text-muted flex-1 leading-snug">{m.descricao}</span>
                      {added ? <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" /> : <Plus size={13} className="text-faint flex-shrink-0" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* ANVISA (gancho C2) */}
          <div className="grid grid-cols-2 gap-3 border-t border-subtle pt-4">
            <div>
              <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">Registro ANVISA</label>
              <input value={form.registroAnvisa ?? ''} onChange={(e) => set('registroAnvisa', e.target.value)} placeholder="Opcional"
                className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">Validade ANVISA</label>
              <input type="date" value={form.validadeAnvisa ?? ''} onChange={(e) => set('validadeAnvisa', e.target.value)}
                className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong focus:outline-none focus:border-accent" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-bg2 border-t border-subtle px-5 py-3.5 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-bg3 border border-subtle text-[13px] text-muted hover:text-strong transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-black text-[13px] font-semibold hover:bg-accent/90 transition-colors">
            <Save size={13} /> {produto ? 'Salvar alterações' : 'Adicionar ao portfólio'}
          </button>
        </div>
      </div>
    </div>
  )
}
