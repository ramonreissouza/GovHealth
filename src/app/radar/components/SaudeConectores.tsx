'use client'
// src/app/radar/components/SaudeConectores.tsx — REQUISITO 4.2.
// Mostra o estado de cada conector distinguindo claramente "verificado OK" de
// "não foi possível verificar" — nunca deixa o usuário achar que está protegido
// quando a sessão expirou ou o portal caiu.
//
// POR QUE ISSO É UMA FAIXA E NÃO UMA GRADE DE CARTÕES (2026-09-16)
//
// Era uma grade de 3 colunas com um cartão de ~95 px por credencial. Com um punhado
// de conectores ela empurrava a conversa — que é o produto — para fora da primeira
// tela. E o efeito era o inverso do requisito: o ÚNICO conector com problema virava
// mais um cartão no meio de dezoito verdes, mais fácil de perder do que de achar.
//
// SEGUNDA PASSADA, MESMO DIA: a faixa voltou a encher a tela, agora com QUATRO
// cartões laranja. A culpa não era do layout — era da régua. A tela tratava
// "desatualizado" como se fosse "quebrado", e o worker cicla entre os portais a cada
// 19–85 min (medido), então o estado NORMAL caía fora da janela de 30 min e pintava
// de âmbar. Ver JANELA_FRESCO_MIN em lib/radar/saude.ts para os números.
//
// A regra agora tem três níveis, e só o último ocupa espaço:
//   · verde  — verificado há pouco; cabe num selo.
//   · cinza  — OK, mas já faz um tempo. É informação, não chamado: o selo mostra o
//              relógio e pronto. Ninguém precisa fazer nada.
//   · âmbar/vermelho — QUEBRADO (sessão expirada, falha, portal fora) ou MUDO há
//              horas. Só este abre uma linha com o motivo, sem clique.
//
// A faixa agrupa POR PORTAL, não por credencial: quem tem cinco CNPJs no mesmo
// portal via cinco cartões iguais. E o selo do grupo carrega SEMPRE o pior estado
// do grupo — quatro contas boas e uma expirada não podem pintar de verde, ou o
// agrupamento viraria exatamente a falsa sensação de segurança que o 4.2 proíbe.

import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { ShieldCheck, ShieldAlert, ShieldQuestion, Loader2, ChevronDown } from 'lucide-react'
import { rotuloSaude, tempoDesde, confiavelAgora, quebrado, parado, precisaAtencao } from '@/lib/radar/saude'
import { nomeConector } from '@/lib/radar/conectores'
import type { StatusSaude } from '@/lib/radar/types'

export interface SaudeItem {
  credencialId: string
  conectorId: string
  cnpj: string
  status: StatusSaude
  verificadoEm: string | null
  tentadoEm: string | null
  detalhe: string | null
}

const COR_CLS: Record<string, string> = {
  // /10 e não /12: a escala de opacidade do Tailwind anda de 5 em 5, então `/12` não
  // gera classe nenhuma e o selo ficava sem fundo.
  verde: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  amarelo: 'bg-amber/15 text-amber border-amber/30',
  vermelho: 'bg-red/15 text-red border-red/30',
  cinza: 'bg-bg4 text-faint border-subtle2',
}

// Quanto mais alto, mais grave. O grupo herda o MAIOR — é o que impede um portal com
// uma conta quebrada de aparecer verde só porque as outras quatro estão boas.
const GRAVIDADE: Record<string, number> = { verde: 0, cinza: 1, amarelo: 2, vermelho: 3 }

/** A chave de lista: `credencialId` é null no monitor público, e null repetido colide. */
const chaveDe = (s: SaudeItem) => `${s.conectorId}:${s.credencialId ?? 'publico'}`

/**
 * A cor de UM item. Repare que envelhecer não muda a cor para âmbar — leva ao cinza,
 * que é "não sei desde agora há pouco", não "socorro".
 */
