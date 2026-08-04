'use client'
// src/app/radar/page.tsx — Monitorar Chat (monitoramento de mensagens de licitações).
//
// Layout espelhado da ferramenta "Monitorar Chat" da ConLicitação (benchmark):
//   • dois painéis: pregões monitorados à esquerda, conversa à direita;
//   • alternador "Monitorado por mim" × "Monitorado por todos";
//   • card com nº do processo + data, órgão e SELO DO PORTAL colorido;
//   • cabeçalho da conversa com nº / órgão / prazo e ações ✓✓ (marcar lidas),
//     ⟳ (atualizar) e ⋮ (Informações da licitação · Acessar local da disputa ·
//     Desativar monitoramento);
//   • abas "Mensagens do chat" + seletor de lote;
//   • PALAVRAS-CHAVE PINTADAS dentro do texto (âmbar) e anexo/arquivo (verde);
//   • modal "Detalhes da licitação".
//
// Diferenças de propósito, mantidas de lado:
//   • a seleção dos processos é AUTOMÁTICA pelo perfil (não é opt-in edital a edital);
//   • REQUISITO 4.2: a saúde dos conectores fica sempre à vista — nunca dizemos
//     "sem novidades" quando na verdade não deu para verificar.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Link from 'next/link'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import {
  Radar, AlertTriangle, ExternalLink, X, Check, Plus, Loader2, Bell,
  Search, Star, Archive, ArchiveRestore, CheckCheck, MessageSquare, Paperclip,
  Inbox as InboxIcon, MoreVertical, RefreshCw, Info, BellOff, Settings,
} from 'lucide-react'
import { comProblema } from '@/lib/radar/saude'
import { CONECTORES, conectorDisponivel, conectorPublico } from '@/lib/radar/conectores'
import { destacar, temChave } from '@/lib/radar/destaque'
import { nomePortal } from '@/lib/portais'
import { CONFIG_PADRAO, type ConfigRadar } from '@/lib/radar/config'
import SaudeConectores, { type SaudeItem } from './components/SaudeConectores'

const CATEGORIAS = ['convocacao', 'negociacao', 'proposta_ajustada', 'habilitacao', 'diligencia', 'recurso', 'prazo', 'cnpj']

interface Mensagem {
  id: number; processo_id: string; conector_id: string; cnpj: string; licitacao_id: string
  autor: string | null; texto: string; anexos: { nome: string; url?: string }[]
  horario_origem: string | null; capturado_em: string; categorias: string[]; prioridade: string
  lida: boolean; titulo: string | null; link_portal: string | null; lote?: string | null
}
/** Pregão monitorado como vem da API (existe mesmo sem mensagem capturada ainda). */
interface ProcessoApi {
  id: string; conectorId: string; cnpj: string; licitacaoId: string; titulo: string | null
  uf: string | null; valor: number | null; prioridade: string; mutado: boolean; origem: string
  linkPortal: string | null; atualizadoEm: string
  orgao: string | null; municipio: string | null; modalidade: string | null
  prazo: string | null; abertura: string | null; situacao: 'aberta' | 'encerrada'; meu: boolean
  /** Portal REAL da sessão (Licitanet/BNC/BLL/…), derivado do PNCP. */
  portal: string
  /** URL do portal de origem, quando o PNCP informou. */
  linkOrigem: string | null
}
interface Inbox {
  mensagens: Mensagem[]
  processos: ProcessoApi[]
  chaves: string[]
  kpis: { naoLidas: number; processosAtivos: number; conectores: number }
  saude: SaudeItem[]
  /** O que o ambiente consegue fazer (cofre de credenciais / login hospedado). */
  capacidades?: { cofre: boolean; hosted: boolean }
  atualizadoEm: string
}

/** Pregão + sua conversa, já ordenada. */
interface Processo extends ProcessoApi {
  mensagens: Mensagem[]
  naoLidas: number
  ultima: Mensagem | null
  prioridadeAlta: boolean
}

function montarProcessos(data: Inbox): Processo[] {
  const porProcesso = new Map<string, Mensagem[]>()
  for (const m of data.mensagens) {
    const chave = m.processo_id || m.licitacao_id || String(m.id)
    const lista = porProcesso.get(chave)
    if (lista) lista.push(m)
    else porProcesso.set(chave, [m])
  }

  const procs: Processo[] = data.processos.map((p) => {
    const msgs = (porProcesso.get(p.id) ?? []).sort((a, b) => tempoMs(a) - tempoMs(b))
    porProcesso.delete(p.id)
    return {
      ...p,
      mensagens: msgs,
      naoLidas: msgs.filter((m) => !m.lida).length,
      ultima: msgs[msgs.length - 1] ?? null,
      prioridadeAlta: msgs.some((m) => m.prioridade === 'alta' && !m.lida),
    }
  })

  // Mensagens órfãs (processo já removido da seleção, mas a conversa existe):
  // não somem — viram um card a partir do que a própria mensagem carrega.
  for (const [id, msgs] of porProcesso) {
    const ordenadas = msgs.sort((a, b) => tempoMs(a) - tempoMs(b))
    const u = ordenadas[ordenadas.length - 1]
    procs.push({
      id, conectorId: u.conector_id, cnpj: u.cnpj, licitacaoId: u.licitacao_id,
      titulo: u.titulo, uf: null, valor: null, prioridade: u.prioridade, mutado: false,
      origem: 'auto', linkPortal: u.link_portal, atualizadoEm: u.capturado_em,
      orgao: null, municipio: null, modalidade: null, prazo: null, abertura: null,
      situacao: 'aberta', meu: true, portal: u.conector_id, linkOrigem: null,
      mensagens: ordenadas,
      naoLidas: ordenadas.filter((m) => !m.lida).length,
      ultima: u,
      prioridadeAlta: ordenadas.some((m) => m.prioridade === 'alta' && !m.lida),
    })
  }

  // Não lidos sobem; depois, conversa mais recente (ou o processo mais recente).
  return procs.sort((a, b) =>
    (b.naoLidas > 0 ? 1 : 0) - (a.naoLidas > 0 ? 1 : 0) ||
    ordemMs(b) - ordemMs(a))
}

function ordemMs(p: Processo): number {
  if (p.ultima) return tempoMs(p.ultima)
  const t = p.atualizadoEm ? new Date(p.atualizadoEm).getTime() : 0
  return Number.isFinite(t) ? t : 0
}

function tempoMs(m: Mensagem): number {
  const d = m.horario_origem || m.capturado_em
  const t = d ? new Date(d).getTime() : 0
  return Number.isFinite(t) ? t : 0
}

