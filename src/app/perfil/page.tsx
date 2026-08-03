'use client'
// src/app/perfil/page.tsx — Setup da Empresa (Perfil & Preferências + Meu Portfólio)
// Tela unificada: uma única fonte de verdade (lib/empresa.ts) que alimenta dashboard,
// Radar, filtro de oportunidades, ALERTAS, preços e copiloto de edital. Duas abas:
//   • Empresa   → dados/categorias/UFs/faixa de valor/termos (o antigo Perfil)
//   • Portfólio → catálogo de produtos (o antigo Meu Portfólio)

import React, { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import { Save, RotateCcw, CheckCircle2, Building2, Tag, MapPin, DollarSign, Search, X, Loader2, Boxes, Bell, Lock } from 'lucide-react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { temAcessoPro } from '@/lib/plano-gating'
import { getPreferences, savePreferences, resetPreferences, type UserPreferences } from '@/lib/preferences'
import { HYDRATED_EVENT } from '@/lib/synced'
import { markOnboarded } from '@/lib/onboarding'
import { getProdutos } from '@/lib/portfolio'
import PortfolioManager from '@/components/setup/PortfolioManager'

// ── Constants ────────────────────────────────────────────────────────────────

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']

const CATEGORIAS = [
  { key: 'imagem',      label: 'Imagem Diagnóstica',  desc: 'TC, RM, US, Raio-X, PET' },
  { key: 'uti',         label: 'UTI & Monitoração',   desc: 'Ventiladores, monitores, desfibriladores' },
  { key: 'laboratorio', label: 'Laboratório',          desc: 'Analisadores, reagentes, centrífugas' },
  { key: 'cirurgia',    label: 'Cirurgia',             desc: 'Bisturis, mesas cirúrgicas, laparoscopia' },
  { key: 'oncologia',   label: 'Oncologia',            desc: 'Aceleradores, braquiterapia, infusoras' },
  { key: 'medicamento', label: 'Medicamentos',         desc: 'Fármacos, vacinas, soros, gases medicinais' },
  // Estas sete nasceram ao drenar o antigo balde 'outros', que guardava 65% da base.
  { key: 'material_hospitalar', label: 'Material Hospitalar', desc: 'Material médico-hospitalar, penso, descartáveis' },
  { key: 'equipamento_medico',  label: 'Equip. Médicos',      desc: 'Material permanente, autoclaves, mobiliário' },
  { key: 'servicos_medicos',    label: 'Serviços Médicos',    desc: 'Credenciamento, plantão, diálise, exames' },
  { key: 'odontologia',         label: 'Odontologia',         desc: 'Material odontológico, próteses dentárias' },
  { key: 'ambulancia',          label: 'Ambulâncias',         desc: 'Ambulâncias, SAMU, transporte de pacientes' },
  { key: 'manutencao',          label: 'Manutenção',          desc: 'Preventiva/corretiva, calibração, assist. técnica' },
  { key: 'opme',                label: 'OPME',                desc: 'Órteses, próteses, implantes, stents' },
  { key: 'outros',      label: 'Não classificado',     desc: 'Objeto genérico, sem produto identificável' },
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

// Sugestão inteligente de categorias de interesse por segmento. Ao trocar o
// segmento, as "Categorias de Interesse" se adaptam para as mais prováveis daquele
// perfil (o usuário ainda pode ajustar manualmente depois). Segmentos sem casamento
// óbvio (TI, Serviços, Outro) não forçam sugestão — retornam [].
// As sugestões apontavam para 'outros' quando queriam dizer "equipamento genérico"
// ou "consumível" — era o que existia. Agora que essas categorias têm nome próprio,
// a sugestão aponta para elas: 'outros' passou a significar "não classificado".
const SEGMENTO_CATEGORIAS: Record<string, string[]> = {
  'Equipamentos Médicos':        ['imagem', 'uti', 'cirurgia', 'equipamento_medico'],
  'Equipamentos de Diagnóstico': ['imagem', 'laboratorio'],
  'Dispositivos Implantáveis':   ['cirurgia', 'oncologia', 'opme'],
  'Mobiliário Hospitalar':       ['equipamento_medico'],
  'Reagentes e Consumíveis':     ['laboratorio', 'material_hospitalar'],
  'TI em Saúde':                 [],
  'Serviços Técnicos':           ['manutencao', 'servicos_medicos'],
  'Outro':                       [],
}

type Aba = 'empresa' | 'portfolio'

// ── Page ──────────────────────────────────────────────────────────────────────

function SetupInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const su = session?.user as { plano?: string | null; role?: string | null; status?: string | null } | undefined
  // Portfólio era um recurso Pro; preservamos o gate mesmo dentro do setup unificado.
  const acessoPro = temAcessoPro({ plano: su?.plano, role: su?.role, status: su?.status })
  const abaUrl = (searchParams.get('tab') === 'portfolio' ? 'portfolio' : 'empresa') as Aba
  // 1º acesso: chegou aqui pelo gate de onboarding. Ao salvar, cai no Dashboard.
  const onboarding = searchParams.get('onboarding') === '1'

  const [mounted, setMounted] = useState(false)
  const [aba, setAba] = useState<Aba>(abaUrl)
  const [prefs, setPrefs] = useState<UserPreferences>({
    nomeEmpresa: '',
    cnpj: '',
    segmento: 'Equipamentos Médicos',
    categorias: [],
    ufs: [],
    termosBusca: [],
  })
  const [termoInput, setTermoInput] = useState('')
  const [saved, setSaved] = useState(false)
  // Origem dos dados de empresa/CNPJ: puxados do cadastro no 1º acesso.
  const [puxadoDoCadastro, setPuxadoDoCadastro] = useState(false)

  useEffect(() => {
    const atuais = getPreferences()
    setPrefs(atuais)
    setMounted(true)

    // Auto-preenche nome da empresa e CNPJ a partir do cadastro da conta (o cliente
    // informou o CNPJ ao criar a conta). Só preenche o que ainda estiver vazio no
    // setup — nunca sobrescreve o que o usuário já ajustou aqui — e persiste.
    ;(async () => {
      if (atuais.nomeEmpresa?.trim() && atuais.cnpj?.trim()) return
      try {
        const res = await fetch('/api/conta')
        if (!res.ok) return
        const { conta } = await res.json()
        if (!conta) return
        const patch: Partial<UserPreferences> = {}
        if (!atuais.nomeEmpresa?.trim() && conta.empresa?.trim()) patch.nomeEmpresa = conta.empresa.trim()
        if (!atuais.cnpj?.trim() && conta.cnpj?.trim()) patch.cnpj = conta.cnpj.trim()
        if (Object.keys(patch).length === 0) return
        const novo = { ...getPreferences(), ...patch }
        savePreferences(novo)
        setPrefs(novo)
        setPuxadoDoCadastro(true)
      } catch { /* best-effort: cadastro sem CNPJ ou API indisponível */ }
    })()
  }, [])

  // Mantém a aba em sincronia com a URL (deep-link do dashboard, oportunidades…).
  useEffect(() => { setAba(abaUrl) }, [abaUrl])

  // Recarrega o perfil quando a conta termina de sincronizar do servidor (mesmo
  // padrão do PortfolioManager) — mantém as duas abas coerentes.
  useEffect(() => {
    const h = () => setPrefs(getPreferences())
    window.addEventListener(HYDRATED_EVENT, h)
    return () => window.removeEventListener(HYDRATED_EVENT, h)
  }, [])

  function trocarAba(a: Aba) {
    // Ao voltar do Portfólio para Empresa, relê o setup: produtos recém-adicionados
    // já refletem nas "Categorias de Interesse" (a união é feita em lib/empresa).
    if (a === 'empresa') setPrefs(getPreferences())
    setAba(a)
    router.replace(a === 'portfolio' ? '/perfil?tab=portfolio' : '/perfil', { scroll: false })
  }

  // Troca de segmento: adapta as categorias de interesse para a sugestão daquele
  // segmento (união com a categoria dos produtos ativos do portfólio, que não deve
  // ser perdida). Segmento sem sugestão (TI, Serviços, Outro) mantém o que já havia.
  function mudarSegmento(segmento: string) {
    setPrefs((p) => {
      const sugeridas = SEGMENTO_CATEGORIAS[segmento] ?? []
      if (sugeridas.length === 0) return { ...p, segmento }
      // Preserva as categorias já garantidas pelos produtos ativos do portfólio
      // (mapeadas para o conjunto do setup) e adiciona a sugestão do segmento.
      const doPortfolio = getProdutos()
        .filter((pr) => pr.ativo && pr.categoria)
        .map((pr) => (CATEGORIAS.some((c) => c.key === pr.categoria) ? pr.categoria : 'outros'))
      return { ...p, segmento, categorias: [...new Set([...doPortfolio, ...sugeridas])] }
    })
  }

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
      ufs: p.ufs.includes(uf) ? p.ufs.filter((u) => u !== uf) : [...p.ufs, uf],
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
    markOnboarded() // conclui o 1º acesso (qualquer save conta como setup feito)
    setSaved(true)
    // No fluxo de 1º acesso, após salvar o cliente cai no Dashboard já filtrado.
    if (onboarding) { setTimeout(() => router.push('/'), 700); return }
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
          <Topbar title="Setup da Empresa" />
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
        <Topbar title="Setup da Empresa" />
        <div className="flex-1 overflow-y-auto p-6">

          {/* Boas-vindas do 1º acesso — deixa claro por que essa é a primeira tela */}
          {onboarding && (
            <div className="mb-4 flex items-start gap-3 px-4 py-3 rounded-xl bg-accent/10 border border-accent/25">
              <CheckCircle2 size={16} className="text-accent flex-shrink-0 mt-0.5" />
              <div className="text-[13px] text-strong">
                <strong>Bem-vindo!</strong> Antes de começar, configure onde sua empresa atua e o que
                vende. O Dashboard e os alertas vão abrir já filtrados por isto.
                <span className="text-muted"> Selecione seus estados e clique em Salvar.</span>
              </div>
            </div>
          )}

          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="font-heading font-bold text-[22px] text-strong leading-none">Setup da Empresa</h1>
              <p className="text-[13px] text-muted mt-1">
                Uma configuração só: o que sua empresa vende e onde atua. Alertas, dashboard e
                filtros de oportunidade puxam tudo daqui.
              </p>
            </div>
            {aba === 'empresa' && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleReset}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg3 border border-subtle text-[12px] text-muted hover:text-strong transition-colors"
                >
                  <RotateCcw size={12} /> Restaurar
                </button>
                <button
                  onClick={handleSave}
                  className={clsx(
                    'flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-all',
                    saved ? 'bg-emerald-500 text-white' : 'bg-accent text-black hover:bg-accent/90'
                  )}
                >
                  {saved ? <CheckCircle2 size={13} /> : <Save size={13} />}
                  {saved ? 'Salvo!' : onboarding ? 'Salvar e continuar' : 'Salvar'}
                </button>
              </div>
            )}
          </div>

          {/* Abas */}
          <div className="flex items-center gap-1 mb-5 border-b border-subtle">
            {([
              { key: 'empresa' as Aba, label: 'Empresa & Preferências', icon: Building2 },
              { key: 'portfolio' as Aba, label: 'Meu Portfólio', icon: Boxes },
            ]).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => trocarAba(key)}
                className={clsx(
                  'flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors',
                  aba === key
                    ? 'border-accent text-strong'
                    : 'border-transparent text-muted hover:text-strong'
                )}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>

          {aba === 'portfolio' ? (
            acessoPro ? (
              <PortfolioManager />
            ) : (
              <div className="bg-bg2 border border-dashed border-subtle2 rounded-xl py-16 flex flex-col items-center text-center max-w-[760px]">
                <Lock size={30} className="text-faint mb-3" />
                <h3 className="text-[15px] font-semibold text-strong">Portfólio é um recurso Pro</h3>
                <p className="text-[13px] text-muted mt-1 mb-5 max-w-[420px]">
                  Cadastre seus produtos (CATMAT + palavras-chave) para casar as oportunidades com o
                  que sua empresa vende e alimentar alertas automaticamente. Disponível no plano Pro.
                </p>
                <Link href={`/assinar?plano=pro`}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-black text-[13px] font-semibold hover:bg-accent/90 transition-colors">
                  Conhecer o Pro →
                </Link>
              </div>
            )
          ) : (
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
                    <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">CNPJ</label>
                    <input
                      value={prefs.cnpj ?? ''}
                      onChange={(e) => setPrefs((p) => ({ ...p, cnpj: e.target.value }))}
                      placeholder="00.000.000/0000-00"
                      className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">Segmento</label>
                    <select
                      value={prefs.segmento}
                      onChange={(e) => mudarSegmento(e.target.value)}
                      className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong focus:outline-none focus:border-accent"
                    >
                      {SEGMENTOS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                {puxadoDoCadastro && (
                  <p className="text-[11px] text-faint mt-3 flex items-center gap-1.5">
                    <CheckCircle2 size={12} className="text-emerald-400" />
                    Nome e CNPJ puxados do seu cadastro. Ajuste se precisar e clique em Salvar.
                  </p>
                )}
              </section>

              {/* Categorias */}
              <section className="bg-bg2 border border-subtle rounded-xl p-5">
                <div className="flex items-center gap-2 mb-1">
                  <Tag size={15} className="text-faint" />
                  <h2 className="text-[13px] font-semibold text-strong">Categorias de Interesse</h2>
                </div>
                <p className="text-[12px] text-faint mb-4">Sugeridas pelo segmento e pelos produtos do seu portfólio — ajuste como quiser. Deixe vazio para monitorar todas.</p>
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
                <p className="text-[12px] text-faint mb-4">Palavras-chave relacionadas aos seus produtos. Usadas para pré-filtrar oportunidades e alimentar alertas (junto com as do portfólio).</p>
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

              {/* Ponte para alertas */}
              <div className="flex items-center gap-2 text-[12px] text-muted bg-bg2 border border-subtle rounded-xl px-4 py-3">
                <Bell size={14} className="text-accent flex-shrink-0" />
                <span>Quer ser avisado do que casa com este setup?</span>
                <Link href="/alertas" className="text-accent hover:underline font-medium">Criar alerta do meu setup →</Link>
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PerfilPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen bg-bg">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar title="Setup da Empresa" />
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={22} className="animate-spin text-faint" />
          </div>
        </div>
      </div>
    }>
      <SetupInner />
    </Suspense>
  )
}
