'use client'
// src/app/oportunidades/components/AcoesLicitacao.tsx — barra "Ações:" do card de
// licitação: Baixar Edital · Ativar monitoramento de chat · Acessar local da disputa.
//
// "Ativar monitoramento de chat" cria um processo MANUAL no Radar (origem='manual'
// em radar_processos) — é o opt-in edital a edital que a ferramenta de benchmark
// tem, convivendo com a nossa seleção automática por perfil.
//
// NÃO existe "Ver detalhes do pregão". Existiu, e foi removido: das 10 informações
// do modal, 8 (objeto, situação, publicação, encerramento, órgão, município/UF,
// modalidade, valor) já estão no card expandido logo acima do botão. Um clique que
// abre o que a pessoa já está lendo custa atenção e não devolve nada.

import { useState } from 'react'
import { clsx } from 'clsx'
import { Download, Radar, ExternalLink, Check, Loader2 } from 'lucide-react'
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

        {/* O NOME DO PORTAL vem no rótulo do botão, não num modal. Saber que a
            disputa é no Licitanet e não no Compras.gov muda o que o fornecedor
            precisa ter (cadastro, certificado, taxa) — é informação de decisão, e
            informação de decisão não fica escondida atrás de um clique. */}
        {lic.linkSistemaOrigem && (
          <a href={lic.linkSistemaOrigem} target="_blank" rel="noopener noreferrer"
            className={clsx(btn, 'border-subtle2 bg-bg3 text-muted hover:text-accent hover:border-subtle')}>
            <ExternalLink size={12} />
            {portal === 'desconhecido' ? 'Acessar local da disputa' : `Disputa no ${nomePortal(portal)}`}
          </a>
        )}

        {/* Portal reconhecido pelo marcador "[PORTAL] - ..." do objeto, mas sem URL
            para levar a pessoa. Dizer onde é continua valendo mais que silêncio. */}
        {!lic.linkSistemaOrigem && portal !== 'desconhecido' && (
          <span className="text-[10.5px] text-faint">Disputa no {nomePortal(portal)}</span>
        )}

        {erro && <span className="text-[10.5px] text-red">{erro}</span>}
      </div>
    </>
  )
}
