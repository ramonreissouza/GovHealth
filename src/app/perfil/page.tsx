'use client'
// src/app/perfil/page.tsx — Perfil & Preferências

import React, { useState, useEffect } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import { Save, RotateCcw, CheckCircle2, Building2, Tag, MapPin, DollarSign, Search, X, Loader2 } from 'lucide-react'
import { getPreferences, savePreferences, resetPreferences, type UserPreferences } from '@/lib/preferences'

// ── Constants ────────────────────────────────────────────────────────────────

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']

const CATEGORIAS = [
  { key: 'imagem',      label: 'Imagem Diagnóstica',  desc: 'TC, RM, US, Raio-X, PET' },
  { key: 'uti',         label: 'UTI & Monitoração',   desc: 'Ventiladores, monitores, desfibriladores' },
  { key: 'laboratorio', label: 'Laboratório',          desc: 'Analisadores, reagentes, centrífugas' },
  { key: 'cirurgia',    label: 'Cirurgia',             desc: 'Bisturis, mesas cirúrgicas, laparoscopia' },
  { key: 'oncologia',   label: 'Oncologia',            desc: 'Aceleradores, braquiterapia, infusoras' },
  { key: 'outros',      label: 'Outros Equipamentos',  desc: 'Autoclaves, incubadoras, bombas' },
]

