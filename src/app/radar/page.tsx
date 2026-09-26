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
  Radar, AlertTriangle, ExternalLink, X, Plus, Bell,
  Search, Star, Archive, ArchiveRestore, CheckCheck, MessageSquare, Paperclip,
  Inbox as InboxIcon, MoreVertical, RefreshCw, Info, BellOff, Settings, Gavel,
} from 'lucide-react'
import { LEITORES } from '@/lib/radar/conectores'
import { destacar, temChave } from '@/lib/radar/destaque'
import { chatSoNoPortal, situacaoLeitura } from '@/lib/radar/chat-externo.mjs'
import { nomePortal } from '@/lib/portais'
import { CONFIG_PADRAO, type ConfigRadar } from '@/lib/radar/config'
import SaudeConectores, { type SaudeItem } from './components/SaudeConectores'
import AdicionarPregao from './components/AdicionarPregao'
import { SetupFilterHint } from '@/components/ui/SetupFilterHint'
import { Paginacao } from '@/components/ui/Paginacao'

const CATEGORIAS = ['convocacao', 'negociacao', 'proposta_ajustada', 'habilitacao', 'diligencia', 'recurso', 'prazo', 'status_processo', 'resultado_lote', 'cnpj']

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
  /** O fornecedor disse que entrou NESTE pregao. Nao e deducao nossa — ver schema-radar.sql. */
  participando: boolean
  linkPortal: string | null; atualizadoEm: string
  orgao: string | null; municipio: string | null; modalidade: string | null
  /** null = sem par no PNCP (adicionado por link): a situação é desconhecida. */
  prazo: string | null; abertura: string | null; situacao: 'aberta' | 'encerrada' | null; meu: boolean
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
  /** Recorte do Setup da Empresa aplicado pelo servidor nesta resposta. */
  setupFiltro?: { aplicado: boolean; ufs: string[]; categorias: string[] }
  atualizadoEm: string
}