function corDe(s: SaudeItem, agoraMs: number): string {
  if (s.status === 'falha') return 'vermelho'
  if (quebrado(s) || parado(s, agoraMs)) return 'amarelo'
  if (confiavelAgora(s, agoraMs)) return 'verde'
  return 'cinza'
}

/** Declarado fora do render: atribuir o componente a uma `const` maiúscula dentro do
 *  corpo faz o React remontar o ícone a cada render (e o lint reclama, com razão). */
function IconeEstado({ cor, size }: { cor: string; size: number }) {
  if (cor === 'verde') return <ShieldCheck size={size} />
  if (cor === 'cinza') return <ShieldQuestion size={size} />
  return <ShieldAlert size={size} />
}

/** O que o estado quer dizer, numa frase. */
function tituloDe(s: SaudeItem, agoraMs: number): string {
  if (quebrado(s)) return rotuloSaude(s.status).titulo
  if (parado(s, agoraMs)) return 'Sem verificar há horas — o coletor pode estar parado'
  if (confiavelAgora(s, agoraMs)) return 'Verificado'
  if (s.status === 'nunca_verificado') return 'Aguardando primeira verificação'
  return 'Aguardando a próxima passada'
}

/** A linha do relógio: até quando a gente olhou, sem prometer o que não leu. */
function linhaEstado(s: SaudeItem, agoraMs: number) {
  if (confiavelAgora(s, agoraMs)) return `verificado ${tempoDesde(s.verificadoEm, agoraMs)} · sem novidades até então`
  if (s.verificadoEm) return `última verificação OK ${tempoDesde(s.verificadoEm, agoraMs)}`
  return `tentativa ${tempoDesde(s.tentadoEm, agoraMs)}`
}

/**
 * Uma LINHA (não mais um cartão). Duas alturas de texto no total: a primeira diz o que
 * houve, a segunda diz desde quando e o detalhe do conector, truncado. O detalhe
 * inteiro fica no `title` — quem precisa dele passa o mouse; quem não precisa não paga
 * três linhas de tela por ele.
 */
function Linha({ s, agoraMs }: { s: SaudeItem; agoraMs: number }) {
  const cor = corDe(s, agoraMs)
  return (
    <div className={clsx('rounded-lg border px-2.5 py-1.5 flex items-start gap-2', COR_CLS[cor])}>
      <span className="mt-[2px] shrink-0"><IconeEstado cor={cor} size={13} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-[12px] font-semibold">{nomeConector(s.conectorId)}</span>
          {s.cnpj && <span className="text-[10px] font-mono-custom opacity-70">CNPJ {s.cnpj}</span>}
          <span className="text-[12px] opacity-90">— {tituloDe(s, agoraMs)}</span>
        </div>
        <div className="text-[10.5px] opacity-75 flex items-center gap-1 truncate" title={s.detalhe ?? undefined}>
          {s.status === 'nunca_verificado' && <Loader2 size={10} className="animate-spin shrink-0" />}
          <span className="shrink-0">{linhaEstado(s, agoraMs)}</span>
          {s.detalhe && <span className="truncate">· {s.detalhe}</span>}
        </div>
      </div>
    </div>
  )
}

