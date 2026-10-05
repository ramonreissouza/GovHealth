'use client'
// src/components/crm/ChecklistEtapas.tsx — checklist por etapa dentro do deal do CRM.
// A etapa atual abre sozinha; as anteriores mostram quanto ficou para trás.

import { useState } from 'react'
import { clsx } from 'clsx'
import { Check, ChevronDown, ExternalLink, FolderOpen, Plus, X } from 'lucide-react'
import {
  STAGES, ID_TAREFA_HABILITACAO, adicionarTarefa, alternarTarefa, removerTarefa,
  type PipelineStage, type TarefaEtapa,
} from '@/lib/crm'

export interface DossieResumo {
  href: string
  feitos: number
  total: number
  obrigatoriosPendentes: number
}

export default function ChecklistEtapas({
  checklist, stageAtual, onChange, dossie,
}: {
  checklist: TarefaEtapa[]
  stageAtual: PipelineStage
  onChange: (c: TarefaEtapa[]) => void
  dossie?: DossieResumo | null
}) {
  // Sem escolha do usuário, só a etapa atual fica aberta — e acompanha a troca de etapa.
  const [escolha, setEscolha] = useState<Partial<Record<PipelineStage, boolean>>>({})
  const [nova, setNova] = useState('')

  // "Perdido" fica fora do caminho: só aparece quando é a etapa do deal.
  const ordem = STAGES.filter((s) => s.id !== 'perdido' || stageAtual === 'perdido')
  const idxAtual = ordem.findIndex((s) => s.id === stageAtual)

  const estaAberta = (id: PipelineStage) => escolha[id] ?? id === stageAtual
  const alternarAberta = (id: PipelineStage) => setEscolha((prev) => ({ ...prev, [id]: !estaAberta(id) }))

  return (
    <div className="space-y-1.5">
      {ordem.map((s, i) => {
        const tarefas = checklist.filter((t) => t.stage === s.id)
        const feitos = tarefas.filter((t) => t.feito).length
        const aberta = estaAberta(s.id)
        const anterior = i < idxAtual
        const atrasadas = anterior ? tarefas.length - feitos : 0
        const completa = tarefas.length > 0 && feitos === tarefas.length

        return (
          <div
            key={s.id}
            className={clsx(
              'rounded-lg border',
              s.id === stageAtual ? 'border-accent/40 bg-accent/5' : 'border-subtle2 bg-bg3/50',
            )}
          >
            <button
              type="button"
              onClick={() => alternarAberta(s.id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left"
            >
              <span className={clsx('text-[10px] font-mono-custom font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide', s.colorClass)}>
                {s.label}
              </span>
              {s.id === stageAtual && (
                <span className="text-[9px] font-mono-custom text-accent uppercase tracking-wider">etapa atual</span>
              )}
              <span className="flex-1" />
              {atrasadas > 0 && (
                <span className="text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full bg-amber/15 text-amber border border-amber/30">
                  {atrasadas} pendente{atrasadas > 1 ? 's' : ''}
                </span>
              )}
              <span className={clsx('text-[10px] font-mono-custom', completa ? 'text-emerald-400' : 'text-faint')}>
                {feitos}/{tarefas.length}
              </span>
              <ChevronDown size={13} className={clsx('text-faint transition-transform', aberta && 'rotate-180')} />
            </button>

            {aberta && (
              <div className="px-2 pb-2 space-y-0.5">
                {tarefas.map((t) => (
                  <div key={t.id} className="group flex items-start gap-2 px-1.5 py-1 rounded-md hover:bg-bg4/60">
                    <button
                      type="button"
                      onClick={() => onChange(alternarTarefa(checklist, t.id))}
                      aria-label={t.feito ? 'Desmarcar' : 'Marcar como feita'}
                      className={clsx(
                        'mt-[1px] w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors',
                        t.feito ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-subtle2 hover:border-accent',
                      )}
                    >
                      {t.feito && <Check size={11} strokeWidth={3} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <span className={clsx('text-[12px] leading-snug', t.feito ? 'text-faint line-through' : 'text-strong')}>
                        {t.label}
                      </span>
                      {t.id === ID_TAREFA_HABILITACAO && dossie && (
                        <a
                          href={dossie.href}
                          className="mt-0.5 flex items-center gap-1 text-[10px] font-mono-custom text-accent hover:underline"
                        >
                          <FolderOpen size={10} />
                          dossiê: {dossie.feitos}/{dossie.total} documentos
                          {dossie.obrigatoriosPendentes > 0 && ` · ${dossie.obrigatoriosPendentes} obrigatório${dossie.obrigatoriosPendentes > 1 ? 's' : ''} faltando`}
                        </a>
                      )}
                    </div>
                    {t.link && !(t.id === ID_TAREFA_HABILITACAO && dossie) && (
                      <a href={t.link} title="Abrir no GovHealth" className="mt-0.5 text-faint hover:text-accent flex-shrink-0">
                        <ExternalLink size={11} />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => onChange(removerTarefa(checklist, t.id))}
                      title="Remover tarefa"
                      className="mt-0.5 md:opacity-0 md:group-hover:opacity-100 text-faint hover:text-red transition-opacity flex-shrink-0"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
                {tarefas.length === 0 && (
                  <p className="text-[11px] text-faint px-1.5 py-1">Nenhuma tarefa nesta etapa.</p>
                )}
                {s.id === stageAtual && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (!nova.trim()) return
                      onChange(adicionarTarefa(checklist, s.id, nova))
                      setNova('')
                    }}
                    className="flex items-center gap-1.5 pt-1 px-1"
                  >
                    <input
                      value={nova}
                      onChange={(e) => setNova(e.target.value)}
                      placeholder="Adicionar tarefa nesta etapa…"
                      className="flex-1 bg-bg2 border border-subtle2 rounded-md px-2 py-1 text-[11px] text-strong placeholder:text-faint outline-none focus:border-accent/60"
                    />
                    <button
                      type="submit"
                      disabled={!nova.trim()}
                      className="p-1 rounded-md text-faint hover:text-strong hover:bg-bg4 disabled:opacity-40"
                      aria-label="Adicionar"
                    >
                      <Plus size={13} />
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
