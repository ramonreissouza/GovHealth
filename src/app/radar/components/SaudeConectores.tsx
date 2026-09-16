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
// Agora o normal ocupa uma linha e a exceção ganha corpo:
//   · tudo que está verificado vira um selo pequeno numa faixa só;
//   · o que NÃO está verificado abre um cartão com o motivo, sempre, sem clique;
//   · o detalhe do que está bem fica a um clique no selo, para quem quiser conferir.
//
// A faixa agrupa POR PORTAL, não por credencial: quem tem cinco CNPJs no mesmo
// portal via cinco cartões iguais. E o selo do grupo carrega SEMPRE o pior estado
// do grupo — quatro contas boas e uma expirada não podem pintar de verde, ou o
// agrupamento viraria exatamente a falsa sensação de segurança que o 4.2 proíbe.

import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { ShieldCheck, ShieldAlert, ShieldQuestion, Loader2, ChevronDown } from 'lucide-react'
import { rotuloSaude, tempoDesde, confiavelAgora } from '@/lib/radar/saude'
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

/** Declarado fora do render: atribuir o componente a uma `const` maiúscula dentro do
 *  corpo faz o React remontar o ícone a cada render (e o lint reclama, com razão). */
function IconeEstado({ cor, size }: { cor: string; size: number }) {
  if (cor === 'verde') return <ShieldCheck size={size} />
  if (cor === 'cinza') return <ShieldQuestion size={size} />
  return <ShieldAlert size={size} />
}

/** A linha de estado de um item, na mesma redação do cartão antigo. */
function linhaEstado(s: SaudeItem, agoraMs: number) {
  if (confiavelAgora(s, agoraMs)) return `verificado ${tempoDesde(s.verificadoEm, agoraMs)} · sem novidades`
  if (s.verificadoEm) return `última verificação OK ${tempoDesde(s.verificadoEm, agoraMs)}`
  return `tentativa ${tempoDesde(s.tentadoEm, agoraMs)}`
}

/** O cartão completo — agora reservado a quem precisa ser lido, não a todo mundo. */
function Cartao({ s, agoraMs }: { s: SaudeItem; agoraMs: number }) {
  const r = rotuloSaude(s.status)
  const confiavel = confiavelAgora(s, agoraMs)
  // Um `ok` VELHO não é verde. O status diz "deu certo"; a janela diz "ainda vale".
  const cor = confiavel ? r.cor : r.cor === 'verde' ? 'amarelo' : r.cor
  return (
    <div className={clsx('rounded-xl border p-3', COR_CLS[cor])}>
      <div className="flex items-center gap-2">
        <IconeEstado cor={cor} size={14} />
        <span className="text-[12px] font-semibold">{nomeConector(s.conectorId)}</span>
        {s.cnpj && <span className="text-[10px] font-mono-custom opacity-70">CNPJ {s.cnpj}</span>}
      </div>
      <div className="text-[12px] mt-1.5 leading-snug">
        {confiavel ? r.titulo : r.cor === 'verde' ? 'Verificação vencida — pode haver mensagem nova não lida' : r.titulo}
      </div>
      <div className="text-[10.5px] opacity-80 mt-1 flex items-center gap-1">
        {s.status === 'nunca_verificado' && <Loader2 size={10} className="animate-spin" />}
        {linhaEstado(s, agoraMs)}
      </div>
      {s.detalhe && <div className="text-[10.5px] opacity-70 mt-1 line-clamp-2" title={s.detalhe}>{s.detalhe}</div>}
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
        const problemas = itens.filter((s) => !confiavelAgora(s, agoraMs))
        const cor = itens.reduce((pior, s) => {
          const r = rotuloSaude(s.status)
          const c = confiavelAgora(s, agoraMs) ? r.cor : r.cor === 'verde' ? 'amarelo' : r.cor
          return GRAVIDADE[c] > GRAVIDADE[pior] ? c : pior
        }, 'verde')
        // O relógio do grupo é o do item MENOS recente: dizer "há 3 min" porque uma
        // das contas acabou de rodar esconderia a que está parada há um dia.
        const maisAntigo = itens.reduce((a, s) =>
          new Date(s.verificadoEm ?? 0).getTime() < new Date(a.verificadoEm ?? 0).getTime() ? s : a)
        return { conectorId, itens, problemas, cor, maisAntigo }
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

  const comProblema = grupos.filter((g) => g.problemas.length > 0)
  const saudaveis = grupos.filter((g) => g.problemas.length === 0)

  return (
    <div className="space-y-2">
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
        <span className="text-[10.5px] text-faint ml-1">
          {saudaveis.length} de {grupos.length} verificado{grupos.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Quem está com problema abre sozinho, sem clique: é o que precisa ser lido. */}
      {comProblema.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {comProblema.flatMap((g) => g.problemas).map((s) => <Cartao key={chaveDe(s)} s={s} agoraMs={agoraMs} />)}
        </div>
      )}

      {/* E o detalhe do que está bem, só para quem pediu. */}
      {abertos.size > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {grupos
            .filter((g) => abertos.has(g.conectorId))
            .flatMap((g) => g.itens.filter((s) => confiavelAgora(s, agoraMs)))
            .map((s) => <Cartao key={chaveDe(s)} s={s} agoraMs={agoraMs} />)}
        </div>
      )}
    </div>
  )
}