/** Pregão + sua conversa, já ordenada. */
interface Processo extends ProcessoApi {
  mensagens: Mensagem[]
  /**
   * Card montado SO a partir das mensagens, porque o processo nao veio na lista da
   * rota. Nao tem orgao, prazo, situacao nem `participando` — e quem depende desses
   * campos precisa saber que eles nao existem, em vez de ler o valor inventado.
   */
  orfao: boolean
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
      orfao: false,
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
      // `false` aqui NAO e medicao, e o valor que sobrou por nao termos o processo.
      // `orfao: true` ao lado e o que impede a tela de trata-lo como resposta.
      participando: false, orfao: true,
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

// O nº de controle do PNCP: "02451938000153-1-000190/2026".
const NUMERO_PNCP = /^\d{14}-\d-\d{6}\/\d{4}$/
/**
 * O que o cartão mostra no lugar do nº do processo. Pregão adicionado à mão sem par no
 * PNCP não tem esse número, e o id interno (`bll:link:…`, `comprasgov:publico:…`) não diz
 * nada a quem lê; o objeto e o portal aparecem nas linhas de baixo.
 */
function numeroExibido(p: { licitacaoId: string; origem: string }): string {
  if (NUMERO_PNCP.test(p.licitacaoId) || p.origem !== 'manual') return p.licitacaoId || '—'
  return 'Adicionado manualmente'
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

type Filtro = 'todos' | 'nao_lidas' | 'participando' | 'importantes' | 'desativados' | 'arquivados'

// Quantos cards a lista desenha por vez. A seleção é automática e rende centenas de
// pregões (o titular de teste tem 309, outro 547): montar todos de uma vez fazia cada
// toque em filtro/busca re-renderizar a lista inteira.
const POR_PAGINA = 60

const FILTRO_LABEL: Record<Filtro, string> = {
  todos: 'Todos os pregões monitorados',
  nao_lidas: 'Somente com mensagem não lida',
  participando: 'Somente em que estou participando',
  importantes: 'Somente marcados como importante',
  desativados: 'Monitoramento desativado',
  arquivados: 'Arquivados',
}

export default function RadarPage() {
  const [data, setData] = useState<Inbox | null>(null)
  /** A última leitura da caixa falhou (rede ou erro do servidor). */
  const [falhaInbox, setFalhaInbox] = useState(false)
  const [config, setConfig] = useState<ConfigRadar>(CONFIG_PADRAO)
  const [loading, setLoading] = useState(true)
  const [atualizando, setAtualizando] = useState(false)
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState('')
  const [selId, setSelId] = useState<string | null>(null)
  /** Pregão do Compras.gov.br em que a pessoa trocou o chat oficial pelas capturadas. */
  const [capturadasDe, setCapturadasDe] = useState<string | null>(null)
  const [adicionar, setAdicionar] = useState(false)
  const [flags, setFlags] = useState<Flags>({})
  const [detalhes, setDetalhes] = useState<Processo | null>(null)
  const [lote, setLote] = useState('')
  const [portalFiltro, setPortalFiltro] = useState('')
  const [pagina, setPagina] = useState(1)
  // "Tirar todos os filtros" da caixa. O ref espelha o estado porque `carregar` é
  // estável (roda no polling silencioso) e precisa do valor atual sem se recriar.
  const [semSetup, setSemSetup] = useState(false)
  const semSetupRef = useRef(false)
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
  // O recorte do Setup (estados + categorias do cliente) é aplicado no SERVIDOR —
  // sem ele a caixa mostrava os processos que a conta acumulou sob setups antigos e
  // os de outros usuários do tenant. `?setup=0` é o "ver tudo".
  const carregar = useCallback(async (silencioso = false, semSetupAgora?: boolean) => {
    if (emVoo.current) return
    emVoo.current = true
    if (silencioso) setAtualizando(true); else setLoading(true)
    try {
      const sem = semSetupAgora ?? semSetupRef.current
      const r = await fetch(`/api/radar/inbox${sem ? '?setup=0' : ''}`)
      if (!r.ok) throw new Error(String(r.status))
      const d: Inbox = await r.json()
      setData(d)
      setFalhaInbox(false)
    } catch { setFalhaInbox(true) /* mantém o que já está na tela */ } finally {
      emVoo.current = false
      setLoading(false); setAtualizando(false)
    }
  }, [])

  const trocarSetup = useCallback((sem: boolean) => {
    semSetupRef.current = sem
    setSemSetup(sem)
    void carregar(false, sem)
  }, [carregar])

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

  // UM TOQUE, SEM CONFIRMACAO. O estado troca na tela antes da resposta e volta
  // sozinho se o servidor recusar — marcar participacao e barato de desfazer, e um
  // modal de confirmacao aqui so faria o fornecedor deixar de marcar.
  async function alternarParticipacao(p: Processo) {
    const participando = !p.participando
    setData((d) => d ? { ...d, processos: d.processos.map((x) => x.id === p.id ? { ...x, participando } : x) } : d)
    try {
      const r = await fetch('/api/radar/processos', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, participando }),
      })
      if (!r.ok) throw new Error(String(r.status))
    } catch {
      setData((d) => d ? { ...d, processos: d.processos.map((x) => x.id === p.id ? { ...x, participando: !participando } : x) } : d)
    }
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

  // Dois estados diferentes, e a tela dizia a mesma coisa nos dois (REQUISITO 4.2):
  //  • semConectorOk  — nenhuma credencial verificada, então o chat dos portais que
  //    EXIGEM login (Compras.gov) não está sendo lido. Independe de já ter mensagem:
  //    o modo público (PCP) captura sem credencial.
  //  • capturaNuncaLigou — além disso, nunca chegou mensagem nenhuma. Aí "assim que o
  //    pregoeiro escrever, aparece aqui" é promessa que a instalação não cumpre.
  const semConectorOk = !!data && !data.saude.some((s) => s.status === 'ok')
  const capturaNuncaLigou = semConectorOk && data.mensagens.length === 0

