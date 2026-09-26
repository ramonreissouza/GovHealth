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
// TERCEIRA PASSADA, 26/09/2026: A FAIXA DE SELOS SAIU. Cinza ("aguardando a próxima
// passada") e verde lado a lado liam, para o cliente, como "metade quebrada", e ele não
// tem o que fazer com nenhum dos dois. Ficou uma frase com os portais acompanhados (o
// Compras.gov.br entre eles, como os demais: o chat oficial abre, e isso é o que ele
// oferece) e, só quando há falha REAL, a linha âmbar com o portal e o motivo. O requisito
// 4.2 continua valendo onde importa: portal que recusou ou calou há horas aparece sempre.
//
// A régua anterior, para quem for mexer (continua valendo para a linha de atenção):
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

import { clsx } from 'clsx'
import { ShieldCheck, ShieldAlert, ShieldQuestion, Loader2 } from 'lucide-react'
import { rotuloSaude, tempoDesde, confiavelAgora, quebrado, parado, precisaAtencao } from '@/lib/radar/saude'
import { CONECTORES, nomeConector } from '@/lib/radar/conectores'
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
  // Não é "aguardando": não existe passada a esperar para este portal.
  if (s.status === 'nao_monitorado') return rotuloSaude(s.status).titulo
  return 'Aguardando a próxima passada'
}

/** A linha do relógio: até quando a gente olhou, sem prometer o que não leu. */
function linhaEstado(s: SaudeItem, agoraMs: number) {
  if (s.status === 'nao_monitorado') return 'o Radar não lê este portal'
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

export default function SaudeConectores({ saude, agoraMs, carregando = false, falhou = false }: { saude: SaudeItem[]; agoraMs: number; carregando?: boolean; falhou?: boolean }) {
  // Dizia "Nenhum conector configurado. Conecte um portal…", e na prática aparecia só
  // enquanto a página carregava (a inbox sempre manda o Compras.gov.br): mandava a pessoa
  // configurar algo que não existe, no segundo em que ela chegava à tela.
  if (saude.length === 0) {
    return (
      <p className="text-[12px] text-muted">
        {falhou
          ? 'Não foi possível consultar os portais agora. A tela tenta de novo sozinha em até 2 minutos.'
          : carregando
            ? 'Consultando os portais…'
            : 'Nenhum portal verificado ainda. Os portais públicos são lidos sem login, a cada passada do coletor.'}
      </p>
    )
  }

  // Na ordem do catálogo, com nome curto ("BLL", não "BLL — Bolsa de Licitações e Leilões").
  const presentes = new Set(saude.map((s) => s.conectorId))
  const nomes = CONECTORES.filter((c) => presentes.has(c.id)).map((c) => c.nome.split(' — ')[0])
  const pedemAtencao = saude.filter((s) => precisaAtencao(s, agoraMs))
  // "Nenhum problema na última verificação" exige que ALGUMA verificação tenha
  // acontecido: num tenant novo (tudo `nunca_verificado`) a frase seria falsa (4.2).
  const algumVerificado = saude.some((s) => confiavelAgora(s, agoraMs))

  return (
    <div className="space-y-1.5">
      <p className="text-[12px] text-muted">
        Portais acompanhados: {nomes.join(', ')}.{' '}
        {pedemAtencao.length === 0 && (
          <span className="text-faint">
            {algumVerificado ? 'Nenhum problema na última verificação.' : 'Aguardando a primeira verificação.'}
          </span>
        )}
      </p>
      {/* Só a falha REAL ocupa espaço: portal que recusou, erro, ou calado há horas. */}
      {pedemAtencao.map((s) => <Linha key={chaveDe(s)} s={s} agoraMs={agoraMs} />)}
    </div>
  )
}