/** "14/11/2025 | 08:00" — o formato do carimbo de hora do benchmark. */
function carimbo(m: Mensagem): string {
  const d = m.horario_origem || m.capturado_em
  if (!d) return ''
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return ''
  return `${dt.toLocaleDateString('pt-BR')} | ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

function dataCurta(iso: string | null): string {
  if (!iso) return '—'
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('pt-BR')
}

function prazoLongo(iso: string | null): string {
  if (!iso) return '—'
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const moeda = (v: number | null) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

// Selo do portal com cor própria (o benchmark distingue Licitanet, ComprasNet,
// Bolsa Nacional… à primeira vista). Os nomes vêm de lib/portais (fonte única);
// aqui ficam só as cores. Portal sem cor definida cai num cinza neutro.
const COR_PORTAL: Record<string, string> = {
  comprasgov: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  licitanet: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  bnc: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  bll: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
  'licitacoes-e': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  pcp: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  licitamaisbrasil: 'bg-lime-500/15 text-lime-300 border-lime-500/30',
  licitardigital: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  ammlicita: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  banrisul: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
}
// Rótulo curto: o nome completo ("BNC — Bolsa Nacional de Compras") não cabe no selo.
const CURTO: Record<string, string> = {
  comprasgov: 'Compras.gov', bnc: 'BNC', bll: 'BLL', 'licitacoes-e': 'Licitações-e',
  pcp: 'PCP', licitamaisbrasil: 'Licita+Brasil', licitardigital: 'Licitar Digital',
  ammlicita: 'AMM Licita', desconhecido: 'não informado',
}
function selo(id: string) {
  return {
    label: CURTO[id] ?? nomePortal(id),
    cls: COR_PORTAL[id] ?? 'bg-bg4 text-faint border-subtle2',
  }
}

// Papel do autor (Pregoeiro × Fornecedor × Sistema) para rotular a fala.
function papelAutor(autor: string | null): 'pregoeiro' | 'fornecedor' | 'sistema' | 'outro' {
  const a = (autor ?? '').toLowerCase()
  if (/preg|agente|comiss|autoridade/.test(a)) return 'pregoeiro'
  if (/fornec|licitante|empresa|particip/.test(a)) return 'fornecedor'
  if (/sistema|system/.test(a)) return 'sistema'
  return 'outro'
}
const PAPEL_CLS: Record<string, string> = {
  pregoeiro: 'text-brand-blue',
  fornecedor: 'text-accent',
  sistema: 'text-faint',
  outro: 'text-muted',
}
const PAPEL_LABEL: Record<string, string> = {
  pregoeiro: 'Pregoeiro(a)', fornecedor: 'Fornecedor', sistema: 'Sistema', outro: 'Mensagem',
}

// Flags locais por processo (Importante / Arquivado) — a captura vem de um worker,
// então marcação do usuário fica no navegador.
type Flags = Record<string, { importante?: boolean; arquivado?: boolean }>
const FLAGS_KEY = 'radar_flags_v1'
function lerFlags(): Flags { try { return JSON.parse(localStorage.getItem(FLAGS_KEY) || '{}') } catch { return {} } }
function salvarFlags(f: Flags) { try { localStorage.setItem(FLAGS_KEY, JSON.stringify(f)) } catch { /* quota */ } }

type Filtro = 'todos' | 'nao_lidas' | 'importantes' | 'desativados' | 'arquivados'

// Quantos cards a lista desenha por vez. A seleção é automática e rende centenas de
// pregões (o titular de teste tem 309, outro 547): montar todos de uma vez fazia cada
// toque em filtro/busca re-renderizar a lista inteira.
const POR_PAGINA = 60

const FILTRO_LABEL: Record<Filtro, string> = {
  todos: 'Todos os pregões monitorados',
  nao_lidas: 'Somente com mensagem não lida',
  importantes: 'Somente marcados como importante',
  desativados: 'Monitoramento desativado',
  arquivados: 'Arquivados',
}

export default function RadarPage() {
  const [data, setData] = useState<Inbox | null>(null)
  const [config, setConfig] = useState<ConfigRadar>(CONFIG_PADRAO)
  const [loading, setLoading] = useState(true)
  const [atualizando, setAtualizando] = useState(false)
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState('')
  const [selId, setSelId] = useState<string | null>(null)
  const [conectar, setConectar] = useState(false)
  const [flags, setFlags] = useState<Flags>({})
  const [detalhes, setDetalhes] = useState<Processo | null>(null)
  const [lote, setLote] = useState('')
  const [portalFiltro, setPortalFiltro] = useState('')
  const [pagina, setPagina] = useState(1)
  const agoraMs = Date.now()

  useEffect(() => { setFlags(lerFlags()) }, [])

  // Trava de requisição em voo: a caixa atualiza sozinha, e sem isso um GET lento
  // era atropelado pelo tick seguinte — sobrepondo chamadas e podendo aplicar uma
  // resposta antiga por cima de uma mais nova.
  const emVoo = useRef(false)

  // NÃO recebe filtro: a caixa inteira do tenant vem num GET só e TODOS os filtros
  // (categoria inclusive) são aplicados aqui no cliente. Antes o filtro de categoria
  // entrava na querystring, então mudar o combo refazia a chamada — e como a rota
  // ainda dispara a seleção automática, a lista sumia por segundos a cada troca.
  const carregar = useCallback(async (silencioso = false) => {
    if (emVoo.current) return
    emVoo.current = true
    if (silencioso) setAtualizando(true); else setLoading(true)
    try {
      const r = await fetch('/api/radar/inbox')
      const d: Inbox = await r.json()
      setData(d)
    } catch { /* mantém o que já está na tela */ } finally {
      emVoo.current = false
      setLoading(false); setAtualizando(false)
    }
  }, [])

  useEffect(() => { void carregar() }, [carregar])

  // Config de notificação (aviso sonoro / push / escopo) — do servidor, vale p/ o time.
  useEffect(() => {
    fetch('/api/radar/config').then((r) => r.json()).then((j) => { if (j.config) setConfig(j.config) }).catch(() => {})
  }, [])

  // Estável entre renders: `chaves` é dependência do efeito de aviso sonoro/push.
  const chaves = useMemo(() => data?.chaves ?? [], [data])

  const processos = useMemo(() => data ? montarProcessos(data) : [], [data])

  // ── Aviso sonoro / push quando chega mensagem nova ────────────────────────
  // Só dispara depois da primeira carga (senão avisaria tudo que já estava lá) e
  // respeita o escopo configurado (todas × somente com palavra-chave).
  const vistos = useRef<Set<number> | null>(null)
  useEffect(() => {
    if (!data) return
    const relevantes = data.mensagens.filter((m) =>
      !m.lida && (config.escopo === 'todas' || temChave(m.texto, chaves)))
    const ids = new Set(relevantes.map((m) => m.id))
    if (vistos.current === null) { vistos.current = ids; return }   // primeira carga: só registra
    const novas = relevantes.filter((m) => !vistos.current!.has(m.id))
    vistos.current = ids
    if (novas.length === 0 || !config.notificar) return

    if (config.avisoSonoro) beep()
    if (config.push && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      const m = novas[0]
      try {
        new Notification(
          novas.length === 1 ? 'Nova mensagem no chat' : `${novas.length} novas mensagens no chat`,
          { body: `${m.autor || 'Mensagem'}: ${m.texto.slice(0, 120)}`, tag: `radar:${m.processo_id}` },
        )
      } catch { /* alguns navegadores exigem service worker */ }
    }
  }, [data, config, chaves])

  // Atualização periódica (o worker captura fora daqui; a tela só relê). Pausa com a
  // aba em segundo plano — sem isso, abas esquecidas ficariam consultando para sempre.
  useEffect(() => {
    const tick = () => { if (!document.hidden) void carregar(true) }
    const t = setInterval(tick, 120_000)
    return () => clearInterval(t)
  }, [carregar])

  const marcarLidaMsg = useCallback(async (m: Mensagem) => {
    if (m.lida) return
    setData((d) => d ? {
      ...d,
      mensagens: d.mensagens.map((x) => x.id === m.id ? { ...x, lida: true } : x),
      kpis: { ...d.kpis, naoLidas: Math.max(0, d.kpis.naoLidas - 1) },
    } : d)
    try {
      await fetch(`/api/radar/mensagens/${m.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'lida' }),
      })
    } catch { /* melhor esforço; o próximo carregar reconcilia */ }
  }, [])

  const setFlag = (id: string, patch: { importante?: boolean; arquivado?: boolean }) => {
    setFlags((f) => {
      const novo = { ...f, [id]: { ...f[id], ...patch } }
      salvarFlags(novo)
      return novo
    })
  }

  /** Liga/desliga o monitoramento de um pregão (kebab do benchmark). */
  async function alternarMonitoramento(p: Processo) {
    const mutado = !p.mutado
    setData((d) => d ? { ...d, processos: d.processos.map((x) => x.id === p.id ? { ...x, mutado } : x) } : d)
    try {
      await fetch('/api/radar/processos', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, mutado }),
      })
    } catch {
      setData((d) => d ? { ...d, processos: d.processos.map((x) => x.id === p.id ? { ...x, mutado: !mutado } : x) } : d)
    }
  }

  const problemas = data ? comProblema(data.saude, agoraMs) : []

  // Dois estados diferentes, e a tela dizia a mesma coisa nos dois (REQUISITO 4.2):
  //  • semConectorOk  — nenhuma credencial verificada, então o chat dos portais que
  //    EXIGEM login (Compras.gov) não está sendo lido. Independe de já ter mensagem:
  //    o modo público (PCP) captura sem credencial.
  //  • capturaNuncaLigou — além disso, nunca chegou mensagem nenhuma. Aí "assim que o
  //    pregoeiro escrever, aparece aqui" é promessa que a instalação não cumpre.
  const semConectorOk = !!data && !data.saude.some((s) => s.status === 'ok')
  const capturaNuncaLigou = semConectorOk && data.mensagens.length === 0
  // Ambiente sem cofre/hosted → o login do gov.br não tem como concluir. Quando a API
  // é antiga e não manda o campo, assume que dá (não esconde botão que funciona).
  const capacidades = data?.capacidades ?? { cofre: true, hosted: true }

  // ATENÇÃO à lista de dependências: `portalFiltro` estava FALTANDO aqui, e era esse
  // o "filtro de portal que demora para aplicar". O React re-renderizava ao escolher o
  // portal, mas o useMemo devolvia o resultado velho em cache — a lista só mudava
  // quando outra dependência mexia, ou seja, no tick de atualização automática: até
  // 2 minutos depois. Não era lentidão de volume, era filtro que não aplicava.
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return processos.filter((p) => {
      const arq = !!flags[p.id]?.arquivado
      const imp = !!flags[p.id]?.importante
      if (filtro === 'arquivados') { if (!arq) return false } else if (arq) return false
      if (filtro === 'desativados') { if (!p.mutado) return false } else if (p.mutado && filtro !== 'todos') return false
      if (filtro === 'nao_lidas' && p.naoLidas === 0) return false
      if (filtro === 'importantes' && !imp) return false
      if (portalFiltro && p.portal !== portalFiltro) return false
      if (categoria && !p.mensagens.some((m) => m.categorias.includes(categoria))) return false
      if (q) {
        const alvo = `${p.titulo ?? ''} ${p.licitacaoId} ${p.orgao ?? ''} ${p.cnpj} ${p.mensagens.map((m) => m.texto).join(' ')}`.toLowerCase()
        if (!alvo.includes(q)) return false
      }
      return true
    })
  }, [processos, flags, filtro, portalFiltro, categoria, busca])

  const contagem = useMemo(() => {
    const ativos = processos.filter((p) => !flags[p.id]?.arquivado)
    return {
      todos: ativos.length,
      nao_lidas: ativos.filter((p) => p.naoLidas > 0 && !p.mutado).length,
      importantes: ativos.filter((p) => flags[p.id]?.importante).length,
      desativados: ativos.filter((p) => p.mutado).length,
      arquivados: processos.filter((p) => flags[p.id]?.arquivado).length,
    }
  }, [processos, flags])

  // Portais efetivamente presentes na base do tenant (com a contagem) — o filtro só
  // oferece o que existe, em vez do catálogo inteiro.
  const portaisPresentes = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of processos) m.set(p.portal, (m.get(p.portal) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [processos])

  // Volta para a primeira página quando o resultado muda — senão o usuário filtra e
  // continua olhando a página 4 de uma lista que encurtou.
  useEffect(() => { setPagina(1) }, [filtro, portalFiltro, categoria, busca])

  const visiveis = useMemo(() => filtrados.slice(0, pagina * POR_PAGINA), [filtrados, pagina])
  const restantes = filtrados.length - visiveis.length

  const selecionado = filtrados.find((p) => p.id === selId) ?? null

  // Lotes presentes na conversa (o portal só informa em alguns casos).
  const lotes = useMemo(() => {
    if (!selecionado) return []
    return [...new Set(selecionado.mensagens.map((m) => m.lote).filter((l): l is string => !!l))]
  }, [selecionado])

  useEffect(() => { setLote('') }, [selId])

  const mensagensVisiveis = useMemo(() => {
    if (!selecionado) return []
    return lote ? selecionado.mensagens.filter((m) => m.lote === lote) : selecionado.mensagens
  }, [selecionado, lote])

  const abrirProcesso = (p: Processo) => {
    setSelId(p.id)
    for (const m of p.mensagens) if (!m.lida) void marcarLidaMsg(m)
  }
  const marcarTodasLidas = (p: Processo) => { for (const m of p.mensagens) if (!m.lida) void marcarLidaMsg(m) }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar title="Monitorar Chat" />
        <main className="flex-1 overflow-y-auto p-6 bg-bg">

          {/* Header */}
          <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2">
                <Radar size={18} className="text-accent" />
                <h1 className="font-heading font-bold text-[20px] text-strong">Monitorar Chat</h1>
              </div>
              <p className="text-[12px] text-muted mt-1 max-w-[640px]">
                Acompanhe as mensagens e convocações dos pregões que combinam com o
                <strong className="text-strong"> seu perfil</strong> — sem cadastrar licitação a licitação.
                Convocação, negociação, diligência ou prazo: você é avisado por e-mail e aqui.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/radar/configuracoes"
                className="flex items-center gap-1.5 text-[12px] px-3 py-2 rounded-md border border-subtle2 text-muted hover:text-strong hover:border-subtle transition-colors">
                <Settings size={14} /> Configurações gerais
              </Link>
              <button onClick={() => setConectar(true)} className="flex items-center gap-1.5 text-[12px] px-3 py-2 rounded-md bg-accent text-black font-semibold hover:bg-accent2 transition-colors">
                <Plus size={14} /> Conectar portal
              </button>
            </div>
          </div>

          {/* REQUISITO 4.2 — banner de incerteza.
              Dois textos diferentes de propósito: "nunca ligou" é um estado de
              instalação (ninguém concluiu o login do portal), não uma falha
              intermitente de conector — e a saída para cada um é outra. */}
          {semConectorOk ? (
            <div className="mb-4 flex items-start gap-2 bg-amber/10 border border-amber/30 rounded-lg px-4 py-3">
              <AlertTriangle size={16} className="text-amber flex-shrink-0 mt-0.5" />
              <p className="text-[12px] text-amber">
                <strong>Nenhum conector conectado.</strong> Os pregões abaixo estão selecionados pelo seu perfil e
                são acompanhados por data e prazo, mas o <strong>chat dos portais que exigem login</strong>{' '}
                (Compras.gov.br) <strong>não está sendo lido</strong>
                {capturaNuncaLigou ? ' — nenhuma mensagem foi capturada até agora' : ''}.{' '}
                {capacidades.cofre
                  ? <>Conclua o login em <strong>Conectar portal</strong>.</>
                  : <>A conexão por login do gov.br não está habilitada neste ambiente; o Portal de Compras Públicas monitora sem login.</>}
              </p>
            </div>
          ) : problemas.length > 0 && (
            <div className="mb-4 flex items-start gap-2 bg-amber/10 border border-amber/30 rounded-lg px-4 py-3">
              <AlertTriangle size={16} className="text-amber flex-shrink-0 mt-0.5" />
              <p className="text-[12px] text-amber">
                Não foi possível verificar {problemas.length} conector(es) recentemente — a lista pode estar
                <strong> incompleta</strong>. Reconecte as credenciais para voltar a monitorar com segurança.
              </p>
            </div>
          )}

          {/* Aviso quando a notificação está desligada — o valor da ferramenta é o alerta. */}
          {!config.notificar && (
            <div className="mb-4 flex items-center gap-2 bg-bg2 border border-subtle rounded-lg px-4 py-2.5">
              <BellOff size={14} className="text-faint flex-shrink-0" />
              <p className="text-[12px] text-muted">
                As notificações estão <strong className="text-strong">desativadas</strong> — continuamos capturando o chat, mas nada é avisado.{' '}
                <Link href="/radar/configuracoes" className="text-accent hover:underline">Ativar</Link>
              </p>
            </div>
          )}

          {/* KPIs */}
          {data && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <Kpi label="Mensagens não lidas" valor={String(data.kpis.naoLidas)} destaque={data.kpis.naoLidas > 0} />
              <Kpi label="Pregões monitorados" valor={String(data.kpis.processosAtivos)} />
              <Kpi label="Conectores OK" valor={String(data.saude.length - problemas.length)} />
              <Kpi label="Conectores c/ problema" valor={String(problemas.length)} destaque={problemas.length > 0} />
            </div>
          )}

          {/* Saúde dos conectores */}
          <div className="mb-5">
            <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-2">Saúde dos conectores</div>
            <SaudeConectores saude={(data?.saude ?? []) as SaudeItem[]} agoraMs={agoraMs} />
          </div>

          {loading ? (
            <div className="space-y-2">{[1, 2, 3, 4].map((i) => <div key={i} className="h-12 bg-bg2 border border-subtle rounded-lg animate-pulse" />)}</div>
          ) : !data || processos.length === 0 ? (
            <div className="bg-bg2 border border-subtle rounded-2xl p-10 text-center">
              <Bell size={28} className="text-faint mx-auto mb-3" />
              <p className="text-[14px] text-strong mb-1">Nenhum pregão monitorado ainda</p>
              <p className="text-[12px] text-muted max-w-[460px] mx-auto">
                Assim que a seleção automática achar licitações do seu perfil, elas aparecem aqui —
                e as mensagens do chat entram conforme o conector captura. Verifique a saúde dos conectores acima.
              </p>
            </div>
          ) : (
            <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden grid grid-cols-1 lg:grid-cols-[360px_1fr] h-[620px]">

              {/* ── Esquerda: pregões monitorados ───────────────────────────── */}
              <div className="border-r border-subtle flex flex-col min-h-0">
                {/* Aqui existia o alternador "Monitorado por mim × por todos", copiado do
                    benchmark. Ele NÃO se aplica a este produto e por isso saiu: no
                    benchmark você adiciona pregão a pregão, então "meu" é uma escolha
                    sua; aqui a seleção é automática por perfil e vale para a empresa
                    inteira. O campo `meu` da API só registra sob qual usuário a
                    sincronização rodou, ou seja, as duas abas mostravam a MESMA lista —
                    exatamente o que foi reportado. Divisão de trabalho é o que o filtro
                    abaixo faz (não lidas / importantes / desativados / arquivados). */}
                <div className="px-2.5 pt-2.5 pb-1">
                  <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">
                    Pregões monitorados · seleção automática
                  </div>
                </div>

                {/* Filtro (dropdown) */}
                <div className="px-2.5 py-2 border-b border-subtle">
                  <select value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)}
                    className="w-full text-[11.5px] bg-bg3 border border-subtle rounded-md px-2 py-1.5 text-muted focus:border-accent outline-none">
                    {(Object.keys(FILTRO_LABEL) as Filtro[]).map((f) => (
                      <option key={f} value={f}>{FILTRO_LABEL[f]} ({contagem[f]})</option>
                    ))}
                  </select>
                </div>

                {/* Busca */}
                <div className="px-2.5 pb-2 pt-2 border-b border-subtle">
                  <div className="flex items-center gap-2 bg-bg3 border border-subtle rounded-lg px-2.5 py-1.5">
                    <Search size={13} className="text-faint flex-shrink-0" />
                    <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nº, órgão, CNPJ ou texto…"
                      className="bg-transparent text-[12px] text-strong placeholder:text-faint outline-none w-full" />
                    {busca && <button onClick={() => setBusca('')} className="text-faint hover:text-strong"><X size={12} /></button>}
                  </div>
                </div>

                {/* Portal + categorias */}
                <div className="px-2.5 py-2 border-b border-subtle grid grid-cols-2 gap-2">
                  <select value={portalFiltro} onChange={(e) => setPortalFiltro(e.target.value)}
                    title="Filtrar pelo portal em que o pregão acontece"
                    className="w-full text-[11px] bg-bg3 border border-subtle rounded-md px-2 py-1 text-muted focus:border-accent outline-none">
                    <option value="">Todos os portais ({portaisPresentes.reduce((s, [, n]) => s + n, 0)})</option>
                    {portaisPresentes.map(([id, n]) => (
                      <option key={id} value={id}>{selo(id).label} ({n})</option>
                    ))}
                  </select>
                  <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="w-full text-[11px] bg-bg3 border border-subtle rounded-md px-2 py-1 text-muted focus:border-accent outline-none">
                    <option value="">Todas as categorias</option>
                    {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                {/* Lista (paginada — ver POR_PAGINA) */}
                <div className="flex-1 overflow-y-auto min-h-0">
                  {filtrados.length === 0 ? (
                    <div className="p-6 text-center text-[12px] text-faint">
                      <InboxIcon size={22} className="mx-auto mb-2 opacity-60" />
                      Nada neste filtro.
                    </div>
                  ) : visiveis.map((p) => {
                    const ativo = selId === p.id
                    const imp = !!flags[p.id]?.importante
                    const s = selo(p.portal)
                    return (
                      <button key={p.id} onClick={() => abrirProcesso(p)}
                        className={clsx('w-full text-left px-3 py-2.5 border-b border-subtle/70 transition-colors',
                          ativo ? 'bg-accent/10' : 'hover:bg-bg3',
                          p.naoLidas > 0 && !ativo && 'bg-accent/[0.04]',
                          p.mutado && 'opacity-55')}>
                        {/* Nº do processo + data (formato do benchmark) */}
                        <div className="flex items-baseline gap-2">
                          {p.prioridadeAlta && <span title="Prioridade alta"><AlertTriangle size={11} className="text-red flex-shrink-0" /></span>}
                          {imp && <Star size={11} className="text-amber fill-amber flex-shrink-0" />}
                          <span className={clsx('text-[12px] font-mono-custom truncate flex-1', p.naoLidas > 0 ? 'text-strong font-semibold' : 'text-muted')}>
                            {p.licitacaoId || '—'}
                          </span>
                          <span className="text-[9.5px] font-mono-custom text-faint flex-shrink-0">
                            {p.ultima ? carimbo(p.ultima) : dataCurta(p.prazo)}
                          </span>
                        </div>
                        {/* Órgão */}
                        <div className="text-[11.5px] text-strong/80 truncate mt-1">{p.orgao || p.titulo || 'Órgão não informado'}</div>
                        {/* Selo do portal + prévia */}
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <span className={clsx('text-[8.5px] font-mono-custom uppercase tracking-wide border px-1.5 py-0.5 rounded flex-shrink-0', s.cls)}>{s.label}</span>
                          {p.mutado && <span className="text-[8.5px] font-mono-custom uppercase tracking-wide bg-bg4 text-faint px-1.5 py-0.5 rounded flex-shrink-0">desativado</span>}
                          {p.naoLidas > 0 && <span className="text-[9px] font-mono-custom bg-accent text-black font-bold px-1.5 rounded-full flex-shrink-0">{p.naoLidas}</span>}
                          <span className="text-[10px] text-faint truncate flex-1">
                            {p.ultima
                              ? `${p.ultima.autor || '—'}: ${p.ultima.texto}`
                              : capturaNuncaLigou ? 'Chat não monitorado — conector não conectado' : 'Sem mensagem capturada ainda'}
                          </span>
                        </div>
                      </button>
                    )
                  })}

                  {restantes > 0 && (
                    <button onClick={() => setPagina((p) => p + 1)}
                      className="w-full text-[11.5px] text-accent hover:bg-bg3 py-3 transition-colors">
                      Mostrar mais {Math.min(POR_PAGINA, restantes)} ({restantes} restantes)
                    </button>
                  )}
                </div>

                {/* Rodapé de contagem: com paginação, o usuário precisa saber que a
                    lista não acabou — e quanto do total ele está vendo. */}
                <div className="px-3 py-2 border-t border-subtle text-[10px] font-mono-custom text-faint flex-shrink-0">
                  {visiveis.length} de {filtrados.length}
                  {filtrados.length !== contagem.todos && ` (${contagem.todos} monitorados)`}
                </div>
              </div>

              {/* ── Direita: a conversa ─────────────────────────────────────── */}
              <div className="flex flex-col min-h-0">
                {!selecionado ? (
                  <div className="flex-1 flex items-center justify-center text-center p-8">
                    <div>
                      <MessageSquare size={26} className="text-faint mx-auto mb-2 opacity-60" />
                      <p className="text-[13px] text-muted">Selecione um pregão à esquerda</p>
                      <p className="text-[11px] text-faint mt-1">As mensagens do chat (pregoeiro, fornecedores, sistema) aparecem aqui.</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Cabeçalho: nº / órgão / prazo + ações */}
                    <div className="px-4 py-3 border-b border-subtle flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h2 className="font-heading font-bold text-[14px] text-strong font-mono-custom truncate">{selecionado.licitacaoId || '—'}</h2>
                          <span className={clsx('text-[8.5px] font-mono-custom uppercase tracking-wide border px-1.5 py-0.5 rounded flex-shrink-0', selo(selecionado.portal).cls)}>
                            {selo(selecionado.portal).label}
                          </span>
                          <span className={clsx('text-[8.5px] font-mono-custom uppercase tracking-wide px-1.5 py-0.5 rounded flex-shrink-0',
                            selecionado.situacao === 'encerrada' ? 'bg-bg4 text-faint' : 'bg-emerald-500/15 text-emerald-300')}>
                            {selecionado.situacao === 'encerrada' ? 'encerrada' : 'aberta'}
                          </span>
                        </div>
                        <p className="text-[11.5px] text-muted mt-1 truncate">Órgão: {selecionado.orgao || '—'}</p>
                        <p className="text-[11px] text-faint mt-0.5 truncate">
                          Datas: Prazo: {prazoLongo(selecionado.prazo)} · {selecionado.mensagens.length} mensagens
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => marcarTodasLidas(selecionado)} disabled={selecionado.naoLidas === 0} title="Marcar todas como lidas"
                          className={clsx('p-1.5 rounded-md transition-colors', selecionado.naoLidas === 0 ? 'text-faint/40' : 'text-faint hover:text-emerald-400 hover:bg-bg3')}><CheckCheck size={15} /></button>
                        <button onClick={() => void carregar(true)} title="Atualizar" disabled={atualizando}
                          className="p-1.5 rounded-md text-faint hover:text-accent hover:bg-bg3 transition-colors disabled:opacity-50">
                          <RefreshCw size={15} className={atualizando ? 'animate-spin' : ''} /></button>
                        <button onClick={() => setFlag(selecionado.id, { importante: !flags[selecionado.id]?.importante })} title="Importante"
                          className={clsx('p-1.5 rounded-md transition-colors hover:bg-bg3', flags[selecionado.id]?.importante ? 'text-amber' : 'text-faint hover:text-amber')}>
                          <Star size={15} className={flags[selecionado.id]?.importante ? 'fill-amber' : ''} /></button>
                        <Kebab
                          processo={selecionado}
                          onDetalhes={() => setDetalhes(selecionado)}
                          onMonitoramento={() => void alternarMonitoramento(selecionado)}
                          onArquivar={() => { const arq = !flags[selecionado.id]?.arquivado; setFlag(selecionado.id, { arquivado: arq }); if (arq) setSelId(null) }}
                          arquivado={!!flags[selecionado.id]?.arquivado}
                        />
                      </div>
                    </div>

                    {/* Abas: Mensagens do chat + lote */}
                    <div className="px-4 py-2 border-b border-subtle flex items-center gap-3 flex-wrap">
                      <span className="text-[12px] font-semibold text-strong">Mensagens do chat</span>
                      {lotes.length > 0 ? (
                        <>
                          <select value={lote} onChange={(e) => setLote(e.target.value)}
                            className="text-[11.5px] bg-bg3 border border-subtle rounded-md px-2 py-1 text-muted focus:border-accent outline-none">
                            <option value="">Todos os lotes</option>
                            {lotes.map((l) => <option key={l} value={l}>{l}</option>)}
                          </select>
                          <span className="text-[10.5px] text-faint">{mensagensVisiveis.length} de {selecionado.mensagens.length}</span>
                        </>
                      ) : (
                        <span className="text-[10.5px] text-faint">Este portal não separa o chat por lote.</span>
                      )}
                      {config.escopo === 'palavra_chave' && (
                        <span className="text-[10px] text-amber ml-auto">Avisando só com palavra-chave</span>
                      )}
                    </div>

                    {/* Mensagens */}
                    <div className="flex-1 overflow-y-auto min-h-0 p-4 bg-bg">
                      {mensagensVisiveis.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-center">
                          <div>
                            <MessageSquare size={22} className="text-faint mx-auto mb-2 opacity-50" />
                            <p className="text-[12px] text-muted">Nenhuma mensagem capturada neste pregão ainda</p>
                            {/* Não afirmar "monitoramento ativo" sem conector conectado. */}
                            <p className="text-[11px] text-faint mt-1 max-w-[380px]">
                              {capturaNuncaLigou
                                ? 'O chat deste pregão não está sendo lido: nenhum conector foi conectado ainda. Conecte um portal para começar a captura.'
                                : 'O monitoramento está ativo — assim que o pregoeiro escrever no chat, aparece aqui.'}
                            </p>
                          </div>
                        </div>
                      ) : mensagensVisiveis.map((m) => {
                        const papel = papelAutor(m.autor)
                        return (
                          <div key={m.id} className="mb-3">
                            {/* Autor (rótulo acima do balão, como no benchmark) */}
                            <div className={clsx('text-[11px] font-semibold uppercase tracking-wide mb-1', PAPEL_CLS[papel])}>
                              {m.autor || PAPEL_LABEL[papel]}
                            </div>
                            <div className={clsx('rounded-lg border p-3', m.prioridade === 'alta' ? 'border-red/30 bg-red/[0.04]' : 'border-subtle bg-bg2')}>
                              <p className="text-[12.5px] text-strong whitespace-pre-wrap leading-snug">
                                <TextoDestacado texto={m.texto} chaves={chaves} />
                              </p>
                              {(m.categorias.length > 0 || m.anexos?.length > 0) && (
                                <div className="flex items-center gap-1.5 flex-wrap mt-2">
                                  {m.categorias.map((c) => <span key={c} className="text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full bg-bg4 text-faint">{c}</span>)}
                                  {m.anexos?.map((a, i) => (
                                    <span key={i} className="inline-flex items-center gap-1 text-[10px] text-emerald-300">
                                      <Paperclip size={10} />{a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{a.nome}</a> : a.nome}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            {/* Carimbo de hora à direita, abaixo do balão */}
                            <div className="text-[10px] font-mono-custom text-faint text-right mt-1">{carimbo(m)}</div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {data && (
            <p className="text-[10px] text-faint mt-3">
              Os pregões são selecionados automaticamente pelo seu perfil (UFs, categorias, termos e portfólio) — ajuste em Perfil &amp; Preferências.
              A captura de chat depende de um conector ativo: &quot;sem novidades&quot; só é confiável quando o conector está verde acima.
              Palavras-chave e notificações ficam em <Link href="/radar/configuracoes" className="text-accent hover:underline">Configurações gerais</Link>.
              Marcações de <strong>Importante</strong> e <strong>Arquivado</strong> ficam neste navegador.
            </p>
          )}
        </main>

        {conectar && <ConectarModal capacidades={capacidades} onClose={() => setConectar(false)} onSaved={() => { setConectar(false); void carregar() }} />}
        {detalhes && <DetalhesModal processo={detalhes} onClose={() => setDetalhes(null)} />}
      </div>
    </div>
  )
}

/** Bip curto via WebAudio — evita depender de arquivo de áudio hospedado. */
function beep() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35)
    osc.start(); osc.stop(ctx.currentTime + 0.36)
    osc.onended = () => void ctx.close()
  } catch { /* autoplay bloqueado até o usuário interagir */ }
}

/** Texto da mensagem com as palavras-chave monitoradas pintadas. */
function TextoDestacado({ texto, chaves }: { texto: string; chaves: string[] }) {
  const trechos = useMemo(() => destacar(texto, chaves), [texto, chaves])
  return (
    <>
      {trechos.map((t, i) =>
        t.tipo === null ? <span key={i}>{t.texto}</span> : (
          <mark key={i} className={clsx('rounded px-0.5',
            t.tipo === 'chave' ? 'bg-amber/30 text-amber-100' : 'bg-emerald-500/25 text-emerald-100')}>
            {t.texto}
          </mark>
        ))}
    </>
  )
}

/** Menu ⋮ da conversa: Informações · Acessar local da disputa · Desativar monitoramento. */
function Kebab({ processo, onDetalhes, onMonitoramento, onArquivar, arquivado }: {
  processo: Processo; onDetalhes: () => void; onMonitoramento: () => void; onArquivar: () => void; arquivado: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const cx = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => { if (cx.current && !cx.current.contains(e.target as Node)) setAberto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc) }
  }, [aberto])

  const Item = ({ children, onClick, icone }: { children: React.ReactNode; onClick: () => void; icone: React.ReactNode }) => (
    <button onClick={() => { onClick(); setAberto(false) }}
      className="w-full flex items-center gap-2 text-left text-[12px] text-muted hover:text-strong hover:bg-bg3 px-3 py-2 transition-colors">
      {icone}{children}
    </button>
  )

  return (
    <div className="relative" ref={cx}>
      <button onClick={() => setAberto((a) => !a)} title="Mais ações"
        className={clsx('p-1.5 rounded-md transition-colors hover:bg-bg3', aberto ? 'text-strong bg-bg3' : 'text-faint hover:text-strong')}>
        <MoreVertical size={15} />
      </button>
      {aberto && (
        <div className="absolute right-0 top-full mt-1 z-20 w-[236px] bg-bg2 border border-subtle rounded-lg shadow-xl overflow-hidden py-1">
          <Item onClick={onDetalhes} icone={<Info size={13} />}>Informações da licitação</Item>
          {/* Prefere a URL do PORTAL de origem; cai no link do PNCP quando o PNCP
              não informou o sistema (acontece em ~metade dos registros). */}
          {(processo.linkOrigem || processo.linkPortal) ? (
            <a href={processo.linkOrigem || processo.linkPortal!} target="_blank" rel="noopener noreferrer" onClick={() => setAberto(false)}
              className="w-full flex items-center gap-2 text-left text-[12px] text-muted hover:text-strong hover:bg-bg3 px-3 py-2 transition-colors">
              <ExternalLink size={13} />Acessar local da disputa
            </a>
          ) : (
            <span className="w-full flex items-center gap-2 text-[12px] text-faint/60 px-3 py-2 cursor-not-allowed">
              <ExternalLink size={13} />Sem link do portal
            </span>
          )}
          <Item onClick={onArquivar} icone={arquivado ? <ArchiveRestore size={13} /> : <Archive size={13} />}>
            {arquivado ? 'Desarquivar' : 'Arquivar'}
          </Item>
          <div className="border-t border-subtle my-1" />
          <Item onClick={onMonitoramento} icone={processo.mutado ? <Bell size={13} /> : <BellOff size={13} />}>
            {processo.mutado ? 'Ativar monitoramento' : 'Desativar monitoramento'}
          </Item>
        </div>
      )}
    </div>
  )
}

/** Modal "Detalhes da licitação" (kebab → Informações da licitação). */
function DetalhesModal({ processo, onClose }: { processo: Processo; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div onClick={(e) => e.stopPropagation()} className="relative bg-bg2 border border-subtle rounded-2xl w-full max-w-[620px] p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <h3 className="font-heading font-bold text-[16px] text-strong">Detalhes da licitação</h3>
          <button onClick={onClose} className="text-faint hover:text-strong"><X size={18} /></button>
        </div>

        <div className="space-y-4">
          <Campo2 label="Objeto">
            <p className="text-[12.5px] text-strong leading-snug">{processo.titulo || '—'}</p>
          </Campo2>

          <div className="grid grid-cols-2 gap-4">
            <Campo2 label="Datas">
              <p className="text-[12.5px] text-strong">Abertura: {dataCurta(processo.abertura)}</p>
              <p className="text-[12.5px] text-strong">Prazo: {prazoLongo(processo.prazo)}</p>
            </Campo2>
            <Campo2 label="Situação">
              <span className={clsx('inline-block text-[10px] font-mono-custom uppercase tracking-wide px-2 py-1 rounded',
                processo.situacao === 'encerrada' ? 'bg-bg4 text-faint' : 'bg-emerald-500/15 text-emerald-300')}>
                {processo.situacao === 'encerrada' ? 'encerrada' : 'aberta'}
              </span>
            </Campo2>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Campo2 label="Nº do processo (PNCP)">
              <p className="text-[12.5px] text-strong font-mono-custom break-all">{processo.licitacaoId || '—'}</p>
            </Campo2>
            <Campo2 label="Portal">
              <span className={clsx('inline-block text-[10px] font-mono-custom uppercase tracking-wide border px-2 py-1 rounded', selo(processo.portal).cls)}>
                {selo(processo.portal).label}
              </span>
            </Campo2>
          </div>

          <Campo2 label="Órgão">
            <p className="text-[12.5px] text-strong leading-snug">{processo.orgao || '—'}</p>
          </Campo2>

          <div className="grid grid-cols-3 gap-4">
            <Campo2 label="Município / UF">
              <p className="text-[12.5px] text-strong">{[processo.municipio, processo.uf].filter(Boolean).join(' - ') || '—'}</p>
            </Campo2>
            <Campo2 label="Modalidade">
              <p className="text-[12.5px] text-strong">{processo.modalidade || '—'}</p>
            </Campo2>
            <Campo2 label="Valor estimado">
              <p className="text-[12.5px] text-strong">{moeda(processo.valor)}</p>
            </Campo2>
          </div>
        </div>

        <div className="flex justify-between items-center mt-6">
          {(processo.linkOrigem || processo.linkPortal) ? (
            <a href={processo.linkOrigem || processo.linkPortal!} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[12px] text-accent hover:underline">
              <ExternalLink size={13} /> Acessar local da disputa
              {processo.linkOrigem && <span className="text-faint">({selo(processo.portal).label})</span>}
            </a>
          ) : <span />}
          <button onClick={onClose} className="text-[12px] px-4 py-2 rounded-md border border-subtle2 text-muted hover:text-strong">Fechar</button>
        </div>
      </div>
    </div>
  )
}

function Campo2({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1">{label}</div>
      {children}
    </div>
  )
}

function Kpi({ label, valor, destaque }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div className={clsx('bg-bg2 border rounded-xl p-4', destaque ? 'border-accent/30' : 'border-subtle')}>
      <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1.5">{label}</div>
      <div className={clsx('font-heading font-bold text-[22px] leading-none', destaque ? 'text-accent' : 'text-strong')}>{valor}</div>
    </div>
  )
}

type Fase = 'form' | 'live' | 'conectando' | 'ok' | 'erro'

function ConectarModal({ capacidades, onClose, onSaved }: {
  capacidades: { cofre: boolean; hosted: boolean }; onClose: () => void; onSaved: () => void
}) {
  const [conectorId, setConectorId] = useState('comprasgov')
  const [cnpj, setCnpj] = useState('')
  const [login, setLogin] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [fase, setFase] = useState<Fase>('form')
  const [demorou, setDemorou] = useState(false)
  const [embedUrl, setEmbedUrl] = useState<string | null>(null)
  const [capturando, setCapturando] = useState(false)
  // Modo público (PCP): monitora pela página pública, sem login. Campos próprios.
  const [pubObjeto, setPubObjeto] = useState('')
  const [pubUf, setPubUf] = useState('')
  const [pubLink, setPubLink] = useState('')
  const publico = conectorPublico(conectorId)
  const nomeSel = CONECTORES.find((c) => c.id === conectorId)?.nome ?? conectorId
  const credId = useRef<string | null>(null)
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)
  const t0 = useRef<number>(0)

  const pararPoll = () => { if (poll.current) { clearInterval(poll.current); poll.current = null } }
  useEffect(() => () => pararPoll(), [])

  async function criarCred(): Promise<string | null> {
    if (credId.current) return credId.current
    const r = await fetch('/api/radar/credenciais', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conectorId, cnpj, login }),
    })
    const j = await r.json()
    if (!r.ok) { setErro(j.instrucoes || j.error || 'Falha ao registrar'); return null }
    credId.current = j.id
    return j.id
  }

  // Abre o gov.br no navegador HOSPEDADO (live view no iframe). Se o hosted não
  // estiver configurado (503), cai no fluxo local (fila + serviço de conexão).
  async function iniciarHosted(id: string): Promise<'live' | 'fallback' | 'erro'> {
    const r = await fetch('/api/radar/conexao', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credencialId: id, acao: 'iniciar' }),
    })
    if (r.status === 503) return 'fallback'
    const j = await r.json()
    if (r.ok && j.embedUrl) { setEmbedUrl(j.embedUrl); return 'live' }
    setErro(j.error || j.detalhe || 'Falha ao abrir o gov.br'); return 'erro'
  }

  async function concluirLogin() {
    if (!credId.current) return
    setCapturando(true); setErro(null)
    try {
      const r = await fetch('/api/radar/conexao', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credencialId: credId.current, acao: 'capturar' }),
      })
      const j = await r.json()
      if (j.conexao === 'conectado') { setFase('ok'); setTimeout(onSaved, 1200) }
      else if (j.aviso) setErro('Conclua o login no gov.br dentro da janela antes de confirmar.')
      else setErro(j.error || j.detalhe || 'Não foi possível capturar a sessão.')
    } catch { setErro('Falha de rede') } finally { setCapturando(false) }
  }

  async function cancelarLive() {
    if (credId.current) { void fetch('/api/radar/conexao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credencialId: credId.current, acao: 'cancelar' }) }) }
    setEmbedUrl(null); setFase('form')
  }

  function iniciarPoll() {
    t0.current = Date.now()
    setDemorou(false)
    pararPoll()
    poll.current = setInterval(async () => {
      try {
        const r = await fetch('/api/radar/credenciais')
        const j = await r.json()
        const c = (j.credenciais ?? []).find((x: { id: string }) => x.id === credId.current)
        if (!c) return
        if (c.conexao?.status === 'conectado') { pararPoll(); setFase('ok'); setTimeout(onSaved, 1200) }
        else if (c.conexao?.status === 'erro') { pararPoll(); setErro(c.conexao?.detalhe || 'Não foi possível concluir o login.'); setFase('erro') }
        else if (Date.now() - t0.current > 360_000) {
          // Timeout de segurança: nunca ficar "Abrindo…" para sempre.
          pararPoll(); setErro('Não recebemos a confirmação do login a tempo. Verifique se a janela do gov.br abriu e tente de novo.'); setFase('erro')
        } else if (Date.now() - t0.current > 90_000) setDemorou(true)
      } catch { /* rede: tenta no próximo tick */ }
    }, 2500)
  }

  // PCP público: adiciona o processo (objeto + UF + link opcional). Sem login: o
  // worker resolve a URL pública (ou usa o link colado) e lê o andamento.
  async function adicionarPublico() {
    if (!pubObjeto.trim()) { setErro('Informe o objeto/título da licitação.'); return }
    setSalvando(true); setErro(null)
    try {
      const r = await fetch('/api/radar/processos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conectorId, titulo: pubObjeto.trim(), uf: pubUf.trim(), linkPortal: pubLink.trim() || undefined }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErro(j.error || 'Falha ao adicionar'); return }
      setFase('ok'); setTimeout(onSaved, 1200)
    } catch { setErro('Falha de rede') } finally { setSalvando(false) }
  }

  async function conectar() {
    setSalvando(true); setErro(null)
    try {
      const id = await criarCred()
      if (!id) { setSalvando(false); return }
      // Preferência: navegador HOSPEDADO (login dentro da tela).
      const res = await iniciarHosted(id)
      if (res === 'live') { setFase('live'); setSalvando(false); return }
      if (res === 'erro') { setSalvando(false); return }
      // Fallback (hosted não configurado): fluxo local via serviço de conexão.
      const rc = await fetch(`/api/radar/credenciais/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'conectar' }),
      })
      if (!rc.ok) { const j = await rc.json(); setErro(j.error || 'Falha ao iniciar a conexão'); setSalvando(false); return }
      setFase('conectando'); iniciarPoll()
    } catch { setErro('Falha de rede') } finally { setSalvando(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => { pararPoll(); onClose() }}>
      <div className="absolute inset-0 bg-black/50" />
      <div onClick={(e) => e.stopPropagation()} className={clsx('relative bg-bg2 border border-subtle rounded-2xl w-full p-6', fase === 'live' ? 'max-w-[820px]' : 'max-w-[440px]')}>
        <div className="flex items-center justify-between mb-1"><h3 className="font-heading font-bold text-[16px] text-strong">Conectar portal</h3><button onClick={() => { pararPoll(); onClose() }} className="text-faint hover:text-strong"><X size={18} /></button></div>

        {fase === 'live' ? (
          <div className="mt-2">
            <p className="text-[12px] text-muted mb-3">
              Faça o login na página oficial do <strong className="text-strong">gov.br</strong> abaixo (CPF, senha, 2FA).
              Ao concluir, clique em <strong className="text-strong">&ldquo;Já concluí o login&rdquo;</strong>. A senha é digitada no gov.br — nós guardamos só a sessão cifrada.
            </p>
            <div className="rounded-lg border border-subtle overflow-hidden bg-black/20">
              {embedUrl && (
                <iframe
                  src={embedUrl}
                  title="Login gov.br"
                  className="w-full h-[440px] block"
                  allow="clipboard-read; clipboard-write"
                  sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
                />
              )}
            </div>
            {erro && <p className="text-[12px] text-amber mt-3">{erro}</p>}
            <div className="flex justify-between items-center mt-4">
              <button onClick={cancelarLive} className="text-[12px] px-3 py-2 rounded-md border border-subtle2 text-muted hover:text-strong">Cancelar</button>
              <button onClick={concluirLogin} disabled={capturando} className="flex items-center gap-1.5 text-[12px] px-4 py-2 rounded-md bg-accent text-black font-semibold disabled:opacity-50">
                {capturando && <Loader2 size={13} className="animate-spin" />} Já concluí o login
              </button>
            </div>
          </div>
        ) : fase === 'ok' ? (
          <div className="mt-4 text-center py-4">
            <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-3"><Check size={24} className="text-emerald-400" /></div>
            <p className="text-[14px] font-semibold text-strong">{publico ? 'Processo adicionado' : 'Conectado ao gov.br'}</p>
            <p className="text-[12px] text-muted mt-1">{publico
              ? 'Sem login: o Radar vai buscar a página pública do processo e trazer o andamento (convocação, habilitação, recurso, prazo, homologação).'
              : 'A sessão foi capturada com segurança. O Radar já vai monitorar o chat dos seus processos.'}</p>
          </div>
        ) : fase === 'conectando' ? (
          <div className="mt-4 text-center py-4">
            <Loader2 size={28} className="text-accent animate-spin mx-auto mb-3" />
            <p className="text-[14px] font-semibold text-strong">Abrindo o gov.br…</p>
            <p className="text-[12px] text-muted mt-1 max-w-[320px] mx-auto">
              Conclua o login na janela do <strong className="text-strong">gov.br</strong> (CPF, senha, 2FA). Assim que entrar,
              esta tela confirma a conexão automaticamente.
            </p>
            {demorou && <p className="text-[11px] text-amber mt-3">Está demorando — confirme que a janela do gov.br abriu e que o login foi concluído.</p>}
            <button onClick={() => { pararPoll(); setFase('form') }} className="text-[11px] text-faint hover:text-strong mt-4">Cancelar</button>
          </div>
        ) : (
          <>
            {/* Catálogo de portais (fonte: lib/radar/conectores). */}
            <div className="mb-4 mt-1">
              <span className="text-[11px] text-faint">Portal</span>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {CONECTORES.map((c) => {
                  const ativo = conectorId === c.id
                  return (
                    <button key={c.id} type="button" onClick={() => setConectorId(c.id)}
                      className={clsx('text-left rounded-lg border px-3 py-2 transition-colors',
                        ativo ? 'border-accent bg-accent/10' : 'border-subtle2 bg-bg3 hover:border-subtle')}>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[12px] font-semibold text-strong">{c.nome}</span>
                        {c.modoPublico
                          ? <span className="text-[8px] font-mono-custom uppercase tracking-wide bg-accent/20 text-accent px-1 py-0.5 rounded flex-shrink-0">sem login</span>
                          : !c.disponivel && <span className="text-[8px] font-mono-custom uppercase tracking-wide bg-bg4 text-faint px-1 py-0.5 rounded flex-shrink-0">em breve</span>}
                      </div>
                      <div className="text-[10px] text-muted mt-0.5 leading-snug">{c.descricao}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {publico ? (
              <>
                <p className="text-[12px] text-muted mb-4">
                  O {nomeSel} publica o <strong className="text-strong">andamento de cada processo</strong> numa página pública —
                  monitoramos <strong className="text-strong">sem login</strong>. Informe o objeto e a UF; nós achamos o processo
                  automaticamente. Se não acharmos com segurança, cole o link do processo no portal.
                </p>
                <div className="space-y-3">
                  <Campo label="Objeto / título da licitação" value={pubObjeto} onChange={setPubObjeto} placeholder="ex.: aquisição de medicamentos para a farmácia básica" />
                  <Campo label="UF (opcional, ajuda a achar)" value={pubUf} onChange={(v) => setPubUf(v.toUpperCase().slice(0, 2))} placeholder="ex.: SP" />
                  <Campo label="Link do processo no PCP (opcional — fallback)" value={pubLink} onChange={setPubLink} placeholder="cole aqui se souber a URL exata do processo" />
                </div>
                <p className="text-[11px] text-faint mt-3 leading-snug">
                  A sala <strong>ao vivo</strong> (lances em tempo real) usa a sua própria sessão do portal e entra numa próxima etapa —
                  o andamento público já avisa convocação, habilitação, recurso, prazo e homologação.
                </p>
              </>
            ) : conectorDisponivel(conectorId) && !capacidades.cofre ? (
              /* Sem RADAR_CRED_KEY no ambiente, POST /api/radar/credenciais devolve 503:
                 o formulário só levaria a um erro. Diz a verdade em vez de pedir dados. */
              <div className="bg-amber/10 border border-amber/30 rounded-lg px-3 py-2.5 text-[12px] text-amber leading-snug">
                A conexão por <strong>login do gov.br</strong> está desligada neste ambiente: o cofre que guarda a
                sessão cifrada (<span className="font-mono-custom">RADAR_CRED_KEY</span>) não está configurado, e sem
                ele não temos onde guardar a sua sessão com segurança. O{' '}
                <strong>Portal de Compras Públicas</strong> monitora <strong>sem login</strong> e já funciona —
                selecione ele acima.
              </div>
            ) : conectorDisponivel(conectorId) ? (
              <>
                <p className="text-[12px] text-muted mb-4">
                  O login é feito na <strong className="text-strong">página oficial do gov.br</strong> — não digitamos nem
                  guardamos a sua senha aqui. Guardamos só a <strong className="text-strong">sessão (cookies) cifrada</strong>,
                  usada para ler o chat dos seus processos. Você pode desconectar quando quiser.
                </p>
                <div className="space-y-3">
                  <Campo label="CNPJ do fornecedor" value={cnpj} onChange={setCnpj} placeholder="00.000.000/0000-00" />
                  <Campo label="CPF ou login gov.br (identificação)" value={login} onChange={setLogin} placeholder="para identificar a conexão — a senha fica no gov.br" />
                </div>
              </>
            ) : (
              <div className="bg-amber/10 border border-amber/30 rounded-lg px-3 py-2.5 text-[12px] text-amber leading-snug">
                Este portal já está no modelo de dados e na seleção por perfil — a captura de chat entra na{' '}
                <strong>próxima etapa</strong>, quando calibrarmos o login e os seletores dele. Por ora, use o{' '}
                <strong>Compras.gov.br</strong> ou o <strong>Portal de Compras Públicas</strong> (sem login).
              </div>
            )}

            {erro && <p className="text-[12px] text-red mt-3">{erro}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => { pararPoll(); onClose() }} className="text-[12px] px-3 py-2 rounded-md border border-subtle2 text-muted hover:text-strong">Cancelar</button>
              {publico ? (
                <button onClick={adicionarPublico} disabled={salvando || !pubObjeto.trim()} className="flex items-center gap-1.5 text-[12px] px-4 py-2 rounded-md bg-accent text-black font-semibold disabled:opacity-50">
                  {salvando && <Loader2 size={13} className="animate-spin" />} Monitorar sem login
                </button>
              ) : (
                <button onClick={conectar} disabled={!conectorDisponivel(conectorId) || !capacidades.cofre || salvando || !cnpj || !login} className="flex items-center gap-1.5 text-[12px] px-4 py-2 rounded-md bg-accent text-black font-semibold disabled:opacity-50">
                  {salvando && <Loader2 size={13} className="animate-spin" />} Continuar para o gov.br
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Campo({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block">
      <span className="text-[11px] text-faint">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1 w-full text-[13px] bg-bg3 border border-subtle rounded-md px-3 py-2 text-strong focus:border-accent outline-none" />
    </label>
  )
}
