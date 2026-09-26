'use client'
// src/app/radar/components/AdicionarPregao.tsx — "Adicionar pregão fora do perfil".
//
// Substituiu o "Conectar portal" em 25/09/2026. Nenhum portal lido pede login, e o
// Compras.gov.br não tem o que conectar; aquela janela abria em "não há nada para
// conectar", e a única coisa real que fazia era cadastrar um pregão fora do perfil, com
// três campos e a escolha do portal na mão. Aqui é um campo: o link. O portal sai dele.
//
// A resposta aparece ENQUANTO a pessoa cola, e é a mesma que o servidor vai dar
// (lerLinkDoRadar, em lib/radar/adicionar-pregao.ts, roda nos dois lados). Inclusive o
// que o Radar faz depois: ler e avisar, ou só mostrar o chat oficial (requisito 4.2).

import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { AlertTriangle, Check, Info, Loader2, X } from 'lucide-react'
import { lerLinkDoRadar, oQueOAcompanhamentoFaz, PORTAIS_LIDOS } from '@/lib/radar/adicionar-pregao'

const SITUACAO: Record<string, string> = {
  novo: 'Pregão adicionado à sua lista.',
  ja_estava: 'Este pregão já estava no Radar. Agora ele fica na sua lista mesmo fora do perfil.',
  reativado: 'Este pregão já estava no Radar, com o acompanhamento desligado. Ele voltou para a sua lista.',
}

export default function AdicionarPregao({ onClose, onAdicionado }: {
  onClose: () => void
  /** Chamado assim que o servidor confirma; a tela recarrega e seleciona o pregão. */
  onAdicionado: (id: string) => void
}) {
  const [link, setLink] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [pronto, setPronto] = useState<{ texto: string; aviso: string | null; conectorId: string | null } | null>(null)
  const lido = useMemo(() => lerLinkDoRadar(link), [link])
  const aceito = lido.tipo === 'portal' || lido.tipo === 'pncp'

  async function adicionar() {
    if (!aceito || enviando) return
    setEnviando(true); setErro(null)
    try {
      const r = await fetch('/api/radar/processos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ link }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.id) { setErro(j.error || 'Não foi possível adicionar. Tente de novo.'); return }
      // O conector vem do SERVIDOR: com link do PNCP, só ele sabe em que portal a disputa corre.
      setPronto({ texto: SITUACAO[j.situacao] ?? SITUACAO.novo, aviso: j.aviso ?? null, conectorId: j.conectorId ?? null })
      onAdicionado(j.id)
    } catch { setErro('Falha de rede. Tente de novo.') } finally { setEnviando(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="adicionar-pregao-titulo"
        className="relative bg-bg2 border border-subtle rounded-2xl w-full max-w-[480px] p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 id="adicionar-pregao-titulo" className="font-heading font-bold text-[16px] text-strong">Adicionar pregão fora do perfil</h3>
          <button onClick={onClose} aria-label="Fechar" className="text-faint hover:text-strong"><X size={18} /></button>
        </div>

        {pronto ? (
          <div className="mt-4">
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0"><Check size={16} className="text-emerald-400" /></div>
              <div className="text-[12.5px] text-muted leading-snug pt-1.5 space-y-1.5">
                <p className="text-strong font-semibold">{pronto.texto}</p>
                {pronto.conectorId && <p>{oQueOAcompanhamentoFaz(pronto.conectorId)}</p>}
                {pronto.aviso && <p className="text-amber">{pronto.aviso}</p>}
              </div>
            </div>
            <div className="flex justify-end mt-5">
              <button onClick={onClose} className="text-[12px] px-4 py-2 rounded-md bg-accent text-black font-semibold">Ver o pregão</button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[12px] text-muted mt-1 mb-4 leading-snug">
              Os pregões do seu perfil já entram sozinhos. Para acompanhar outro, cole o link da página dele no portal
              da disputa, ou o link do edital no PNCP.
            </p>

            <label className="block">
              <span className="text-[11px] text-faint">Link do pregão</span>
              <input
                autoFocus type="url" inputMode="url" autoComplete="off" spellCheck={false}
                value={link} onChange={(e) => { setLink(e.target.value); setErro(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') void adicionar() }}
                placeholder="https://…"
                className="mt-1 w-full text-[13px] bg-bg3 border border-subtle rounded-md px-3 py-2 text-strong focus:border-accent outline-none"
              />
            </label>

            {/* O que o Radar entendeu do link — antes do clique, não depois. */}
            <div className="mt-3 min-h-[44px] text-[12px] leading-snug" aria-live="polite">
              {lido.tipo === 'vazio' && (
                <p className="text-faint">
                  Portais que o Radar lê: {PORTAIS_LIDOS.join(', ')}. No Compras.gov.br, o chat oficial abre dentro do pregão, sem alerta.
                </p>
              )}
              {lido.tipo === 'portal' && (
                <div className="flex items-start gap-2">
                  {/* Verde só quando há leitura: o Compras.gov.br é só visualização, e
                      verde ali voltaria a parecer proteção. */}
                  {lido.conectorId === 'comprasgov'
                    ? <Info size={14} className="text-faint flex-shrink-0 mt-0.5" />
                    : <Check size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />}
                  <p className="text-muted">
                    <strong className="text-strong">{lido.nome}</strong> · {lido.descricao}.{' '}
                    {oQueOAcompanhamentoFaz(lido.conectorId)}
                  </p>
                </div>
              )}
              {lido.tipo === 'pncp' && (
                <div className="flex items-start gap-2">
                  <Info size={14} className="text-faint flex-shrink-0 mt-0.5" />
                  <p className="text-muted">Link do edital no PNCP. Ao adicionar, o Radar procura em que portal a disputa corre e diz se consegue lê-la.</p>
                </div>
              )}
              {lido.tipo === 'erro' && (
                <div className="flex items-start gap-2">
                  <AlertTriangle size={14} className="text-amber flex-shrink-0 mt-0.5" />
                  <p className="text-amber">{lido.mensagem}</p>
                </div>
              )}
            </div>

            {erro && <p className="text-[12px] text-red mt-2">{erro}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={onClose} className="text-[12px] px-3 py-2 rounded-md border border-subtle2 text-muted hover:text-strong">Cancelar</button>
              <button onClick={() => void adicionar()} disabled={!aceito || enviando}
                className={clsx('flex items-center gap-1.5 text-[12px] px-4 py-2 rounded-md bg-accent text-black font-semibold', (!aceito || enviando) && 'opacity-50')}>
                {enviando && <Loader2 size={13} className="animate-spin" />} Adicionar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
