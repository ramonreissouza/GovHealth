'use client'
// src/components/legal/AceiteTermos.tsx — o "Li e estou de acordo" de quem cria usuário
// (autocadastro com teste grátis em /login e aceite de convite de equipe).
//
// Antes, o cadastro só dizia "ao criar a conta você concorda com nossos termos": nada era
// marcado nem gravado, e a pessoa não via o texto. Agora a caixa é obrigatória (o botão do
// formulário fica desabilitado sem ela), os Termos abrem aqui mesmo numa janela — sem
// perder o que já foi digitado — e o formulário manda VERSOES_ACEITAS ao servidor, que
// recusa versão diferente da vigente e grava versão, data e IP (ver registrarAceiteUsuario).
//
// A tela fala só em "Termos de Uso", mas o aceite grava também a versão da Política de
// Privacidade: a seção 1 dos Termos a declara parte integrante, então aceitar um é aceitar
// os dois — e a prova precisa dizer qual texto de cada um estava valendo.

import { useEffect, useState } from 'react'
import { ShieldCheck, X } from 'lucide-react'
import { TERMOS_VERSAO, PRIVACIDADE_VERSAO } from '@/lib/empresa-legal'
import { SECOES_TERMOS, TERMOS_ATUALIZADO_EM } from './termos-conteudo'

/** O que o formulário envia junto do cadastro quando a caixa está marcada. */
export const VERSOES_ACEITAS = { termosVersao: TERMOS_VERSAO, privacidadeVersao: PRIVACIDADE_VERSAO }

export const MSG_ACEITE_OBRIGATORIO = 'Para continuar, leia e marque "Li e estou de acordo" com os Termos de Uso.'

export function AceiteTermos({ aceito, onChange }: { aceito: boolean; onChange: (v: boolean) => void }) {
  const [aberto, setAberto] = useState(false)

  return (
    <>
      <div className={aceito ? 'rounded-lg border px-3 py-2.5 transition-colors border-accent/40 bg-accent/[0.06]' : 'rounded-lg border px-3 py-2.5 transition-colors border-subtle bg-bg3'}>
        <p className="text-[11.5px] text-muted leading-snug mb-2">
          Antes de continuar, leia os{' '}
          <a href="/termos" onClick={(e) => { e.preventDefault(); setAberto(true) }} className="text-accent hover:underline font-medium">Termos de Uso</a>{' '}
          — com as cláusulas de uso, <strong className="text-strong">confidencialidade</strong> e{' '}
          <strong className="text-strong">proteção de dados (LGPD)</strong>, que protegem você e a nós.
        </p>
        <label className="flex items-start gap-2 text-[12px] text-strong cursor-pointer select-none">
          <input type="checkbox" required checked={aceito} onChange={(e) => onChange(e.target.checked)}
            className="mt-0.5 flex-shrink-0 accent-[var(--accent)] w-4 h-4" />
          <span>
            <strong>Li e estou de acordo</strong> com os Termos de Uso.{' '}
            <span className="text-red-500 font-bold" aria-hidden>*</span>
            <span className="sr-only">(obrigatório)</span>
          </span>
        </label>
      </div>

      {aberto && (
        <JanelaTermos
          onFechar={() => setAberto(false)}
          onAceitar={() => { onChange(true); setAberto(false) }}
        />
      )}
    </>
  )
}

function JanelaTermos({ onFechar, onAceitar }: { onFechar: () => void; onAceitar: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', esc)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', esc); document.body.style.overflow = overflow }
  }, [onFechar])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/50 backdrop-blur-sm" onClick={onFechar}>
      <div role="dialog" aria-modal="true" aria-label="Termos de Uso" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[760px] max-h-[90vh] flex flex-col bg-bg2 border border-subtle rounded-xl shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-subtle">
          <h2 className="font-heading font-semibold text-[16px] text-strong">Termos de Uso</h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="text-faint hover:text-strong transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <p className="text-[10.5px] text-faint font-mono-custom mb-5">
            Última atualização: {TERMOS_ATUALIZADO_EM} ·{' '}
            <a href="/termos" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">abrir em nova aba</a>
          </p>
          <div className="space-y-6">
            {SECOES_TERMOS.map((s) => (
              <section key={s.titulo}>
                <h3 className="font-heading font-semibold text-[14.5px] text-strong mb-1.5">{s.titulo}</h3>
                <div className="text-[12.5px] text-muted leading-relaxed">{s.conteudo}</div>
              </section>
            ))}
          </div>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 px-5 py-3 border-t border-subtle">
          <button type="button" onClick={onFechar}
            className="text-[12.5px] text-muted hover:text-strong px-4 py-2 rounded-lg transition-colors">
            Fechar
          </button>
          <button type="button" onClick={onAceitar}
            className="flex items-center justify-center gap-1.5 bg-gradient-brand text-white font-semibold text-[13px] px-5 py-2.5 rounded-lg hover:brightness-105 transition-all shadow-sm shadow-accent/20">
            <ShieldCheck size={15} /> Li e estou de acordo
          </button>
        </div>
      </div>
    </div>
  )
}