  // Pregão recém-adicionado: recarrega e abre. Espera a leitura em voo terminar, porque
  // `carregar` descarta a chamada que chega durante outra (a do polling), e o pregão novo
  // só apareceria no tick seguinte, dois minutos depois. Os filtros saem do caminho: quem
  // acabou de adicionar quer ver o que adicionou.
  async function aoAdicionar(id: string) {
    for (let i = 0; i < 40 && emVoo.current; i++) await new Promise((r) => setTimeout(r, 250))
    setFiltro('todos'); setBusca(''); setCategoria(''); setPortalFiltro('')
    // "Arquivado" é marca deste navegador e esconde o pregão de "todos": colar o link de
    // um arquivado é pedir para vê-lo de novo.
    if (flags[id]?.arquivado) setFlag(id, { arquivado: false })
    setSelId(id)
    await carregar(true)
  }

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
      if (filtro === 'participando' && !p.participando) return false
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
      participando: ativos.filter((p) => p.participando).length,
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

  const visiveis = useMemo(
    () => filtrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA),
    [filtrados, pagina],
  )

  const selecionado = filtrados.find((p) => p.id === selId) ?? null
  // Chat que o Radar não lê (hoje, o Compras.gov.br): a conversa aberta ganha o aviso e
  // o botão para o site oficial, em vez de prometer captura. Ver lib/radar/chat-externo.mjs.
  const soNoPortal = selecionado && data ? chatSoNoPortal(selecionado, data.saude, LEITORES) : null
  // Nenhum coletor lê o portal deste pregão: nada de "monitoramento ativo" nem de selo
  // de palavra-chave, e a faixa diz por quê.
  const semLeitor = !!selecionado && !!data && situacaoLeitura(selecionado, data.saude, LEITORES) === 'sem_leitor'
  // Com o link público, o padrão é o CHAT OFICIAL embutido. "Capturadas" só existe para
  // pregão com histórico da época em que a sessão gov.br funcionava. Guardar o id (e não
  // um booleano) faz a escolha valer só para aquele pregão, sem efeito de reset.
  const verOficial = !!soNoPortal?.link && capturadasDe !== selecionado?.id

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

  const marcarTodasLidas = (p: Processo) => { for (const m of p.mensagens) if (!m.lida) void marcarLidaMsg(m) }
  const abrirProcesso = (p: Processo) => {
    setSelId(p.id)
    // No Compras.gov.br com link público, a vista inicial é o CHAT OFICIAL e as capturadas
    // ficam atrás da aba. Marcar como lidas aqui baixaria o contador de mensagens que a
    // pessoa nem viu; elas são marcadas quando a aba "Capturadas" abre (verCapturadas).
    // Reabrir um pregão que já estava em "Capturadas" mostra as capturadas: aí marca.
    if (data && chatSoNoPortal(p, data.saude, LEITORES)?.link && capturadasDe !== p.id) return
    marcarTodasLidas(p)
  }
  const verCapturadas = (p: Processo) => { setCapturadasDe(p.id); marcarTodasLidas(p) }

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
              {/* Era "Conectar portal", em destaque. Nenhum portal lido pede login e o
                  Compras.gov.br não tem o que conectar: sobrou só acompanhar um pregão fora
                  do perfil, que é exceção e por isso não é o botão principal da tela. */}
              <button onClick={() => setAdicionar(true)}
                className="flex items-center gap-1.5 text-[12px] px-3 py-2 rounded-md border border-subtle2 text-muted hover:text-strong hover:border-subtle transition-colors">
                <Plus size={14} /> Adicionar pregão fora do perfil
              </button>
            </div>
          </div>

          {/* REQUISITO 4.2 — banner de incerteza: nenhum portal foi lido com sucesso.
              Mandava "concluir o login do Compras.gov.br em Conectar portal", e não há
              login a concluir (o portal recusa navegador automatizado; o chat dele abre
              dentro do pregão), nem, desde 25/09/2026, um "Conectar portal". A saída é a
              verdadeira: os portais públicos são lidos sem login, na próxima passada. */}
          {semConectorOk ? (
            <div className="mb-4 flex items-start gap-2 bg-amber/10 border border-amber/30 rounded-lg px-4 py-3">
              <AlertTriangle size={16} className="text-amber flex-shrink-0 mt-0.5" />
              <p className="text-[12px] text-amber">
                <strong>Nenhum portal verificado ainda.</strong> Os pregões abaixo estão selecionados pelo seu perfil e
                são acompanhados por data e prazo, mas <strong>nenhum chat foi lido com sucesso</strong>
                {capturaNuncaLigou ? ' — nenhuma mensagem foi capturada até agora' : ''}.{' '}
                PCP, BLL, BNC, Licitanet e os demais portais públicos são lidos sem login, a cada passada do coletor.
                O chat do Compras.gov.br não é lido: ele abre dentro do pregão, na página oficial, sem alerta.
              </p>
            </div>
          ) : null}
          {/* O banner genérico de "não foi possível verificar N conector(es)" saiu daqui
              (16/09/2026). Ele dizia a mesma coisa que a faixa logo abaixo — que ainda
              por cima diz QUAL portal e POR QUÊ — e custava mais 60 px de primeira tela
              para repetir uma informação pior. O requisito 4.2 continua atendido: a
              faixa abre uma linha âmbar por conector que precisa de ação, e o contador
              dela vira "N precisa(m) de atenção" no mesmo instante. */}

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

          {/* KPIs. Os dois contadores de conector saíram daqui: a faixa de saúde logo
              abaixo diz "4 de 5 verificados" E quem é cada um — dois números soltos
              repetiam a informação e custavam metade da linha. */}
          {data && (
            <div className="grid grid-cols-2 gap-3 mb-4">
              <Kpi label="Mensagens não lidas" valor={String(data.kpis.naoLidas)} destaque={data.kpis.naoLidas > 0} />
              <Kpi label="Pregões monitorados" valor={String(data.kpis.processosAtivos)} />
            </div>
          )}

          {/* Saúde dos conectores — uma faixa, não uma grade. Ver o cabeçalho do
              componente para o porquê. */}
          <div className="mb-4">
            <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1.5">Portais</div>
            <SaudeConectores saude={(data?.saude ?? []) as SaudeItem[]} agoraMs={agoraMs} carregando={!data && !falhaInbox} falhou={!data && falhaInbox} />
          </div>

          {loading ? (
            <div className="space-y-2">{[1, 2, 3, 4].map((i) => <div key={i} className="h-12 bg-bg2 border border-subtle rounded-lg animate-pulse" />)}</div>
          ) : !data || processos.length === 0 ? (
            <div className="bg-bg2 border border-subtle rounded-2xl p-10 text-center">
              <Bell size={28} className="text-faint mx-auto mb-3" />
              <p className="text-[14px] text-strong mb-1">Nenhum pregão monitorado ainda</p>
              <p className="text-[12px] text-muted max-w-[460px] mx-auto">
                Assim que a seleção automática achar licitações do seu perfil, elas aparecem aqui —
                e as mensagens do chat entram conforme o conector captura. Falhas de leitura aparecem em Portais, acima.
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

                {/* Recorte do Setup (estados + categorias do cliente) — aplicado no servidor */}
                <div className="px-2.5 py-2 border-b border-subtle">
                  <SetupFilterHint
                    estados categorias
                    onLimpar={() => trocarSetup(true)}
                    onRestaurar={() => trocarSetup(false)}
                    limpo={semSetup}
                  />
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
                    const leituraP = data ? situacaoLeitura(p, data.saude, LEITORES) : 'lido'
                    const soPortal = data ? chatSoNoPortal(p, data.saude, LEITORES) : null
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
                            {numeroExibido(p)}
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
                          {/* A linha é um <button>; um controle dentro dela seria botão
                              aninhado (HTML inválido, e o clique de um comeria o do outro).
                              Aqui a marca só APARECE — quem alterna é o botão do cabeçalho
                              do processo aberto. */}
                          {p.participando && <span className="text-[8.5px] font-mono-custom uppercase tracking-wide bg-emerald-500/15 text-emerald-300 px-1.5 py-0.5 rounded flex-shrink-0">participando</span>}
                          {p.mutado && <span className="text-[8.5px] font-mono-custom uppercase tracking-wide bg-bg4 text-faint px-1.5 py-0.5 rounded flex-shrink-0">desativado</span>}
                          {p.naoLidas > 0 && <span className="text-[9px] font-mono-custom bg-accent text-black font-bold px-1.5 rounded-full flex-shrink-0">{p.naoLidas}</span>}
                          <span className="text-[10px] text-faint truncate flex-1">
                            {p.ultima
                              ? `${p.ultima.autor || '—'}: ${p.ultima.texto}`
                              : soPortal
                                ? (soPortal.link ? 'Chat oficial do Compras.gov.br — abra para ver' : 'Chat só no site do Compras.gov.br')
                                : leituraP === 'sem_leitor' ? 'O Radar não lê o chat deste portal'
                                  : capturaNuncaLigou ? 'Chat ainda não lido' : 'Sem mensagem capturada ainda'}
                          </span>
                        </div>
                      </button>
                    )
                  })}

                </div>

                {/* Rodapé: paginação numerada + quanto do total monitorado está no filtro */}
                <div className="border-t border-subtle flex-shrink-0">
                  <Paginacao
                    pagina={pagina} totalItens={filtrados.length} porPagina={POR_PAGINA}
                    onPagina={setPagina} rotuloItens="pregões"
                  />
                  {filtrados.length !== contagem.todos && (
                    <div className="px-3 pb-2 text-[10px] font-mono-custom text-faint">
                      {contagem.todos} monitorados no total
                    </div>
                  )}
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
                          <h2 className="font-heading font-bold text-[14px] text-strong font-mono-custom truncate">{numeroExibido(selecionado)}</h2>
                          <span className={clsx('text-[8.5px] font-mono-custom uppercase tracking-wide border px-1.5 py-0.5 rounded flex-shrink-0', selo(selecionado.portal).cls)}>
                            {selo(selecionado.portal).label}
                          </span>
                          {selecionado.situacao && (
                          <span className={clsx('text-[8.5px] font-mono-custom uppercase tracking-wide px-1.5 py-0.5 rounded flex-shrink-0',
                            selecionado.situacao === 'encerrada' ? 'bg-bg4 text-faint' : 'bg-emerald-500/15 text-emerald-300')}>
                            {selecionado.situacao === 'encerrada' ? 'encerrada' : 'aberta'}
                          </span>
                          )}
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
                        {/* "ESTOU PARTICIPANDO DESTE" — um toque, sem modal e sem confirmação.
                            A seleção automática diz o que INTERESSA ao perfil; só o fornecedor
                            sabe em quais ele de fato entrou, e nenhuma API responde isso (não
                            existe "minhas compras por CNPJ", e a participação é sigilosa até a
                            sessão). O rótulo é o que ele reconhece: ele "entra num pregão", não
                            "habilita monitoramento". */}
                        <button onClick={() => void alternarParticipacao(selecionado)}
                          disabled={selecionado.orfao}
                          title={selecionado.orfao
                            ? 'Este pregão saiu da sua seleção — a conversa continua aqui, mas não dá para marcar participação nele'
                            : selecionado.participando ? 'Você marcou que está participando deste pregão' : 'Estou participando deste pregão'}
                          aria-pressed={selecionado.participando}
                          className={clsx('p-1.5 rounded-md transition-colors',
                            selecionado.orfao ? 'text-faint/30 cursor-not-allowed'
                              : selecionado.participando ? 'text-emerald-400 bg-emerald-500/10 hover:bg-bg3'
                                : 'text-faint hover:text-emerald-400 hover:bg-bg3')}>
                          <Gavel size={15} /></button>
                        <button onClick={() => setFlag(selecionado.id, { importante: !flags[selecionado.id]?.importante })} title="Importante"
                          className={clsx('p-1.5 rounded-md transition-colors hover:bg-bg3', flags[selecionado.id]?.importante ? 'text-amber' : 'text-faint hover:text-amber')}>
                          <Star size={15} className={flags[selecionado.id]?.importante ? 'fill-amber' : ''} /></button>
                        <Kebab
                          processo={selecionado}
                          onDetalhes={() => setDetalhes(selecionado)}
                          onMonitoramento={() => void alternarMonitoramento(selecionado)}
                          onParticipacao={() => void alternarParticipacao(selecionado)}
                          onArquivar={() => { const arq = !flags[selecionado.id]?.arquivado; setFlag(selecionado.id, { arquivado: arq }); if (arq) setSelId(null) }}
                          arquivado={!!flags[selecionado.id]?.arquivado}
                        />
                      </div>
                    </div>

                    {/* Abas: Mensagens do chat + lote. No Compras.gov.br com link público, as
                        abas viram "Chat oficial" (a página do governo, embutida) e, só para
                        quem tem histórico, "Capturadas pelo Radar". */}
                    <div className="px-4 py-2 border-b border-subtle flex items-center gap-3 flex-wrap">
                      {soNoPortal?.link ? (
                        <div role="tablist" aria-label="Conversa do pregão" className="flex items-center gap-1">
                          <button type="button" role="tab" aria-selected={verOficial} onClick={() => setCapturadasDe(null)}
                            className={clsx('text-[12px] px-2.5 py-1 rounded-md transition-colors',
                              verOficial ? 'bg-accent/15 text-strong font-semibold' : 'text-muted hover:text-strong hover:bg-bg3')}>
                            Chat oficial
                          </button>
                          {selecionado.mensagens.length > 0 && (
                            <button type="button" role="tab" aria-selected={!verOficial} onClick={() => verCapturadas(selecionado)}
                              className={clsx('text-[12px] px-2.5 py-1 rounded-md transition-colors',
                                !verOficial ? 'bg-accent/15 text-strong font-semibold' : 'text-muted hover:text-strong hover:bg-bg3')}>
                              Capturadas pelo Radar ({selecionado.mensagens.length})
                              {/* Não lidas não somem ao abrir o pregão (ver abrirProcesso):
                                  a aba mostra quantas esperam, até ser aberta. */}
                              {verOficial && selecionado.naoLidas > 0 && (
                                <span className="ml-1.5 text-[9px] font-mono-custom bg-accent text-black font-bold px-1.5 rounded-full">
                                  {selecionado.naoLidas} não lida{selecionado.naoLidas === 1 ? '' : 's'}
                                </span>
                              )}
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-[12px] font-semibold text-strong">Mensagens do chat</span>
                      )}
                      {verOficial ? null : lotes.length > 0 ? (
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
                      {/* Num chat que o Radar não lê não há aviso nenhum, com ou sem palavra-chave. */}
                      {config.escopo === 'palavra_chave' && !soNoPortal && !semLeitor && (
                        <span className="text-[10px] text-amber ml-auto">Avisando só com palavra-chave</span>
                      )}
                    </div>

                    {/* CHAT OFICIAL EMBUTIDO (Compras.gov.br). Quem abre a página é o
                        navegador da própria pessoa, num quadro da tela: o captcha dela passa
                        como passaria no site, e o Radar não lê nem simula nada. Por isso a
                        faixa de cima diz, sem letra miúda, que daqui não sai alerta.
                        Ver lib/radar/chat-externo.mjs. */}
                    {/* O quadro fica MONTADO enquanto o pregão for o mesmo e só se esconde na
                        aba "Capturadas": desmontar recarregaria a página do governo e jogaria
                        fora o captcha já resolvido e o painel de mensagens aberto. */}
                    {soNoPortal?.link && (
                      <div className={clsx('flex-1 min-h-0 flex-col', verOficial ? 'flex' : 'hidden')}>
                        <div className="px-4 py-2 border-b border-amber/30 bg-amber/10 flex items-start gap-2 flex-wrap">
                          <AlertTriangle size={13} className="text-amber flex-shrink-0 mt-0.5" />
                          <p className="text-[11px] text-muted leading-snug flex-1 basis-[260px] min-w-0">
                            <strong className="text-strong">Página oficial do Compras.gov.br, aberta aqui pelo seu navegador.</strong>{' '}
                            Clique no envelope (Mensagens) e, se pedir, resolva o captcha. O Radar não lê estas mensagens nem avisa sobre elas:
                            o portal recusa navegador automatizado.
                          </p>
                          {/* Saída de emergência, e não o caminho: se o quadro não carregar
                              (bloqueio de terceiros no navegador, portal fora), a mesma
                              página abre em outra aba. */}
                          <a href={soNoPortal.link} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[11px] text-accent hover:underline flex-shrink-0">
                            <ExternalLink size={12} /> Abrir em outra aba
                          </a>
                        </div>
                        <div className="relative flex-1 min-h-[420px] bg-white">
                          {/* `key`: trocar de pregão recarrega o quadro em vez de reaproveitar
                              a página anterior. `sandbox` sem `allow-top-navigation`: a
                              página do governo não consegue tirar a pessoa do Radar; com
                              `allow-same-origin` ela mantém a PRÓPRIA origem (cookies e o
                              captcha dela), o que só é seguro porque essa origem não é a
                              nossa — nunca embutir aqui conteúdo servido pelo próprio app. */}
                          <iframe
                            key={soNoPortal.link}
                            src={soNoPortal.link}
                            title={`Chat oficial do Compras.gov.br — ${selecionado.licitacaoId}`}
                            className="absolute inset-0 w-full h-full border-0"
                            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                          />
                        </div>
                      </div>
                    )}
                    {!verOficial && (<>
                    {/* Sem o link público, ou lendo as capturadas: a faixa fica ACIMA da
                        conversa, e não só no estado vazio. Um pregão com mensagens antigas,
                        da época em que a sessão gov.br funcionava, também não recebe as
                        novas, e a pessoa precisa saber disso antes de ler o histórico. */}
                    {soNoPortal && (
                      <div className="px-4 py-3 border-b border-amber/30 bg-amber/10 flex items-start gap-3 flex-wrap">
                        <AlertTriangle size={15} className="text-amber flex-shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1 basis-[260px]">
                          <p className="text-[12px] font-semibold text-strong">
                            {soNoPortal.link ? 'Mensagens capturadas quando a leitura ainda funcionava' : 'Este chat fica só no site do Compras.gov.br'}
                          </p>
                          <p className="text-[11px] text-muted mt-0.5 leading-snug">
                            {soNoPortal.link
                              ? 'As novas ficam só no chat oficial: o portal pede captcha e recusa navegador automatizado, então o Radar não lê nem avisa sobre elas.'
                              : 'O portal pede captcha e recusa navegador automatizado, então o Radar não lê estas mensagens nem avisa sobre elas. Não temos o link público de acompanhamento desta compra para abri-la aqui.'}
                          </p>
                        </div>
                        {soNoPortal.link ? (
                          <button type="button" onClick={() => setCapturadasDe(null)}
                            className="flex items-center gap-1.5 text-[12px] px-3 py-2 rounded-md bg-accent text-black font-semibold hover:bg-accent2 transition-colors flex-shrink-0">
                            <MessageSquare size={13} /> Ver chat oficial
                          </button>
                        ) : (selecionado.linkOrigem || selecionado.linkPortal) ? (
                          <a href={selecionado.linkOrigem || selecionado.linkPortal!} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-[12px] px-3 py-2 rounded-md border border-subtle2 text-muted hover:text-strong transition-colors flex-shrink-0">
                            <ExternalLink size={13} /> Acessar local da disputa
                          </a>
                        ) : null}
                      </div>
                    )}
                    {/* Portal que nenhum coletor lê. Mesma moldura, sem o quadro: não há
                        página oficial conhecida para embutir. */}
                    {semLeitor && (
                      <div className="px-4 py-3 border-b border-amber/30 bg-amber/10 flex items-start gap-3 flex-wrap">
                        <AlertTriangle size={15} className="text-amber flex-shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1 basis-[260px]">
                          <p className="text-[12px] font-semibold text-strong">O Radar não lê o chat deste portal</p>
                          <p className="text-[11px] text-muted mt-0.5 leading-snug">
                            Nenhum coletor cobre o portal onde este pregão corre, então as mensagens dele não chegam aqui nem geram alerta.
                            {selecionado.mensagens.length > 0 ? ' As que aparecem abaixo não se atualizam.' : ''}
                          </p>
                        </div>
                        {(selecionado.linkOrigem || selecionado.linkPortal) && (
                          <a href={selecionado.linkOrigem || selecionado.linkPortal!} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-[12px] px-3 py-2 rounded-md border border-subtle2 text-muted hover:text-strong transition-colors flex-shrink-0">
                            <ExternalLink size={13} /> Acessar local da disputa
                          </a>
                        )}
                      </div>
                    )}

                    {/* Mensagens */}
                    <div className="flex-1 overflow-y-auto min-h-0 p-4 bg-bg">
                      {mensagensVisiveis.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-center">
                          <div>
                            <MessageSquare size={22} className="text-faint mx-auto mb-2 opacity-50" />
                            <p className="text-[12px] text-muted">Nenhuma mensagem capturada neste pregão ainda</p>
                            {/* "Monitoramento ativo" só quando um coletor cobre ESTE pregão e algum
                                portal já foi lido com sucesso. Nos outros casos, o estado real —
                                e sem mandar para "Conectar portal", que nos portais públicos não
                                tem o que conectar (a faixa do topo diz a mesma coisa). */}
                            <p className="text-[11px] text-faint mt-1 max-w-[380px]">
                              {soNoPortal
                                ? 'As mensagens deste pregão não chegam aqui. Acompanhe pelo site oficial.'
                                : semLeitor
                                  ? 'O Radar não lê o chat deste portal. Acompanhe pelo local da disputa.'
                                  : capturaNuncaLigou
                                    ? 'Este chat ainda não foi lido: nenhum portal foi verificado com sucesso até agora. Veja Portais, acima.'
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
                    </>)}
                  </>
                )}
              </div>
            </div>
          )}

          {data && (
            <p className="text-[10px] text-faint mt-3">
              Os pregões são selecionados automaticamente pelo seu perfil (UFs, categorias, termos e portfólio) — ajuste em Perfil &amp; Preferências.
              A captura de chat depende de um conector ativo: &quot;sem novidades&quot; só é confiável quando não há aviso de falha em Portais, acima.
              Palavras-chave e notificações ficam em <Link href="/radar/configuracoes" className="text-accent hover:underline">Configurações gerais</Link>.
              Marcações de <strong>Importante</strong> e <strong>Arquivado</strong> ficam neste navegador.
            </p>
          )}
        </main>

        {adicionar && <AdicionarPregao onClose={() => setAdicionar(false)} onAdicionado={(id) => { void aoAdicionar(id) }} />}
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
          // TEXTO ESCURO SOBRE O TOM CLARO — como marca-texto de verdade.
          //
          // Era `text-amber-100` / `text-emerald-100`: tons quase brancos, que só fazem
          // sentido sobre fundo escuro. Este produto tem UM tema, e ele é claro
          // (globals.css, `--bg: #ffffff`), então a palavra destacada ficava com
          // contraste de ~1,1:1 contra o próprio realce — o mínimo legível é 4,5:1.
          // O destaque fazia o OPOSTO do que existe para fazer: apagava justamente a
          // palavra que queríamos que o fornecedor lesse, e apagava só as importantes
          // (o nome do arquivo anexado, a palavra-chave que ele mesmo monitorou).
          // Agora ficam em ~8:1 (anexo) e ~7,5:1 (chave).
          <mark key={i} className={clsx('rounded px-0.5',
            t.tipo === 'chave' ? 'bg-amber/25 text-amber-900' : 'bg-emerald-500/20 text-emerald-900')}>
            {t.texto}
          </mark>
        ))}
    </>
  )
}