export default function SaudeConectores({ saude, agoraMs }: { saude: SaudeItem[]; agoraMs: number }) {
  const [abertos, setAbertos] = useState<Set<string>>(new Set())

  const grupos = useMemo(() => {
    const porPortal = new Map<string, SaudeItem[]>()
    for (const s of saude) {
      const lista = porPortal.get(s.conectorId)
      if (lista) lista.push(s)
      else porPortal.set(s.conectorId, [s])
    }
    return [...porPortal.entries()]
      .map(([conectorId, itens]) => {
        const atencao = itens.filter((s) => precisaAtencao(s, agoraMs))
        const cor = itens.reduce(
          (pior, s) => (GRAVIDADE[corDe(s, agoraMs)] > GRAVIDADE[pior] ? corDe(s, agoraMs) : pior),
          'verde',
        )
        // O relógio do grupo é o do item MENOS recente: dizer "há 3 min" porque uma
        // das contas acabou de rodar esconderia a que está parada há um dia.
        const maisAntigo = itens.reduce((a, s) =>
          new Date(s.verificadoEm ?? 0).getTime() < new Date(a.verificadoEm ?? 0).getTime() ? s : a)
        return { conectorId, itens, atencao, cor, maisAntigo }
      })
      .sort((a, b) => GRAVIDADE[b.cor] - GRAVIDADE[a.cor] || a.conectorId.localeCompare(b.conectorId))
  }, [saude, agoraMs])

  if (saude.length === 0) {
    return (
      <div className="bg-bg2 border border-subtle rounded-xl p-4 text-[12px] text-muted">
        Nenhum conector configurado. Conecte um portal para o Radar começar a monitorar os chats.
      </div>
    )
  }

  const pedemAtencao = grupos.flatMap((g) => g.atencao)
  const verificados = grupos.filter((g) => g.itens.every((s) => confiavelAgora(s, agoraMs))).length

  return (
    <div className="space-y-1.5">
      {/* A faixa: um selo por portal, tudo numa linha só. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {grupos.map((g) => {
          const aberto = abertos.has(g.conectorId)
          return (
            <button
              key={g.conectorId}
              type="button"
              onClick={() =>
                setAbertos((atual) => {
                  const novo = new Set(atual)
                  if (novo.has(g.conectorId)) novo.delete(g.conectorId)
                  else novo.add(g.conectorId)
                  return novo
                })
              }
              aria-expanded={aberto}
              title={`${nomeConector(g.conectorId)} — ${linhaEstado(g.maisAntigo, agoraMs)}`}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-full border pl-2 pr-1.5 py-1 text-[11px] transition-opacity hover:opacity-80',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                COR_CLS[g.cor],
              )}
            >
              <IconeEstado cor={g.cor} size={12} />
              <span className="font-semibold">{nomeConector(g.conectorId)}</span>
              {/* A contagem só aparece quando há mais de uma conta — senão é ruído. */}
              {g.itens.length > 1 && <span className="opacity-70">×{g.itens.length}</span>}
              <span className="opacity-70">{tempoDesde(g.maisAntigo.verificadoEm, agoraMs)}</span>
              <ChevronDown size={11} className={clsx('opacity-60 transition-transform', aberto && 'rotate-180')} />
            </button>
          )
        })}
        {/* O contador é o sinal de topo — quando algo precisa de ação ele deixa de
            contabilizar e passa a chamar, sem custar um pixel a mais de altura. */}
        {pedemAtencao.length > 0 ? (
          <span className="text-[10.5px] text-amber font-semibold ml-1">
            {pedemAtencao.length} precisa{pedemAtencao.length === 1 ? '' : 'm'} de atenção
          </span>
        ) : (
          <span className="text-[10.5px] text-faint ml-1">
            {verificados} de {grupos.length} verificado{grupos.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* Só quem PRECISA DE AÇÃO abre sozinho. Envelhecer não entra aqui: o selo já
          mostra o relógio, e quem quiser o detalhe clica. */}
      {pedemAtencao.length > 0 && (
        <div className="space-y-1.5">
          {pedemAtencao.map((s) => <Linha key={chaveDe(s)} s={s} agoraMs={agoraMs} />)}
        </div>
      )}

      {/* E o detalhe do resto, só para quem pediu. */}
      {abertos.size > 0 && (
        <div className="space-y-1.5">
          {grupos
            .filter((g) => abertos.has(g.conectorId))
            .flatMap((g) => g.itens.filter((s) => !precisaAtencao(s, agoraMs)))
            .map((s) => <Linha key={chaveDe(s)} s={s} agoraMs={agoraMs} />)}
        </div>
      )}
    </div>
  )
}
