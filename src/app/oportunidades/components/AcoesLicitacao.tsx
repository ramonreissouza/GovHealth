'use client'
// src/app/oportunidades/components/AcoesLicitacao.tsx — barra "Ações:" do card de
// licitação, espelhando a da ConLicitação: Baixar Edital · Ativar monitoramento de
// chat · Ver detalhes do pregão · Acessar local da disputa.
//
// "Ativar monitoramento de chat" cria um processo MANUAL no Radar (origem='manual'
// em radar_processos) — é o opt-in edital a edital que a ferramenta de benchmark
// tem, convivendo com a nossa seleção automática por perfil.

import { useState } from 'react'
import { clsx } from 'clsx'
import { Download, Radar, Info, ExternalLink, Check, Loader2, X } from 'lucide-react'
import type { Licitacao } from '@/lib/types'
import { resolverPortal, nomePortal } from '@/lib/portais'

/** Página do edital no PNCP (onde ficam os arquivos p/ download). */
function paginaEditalPncp(lic: Licitacao): string | null {
  const cnpj = lic.orgaoEntidade?.cnpj
  const m = lic.numeroControlePNCP?.match(/-(\d+)\/(\d{4})$/)
  const seq = m?.[1], ano = m?.[2]
  if (!cnpj || !seq || !ano) return null
  return `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${Number(seq)}`
}

type Estado = 'idle' | 'enviando' | 'ok' | 'erro'

export default function AcoesLicitacao({ lic, uf }: { lic: Licitacao; uf?: string }) {
  const [monitor, setMonitor] = useState<Estado>('idle')
  const [erro, setErro] = useState<string | null>(null)
  const [detalhes, setDetalhes] = useState(false)

  const portal = resolverPortal({ linkExterno: lic.linkSistemaOrigem, objeto: lic.objetoCompra })
  const pagEdital = paginaEditalPncp(lic)

  async function ativarMonitoramento() {
    setMonitor('enviando'); setErro(null)
    try {
      const r = await fetch('/api/radar/processos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conectorId: portal === 'desconhecido' ? 'comprasgov' : portal,
          licitacaoId: lic.numeroControlePNCP,
          titulo: (lic.objetoCompra ?? '').slice(0, 240),
          uf: uf ?? lic.orgaoEntidade?.uf ?? '',
          linkPortal: lic.linkSistemaOrigem || undefined,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'falha')
      setMonitor('ok')
    } catch {
      setMonitor('erro'); setErro('Não foi possível ativar. Tente de novo.')
    }
  }

  const btn = 'inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border transition-colors'

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
        {pagEdital && (
          <a href={pagEdital} target="_blank" rel="noopener noreferrer"
            className={clsx(btn, 'border-subtle2 bg-bg3 text-muted hover:text-strong hover:border-subtle')}>
            <Download size={12} /> Baixar Edital
          </a>
        )}

        <button onClick={ativarMonitoramento} disabled={monitor === 'enviando' || monitor === 'ok'}
          className={clsx(btn, monitor === 'ok'
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            : 'border-accent/40 bg-accent/10 text-accent hover:bg-accent/20')}>
          {monitor === 'enviando' ? <Loader2 size={12} className="animate-spin" />
            : monitor === 'ok' ? <Check size={12} /> : <Radar size={12} />}
          {monitor === 'ok' ? 'Monitorando o chat' : 'Ativar monitoramento de chat'}
        </button>

        <button onClick={() => setDetalhes(true)}
          className={clsx(btn, 'border-subtle2 bg-bg3 text-muted hover:text-strong hover:border-subtle')}>
          <Info size={12} /> Ver detalhes do pregão
        </button>

        {lic.linkSistemaOrigem && (
          <a href={lic.linkSistemaOrigem} target="_blank" rel="noopener noreferrer"
            className={clsx(btn, 'border-subtle2 bg-bg3 text-muted hover:text-accent hover:border-subtle')}>
            <ExternalLink size={12} /> Acessar local da disputa
          </a>
        )}

        {erro && <span className="text-[10.5px] text-red">{erro}</span>}
      </div>

      {detalhes && <DetalhesPregao lic={lic} portal={portal} onClose={() => setDetalhes(false)} />}
    </>
  )
}

function DetalhesPregao({ lic, portal, onClose }: { lic: Licitacao; portal: string; onClose: () => void }) {
  const moeda = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
  const data = (s?: string) => {
    if (!s) return '—'
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
  }
  const Linha = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1">{label}</div>
      <div className="text-[12.5px] text-strong leading-snug">{children}</div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div onClick={(e) => e.stopPropagation()} className="relative bg-bg2 border border-subtle rounded-2xl w-full max-w-[620px] p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-4">
          <h3 className="font-heading font-bold text-[16px] text-strong">Detalhes do pregão</h3>
          <button onClick={onClose} className="text-faint hover:text-strong"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <Linha label="Objeto">{lic.objetoCompra || '—'}</Linha>
          <div className="grid grid-cols-2 gap-4">
            <Linha label="Situação">
              <span className={clsx('inline-block text-[10px] font-mono-custom uppercase tracking-wide px-2 py-1 rounded',
                lic.situacaoCompraId === 1 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-bg4 text-faint')}>
                {lic.situacaoCompraNome || '—'}
              </span>
            </Linha>
            <Linha label="Portal da disputa">{nomePortal(portal)}</Linha>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Linha label="Publicação">{data(lic.dataPublicacaoPncp)}</Linha>
            <Linha label="Encerramento das propostas">{data(lic.dataEncerramentoProposta)}</Linha>
          </div>
          <Linha label="Órgão">{lic.orgaoEntidade?.razaoSocial || '—'}</Linha>
          <div className="grid grid-cols-3 gap-4">
            <Linha label="Município / UF">
              {[lic.orgaoEntidade?.municipio, lic.orgaoEntidade?.uf].filter(Boolean).join(' - ') || '—'}
            </Linha>
            <Linha label="Modalidade">{lic.modalidadeNome || '—'}</Linha>
            <Linha label="Valor estimado">{moeda(lic.valorTotalEstimado)}</Linha>
          </div>
          <Linha label="Nº de controle PNCP">
            <span className="font-mono-custom break-all">{lic.numeroControlePNCP || '—'}</span>
          </Linha>
          <Linha label="CNPJ do órgão">
            <span className="font-mono-custom">{lic.orgaoEntidade?.cnpj || '—'}</span>
          </Linha>
        </div>
        <div className="flex justify-end mt-6">
          <button onClick={onClose} className="text-[12px] px-4 py-2 rounded-md border border-subtle2 text-muted hover:text-strong">Fechar</button>
        </div>
      </div>
    </div>
  )
}