/** Menu ⋮ da conversa: Informações · Acessar local da disputa · Desativar monitoramento. */
function Kebab({ processo, onDetalhes, onMonitoramento, onParticipacao, onArquivar, arquivado }: {
  processo: Processo; onDetalhes: () => void; onMonitoramento: () => void; onParticipacao: () => void
  onArquivar: () => void; arquivado: boolean
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
          {/* O mesmo comando do martelo, agora com NOME. O icone sozinho nao diz o
              que faz, e este e o comando que o fornecedor mais vai usar. */}
          {!processo.orfao && (
            <Item onClick={onParticipacao} icone={<Gavel size={13} />}>
              {processo.participando ? 'Não estou mais participando' : 'Estou participando deste'}
            </Item>
          )}
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
              {processo.situacao ? (
              <span className={clsx('inline-block text-[10px] font-mono-custom uppercase tracking-wide px-2 py-1 rounded',
                processo.situacao === 'encerrada' ? 'bg-bg4 text-faint' : 'bg-emerald-500/15 text-emerald-300')}>
                {processo.situacao === 'encerrada' ? 'encerrada' : 'aberta'}
              </span>
              ) : <p className="text-[12.5px] text-strong">—</p>}
            </Campo2>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Campo2 label="Nº do processo (PNCP)">
              <p className="text-[12.5px] text-strong font-mono-custom break-all">{NUMERO_PNCP.test(processo.licitacaoId) || processo.origem !== 'manual' ? processo.licitacaoId || '—' : '—'}</p>
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
