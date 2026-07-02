'use client'
// src/components/dashboard/OpportunityList.tsx

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Star } from 'lucide-react'
import { Oportunidade } from '@/lib/types'
import { clsx } from 'clsx'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import type { OpportunitiesData } from './DashboardView'

interface Props {
  data: OpportunitiesData | null
  loading: boolean
  error?: boolean
  limit?: number
}

import { CATEGORIA_LABEL_CURTO as CATEGORIA_LABEL, CATEGORIA_COLOR } from '@/lib/categorias'
import { formatBRLCompact as formatBRL, diasRestantes } from '@/lib/format'
import { getFavoriteOrgaos, toggleFavoriteOrgao } from '@/lib/favorites'
import { normalizeText } from '@/lib/text'

const SITUACAO_CLASS: Record<number, string> = {
  1: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  2: 'bg-amber/15 text-amber border border-amber/30',
  3: 'bg-red/15 text-red border border-red/30',
  4: 'bg-bg4 text-faint border border-subtle2',
}

export default function OpportunityList({ data, loading, error, limit = 6 }: Props) {
  const router = useRouter()
  const [favs, setFavs] = useState<string[]>([])
  useEffect(() => { setFavs(getFavoriteOrgaos()) }, [])

  const isFav = (nome?: string | null) => !!nome && favs.includes(normalizeText(nome).trim())
  function toggleFav(e: React.MouseEvent, nome?: string | null) {
    e.stopPropagation()
    if (!nome) return
    setFavs(toggleFavoriteOrgao(nome))
  }

  // Recorta score >= 40 (relevantes) e sobe os órgãos favoritos ao topo (sort estável
  // preserva a ordem por score dentro de cada grupo). Dados vêm do DashboardView.
  const opps: Oportunidade[] = (data?.oportunidades ?? [])
    .filter((o) => o.score >= 40)
    .sort((a, b) => Number(isFav(b.hospital)) - Number(isFav(a.hospital)))

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2.5 animate-pulse">
            <div className="w-9 h-9 rounded-lg bg-bg4" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 bg-bg4 rounded w-3/4" />
              <div className="h-2.5 bg-bg4 rounded w-1/2" />
            </div>
            <div className="w-14 h-3 bg-bg4 rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="py-6 text-center">
        <p className="text-[12px] text-brand-red mb-2">Erro ao carregar oportunidades. Verifique a configuração das APIs.</p>
        <p className="text-[11px] text-faint">Configure as variáveis no .env.local</p>
      </div>
    )
  }

  if (opps.length === 0) {
    return (
      <div className="py-6 text-center text-faint text-[12px]">
        Nenhuma oportunidade encontrada com os filtros atuais.
      </div>
    )
  }

  const visiveis = opps.slice(0, limit)

  return (
    <div>
      {visiveis.length === 0 && (
        <div className="py-4 text-center text-faint text-[11px]">Nenhuma oportunidade deste tipo.</div>
      )}

      {visiveis.map((opp) => {
        const lic = opp.licitacaoRelacionada
        const situacaoId = lic?.situacaoCompraId ?? 4
        const dias = lic?.dataEncerramentoProposta ? diasRestantes(lic.dataEncerramentoProposta) : null
        const anoRef = lic?.dataPublicacaoPncp ? lic.dataPublicacaoPncp.substring(0, 4) : null

        return (
          <div
            key={opp.id}
            onClick={() => router.push(`/oportunidades?opp=${encodeURIComponent(opp.id)}`)}
            className="flex items-start gap-3 py-3 border-b border-subtle last:border-0 cursor-pointer hover:bg-bg3 hover:-mx-2 hover:px-2 hover:rounded-md transition-all"
          >
            {/* Score */}
            <div className="mt-0.5">
              <ScoreBadge
                score={opp.score}
                status={opp.status}
                subScores={opp.subScores}
                acaoRecomendada={opp.acaoRecomendada}
                size="sm"
              />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              {/* Line 1: name + badges */}
              <div className="flex items-center gap-1 flex-wrap">
                <button
                  onClick={(e) => toggleFav(e, opp.hospital)}
                  title={isFav(opp.hospital) ? 'Remover dos favoritos' : 'Favoritar este órgão'}
                  className="flex-shrink-0 -ml-0.5"
                >
                  <Star
                    size={13}
                    className={clsx('transition-colors', isFav(opp.hospital) ? 'fill-amber text-amber' : 'text-faint hover:text-amber')}
                  />
                </button>
                <span className="text-[12px] font-semibold text-strong truncate">
                  {opp.hospital ?? opp.municipio}
                </span>
                <span className={clsx('text-[8px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase tracking-wide flex-shrink-0', SITUACAO_CLASS[situacaoId] ?? SITUACAO_CLASS[4])}>
                  {lic?.situacaoCompraNome ?? 'Encerrado'}
                </span>
                <span className={clsx('text-[8px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase tracking-wide flex-shrink-0', CATEGORIA_COLOR[opp.categoria])}>
                  {CATEGORIA_LABEL[opp.categoria]}
                </span>
                {dias !== null && dias > 0 && (
                  <span className="text-[8px] font-mono-custom px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase flex-shrink-0">
                    {dias}d
                  </span>
                )}
              </div>

              {/* Line 2: location + modality + year */}
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-[10px] text-faint font-mono-custom">
                  {opp.municipio} / {opp.uf}
                </span>
                {lic?.modalidadeNome && (
                  <span className="text-[10px] text-faint">· {lic.modalidadeNome}</span>
                )}
                {anoRef && <span className="text-[10px] text-faint">· {anoRef}</span>}
              </div>

              {/* Line 3: description */}
              <p className="text-[11px] text-muted mt-0.5 leading-snug line-clamp-1">
                {opp.descricao}
              </p>
            </div>

            {/* Right: value + urgency */}
            <div className="text-right flex-shrink-0">
              <div className="text-[13px] font-mono-custom font-bold text-strong">
                {formatBRL(opp.valorEstimado)}
              </div>
              <div className={clsx('text-[9px] font-mono-custom uppercase mt-0.5',
                opp.urgencia === 'urgente' ? 'text-brand-red' :
                opp.urgencia === 'alta' ? 'text-amber' :
                opp.urgencia === 'media' ? 'text-brand-blue' : 'text-faint')}>
                {opp.urgencia}
              </div>
            </div>
          </div>
        )
      })}

      <button
        onClick={() => router.push('/oportunidades')}
        className="mt-3 w-full text-[11px] text-faint hover:text-strong text-center py-1.5 transition-colors"
      >
        Ver todas as oportunidades →
      </button>
    </div>
  )
}