const SEGMENTOS = [
  'Equipamentos Médicos',
  'Equipamentos de Diagnóstico',
  'Dispositivos Implantáveis',
  'Mobiliário Hospitalar',
  'Reagentes e Consumíveis',
  'TI em Saúde',
  'Serviços Técnicos',
  'Outro',
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PerfilPage() {
  const [mounted, setMounted] = useState(false)
  const [prefs, setPrefs] = useState<UserPreferences>({
    nomeEmpresa: '',
    segmento: 'Equipamentos Médicos',
    categorias: [],
    ufs: [],
    termosBusca: [],
  })
  const [termoInput, setTermoInput] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setPrefs(getPreferences())
    setMounted(true)
  }, [])

  function toggleCategoria(key: string) {
    setPrefs((p) => ({
      ...p,
      categorias: p.categorias.includes(key)
        ? p.categorias.filter((c) => c !== key)
        : [...p.categorias, key],
    }))
  }

  function toggleUF(uf: string) {
    setPrefs((p) => ({
      ...p,
      ufs: p.ufs.includes(uf)
        ? p.ufs.filter((u) => u !== uf)
        : [...p.ufs, uf],
    }))
  }

  function addTermo() {
    const t = termoInput.trim()
    if (!t || prefs.termosBusca.includes(t)) { setTermoInput(''); return }
    setPrefs((p) => ({ ...p, termosBusca: [...p.termosBusca, t] }))
    setTermoInput('')
  }

  function removeTermo(t: string) {
    setPrefs((p) => ({ ...p, termosBusca: p.termosBusca.filter((x) => x !== t) }))
  }

  function handleSave() {
    savePreferences(prefs)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  function handleReset() {
    resetPreferences()
    setPrefs(getPreferences())
    setSaved(false)
  }

  if (!mounted) {
    return (
      <div className="flex h-screen bg-bg">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar title="Perfil" />
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
        <Topbar title="Perfil" />
        <div className="flex-1 overflow-y-auto p-6">

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="font-heading font-bold text-[22px] text-strong leading-none">Perfil & Preferências</h1>
              <p className="text-[13px] text-muted mt-1">Personalize a plataforma para o foco comercial da sua empresa.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg3 border border-subtle text-[12px] text-muted hover:text-strong transition-colors"
              >
                <RotateCcw size={12} />
                Restaurar
              </button>
              <button
                onClick={handleSave}
                className={clsx(
                  'flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-all',
                  saved
                    ? 'bg-emerald-500 text-white'
                    : 'bg-accent text-black hover:bg-accent/90'
                )}
              >
                {saved ? <CheckCircle2 size={13} /> : <Save size={13} />}
                {saved ? 'Salvo!' : 'Salvar'}
              </button>
            </div>
          </div>

          <div className="space-y-5 max-w-[760px]">

            {/* Empresa */}
            <section className="bg-bg2 border border-subtle rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Building2 size={15} className="text-faint" />
                <h2 className="text-[13px] font-semibold text-strong">Dados da Empresa</h2>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">Nome da empresa</label>
                  <input
                    value={prefs.nomeEmpresa}
                    onChange={(e) => setPrefs((p) => ({ ...p, nomeEmpresa: e.target.value }))}
                    placeholder="Ex: MedTech Equipamentos"
                    className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">Segmento</label>
                  <select
                    value={prefs.segmento}
                    onChange={(e) => setPrefs((p) => ({ ...p, segmento: e.target.value }))}
                    className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong focus:outline-none focus:border-accent"
                  >
                    {SEGMENTOS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </section>

            {/* Categorias */}
            <section className="bg-bg2 border border-subtle rounded-xl p-5">
              <div className="flex items-center gap-2 mb-1">
                <Tag size={15} className="text-faint" />
                <h2 className="text-[13px] font-semibold text-strong">Categorias de Interesse</h2>
              </div>
              <p className="text-[12px] text-faint mb-4">Selecione as categorias em que sua empresa atua. Deixe vazio para monitorar todas.</p>
              <div className="grid grid-cols-2 gap-2.5">
                {CATEGORIAS.map((c) => {
                  const active = prefs.categorias.includes(c.key)
                  return (
                    <button
                      key={c.key}
                      onClick={() => toggleCategoria(c.key)}
                      className={clsx(
                        'flex items-start gap-3 p-3 rounded-lg border text-left transition-all',
                        active
                          ? 'bg-accent/10 border-accent/40 text-strong'
                          : 'bg-bg3 border-subtle text-muted hover:border-subtle2 hover:text-strong'
                      )}
                    >
                      <div className={clsx(
                        'w-4 h-4 rounded flex-shrink-0 flex items-center justify-center mt-0.5 border text-[10px]',
                        active ? 'bg-accent border-accent text-black' : 'border-subtle'
                      )}>
                        {active && '✓'}
                      </div>
                      <div>
                        <div className="text-[12px] font-medium leading-none">{c.label}</div>
                        <div className="text-[10px] font-mono-custom text-faint mt-0.5">{c.desc}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>

            {/* UFs */}
            <section className="bg-bg2 border border-subtle rounded-xl p-5">
              <div className="flex items-center gap-2 mb-1">
                <MapPin size={15} className="text-faint" />
                <h2 className="text-[13px] font-semibold text-strong">Estados de Atuação</h2>
              </div>
              <p className="text-[12px] text-faint mb-4">Selecione os estados onde sua empresa vende. Deixe vazio para monitorar o Brasil inteiro.</p>
              <div className="flex flex-wrap gap-1.5">
                {UFS.map((uf) => (
                  <button
                    key={uf}
                    onClick={() => toggleUF(uf)}
                    className={clsx(
                      'px-2.5 py-1 rounded text-[11px] font-mono-custom font-medium transition-colors',
                      prefs.ufs.includes(uf)
                        ? 'bg-accent text-black'
                        : 'bg-bg3 border border-subtle text-faint hover:text-strong'
                    )}
                  >
                    {uf}
                  </button>
                ))}
              </div>
              {prefs.ufs.length > 0 && (
                <p className="text-[11px] text-faint font-mono-custom mt-2">
                  {prefs.ufs.length} estado{prefs.ufs.length !== 1 ? 's' : ''} selecionado{prefs.ufs.length !== 1 ? 's' : ''}
                </p>
              )}
            </section>

            {/* Faixa de valor */}
            <section className="bg-bg2 border border-subtle rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <DollarSign size={15} className="text-faint" />
                <h2 className="text-[13px] font-semibold text-strong">Faixa de Valor Alvo (R$)</h2>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">Valor mínimo</label>
                  <input
                    type="number"
                    value={prefs.valorMin ?? ''}
                    onChange={(e) => setPrefs((p) => ({ ...p, valorMin: e.target.value ? Number(e.target.value) : undefined }))}
                    placeholder="Ex: 50000"
                    className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">Valor máximo</label>
                  <input
                    type="number"
                    value={prefs.valorMax ?? ''}
                    onChange={(e) => setPrefs((p) => ({ ...p, valorMax: e.target.value ? Number(e.target.value) : undefined }))}
                    placeholder="Ex: 5000000"
                    className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent"
                  />
                </div>
              </div>
            </section>

            {/* Termos de busca */}
            <section className="bg-bg2 border border-subtle rounded-xl p-5">
              <div className="flex items-center gap-2 mb-1">
                <Search size={15} className="text-faint" />
                <h2 className="text-[13px] font-semibold text-strong">Termos de Busca Padrão</h2>
              </div>
              <p className="text-[12px] text-faint mb-4">Palavras-chave relacionadas aos seus produtos. Usadas para pré-filtrar oportunidades.</p>
              <div className="flex gap-2 mb-3">
                <input
                  value={termoInput}
                  onChange={(e) => setTermoInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addTermo()}
                  placeholder="Digite um termo e pressione Enter"
                  className="flex-1 bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent"
                />
                <button
                  onClick={addTermo}
                  disabled={!termoInput.trim()}
                  className="px-4 py-2 rounded-lg bg-accent text-black text-[12px] font-semibold hover:bg-accent/90 transition-colors disabled:opacity-50"
                >
                  Adicionar
                </button>
              </div>
              {prefs.termosBusca.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {prefs.termosBusca.map((t) => (
                    <span key={t} className="flex items-center gap-1 bg-accent/10 border border-accent/20 text-accent text-[11px] font-mono-custom px-2.5 py-1 rounded-full">
                      {t}
                      <button onClick={() => removeTermo(t)} className="text-accent/60 hover:text-accent">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </section>

          </div>
        </div>
      </div>
    </div>
  )
}
