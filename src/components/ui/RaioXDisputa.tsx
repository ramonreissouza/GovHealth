'use client'
// src/components/ui/RaioXDisputa.tsx — "Raio-X da disputa" no detalhe de uma licitação:
// como este órgão costuma fechar pregões desta categoria e quem costuma ganhar lá.
//
// Não renderiza nada fora de CATEGORIAS_RAIO_X, fora de pregão, enquanto carrega ou
// sem amostra. Um bloco que aparece vazio ou "carregando…" em metade das licitações
// promete o que não entrega (docs/faixa-lance-medicao.md).

import { useQuery } from '@tanstack/react-query'
import { Crosshair } from 'lucide-react'
import { raioXDisponivel, type RaioX } from '@/lib/raio-x'
import { CATEGORIA_LABEL_CURTO } from '@/lib/categorias'
import { formatBRL } from '@/lib/format'

// Valores do PNCP: Demais, ME, EPP, MEI, Não Informado, Não se aplica. Só o porte que
// muda a disputa (preferência de ME/EPP na Lei 123) vira etiqueta.
const PORTE: Record<string, string> = { ME: 'ME', EPP: 'EPP', MEI: 'MEI' }

function quando(iso: string | null): string {
  if (!iso) return '—'
  const [a, m] = iso.split('-')
  return `${m}/${a}`
}

export function RaioXDisputa({
  cnpjOrgao, categoria, modalidade,
}: {
  cnpjOrgao?: string | null
  categoria?: string | null
  modalidade?: string | null
}) {
  const cnpj = (cnpjOrgao ?? '').replace(/\D/g, '')
  const ativo = cnpj.length === 14 && raioXDisponivel(categoria) && /preg[aã]o/i.test(modalidade ?? '')

  const { data } = useQuery<RaioX | null>({
    queryKey: ['raio-x', cnpj, categoria],
    enabled: ativo,
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const r = await fetch(`/api/raio-x?cnpj=${cnpj}&cat=${encodeURIComponent(categoria ?? '')}`)
      return r.ok ? ((await r.json()) as RaioX) : null
    },
  })

  if (!ativo || !data || (!data.desconto && !data.concorrentes)) return null

  const nomeCat = CATEGORIA_LABEL_CURTO[categoria ?? ''] ?? categoria
  const meses = Math.round(data.janelaDias / 30.4)

  return (
    <div className="mt-3 rounded-xl border border-subtle2 bg-bg4/30 px-3.5 py-3">
      <div className="flex items-start gap-2 mb-2.5">
        <Crosshair size={13} className="text-accent mt-0.5 flex-shrink-0" />
        <div className="min-w-0">
          <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">Raio-X da disputa</div>
          <div className="text-[11px] text-muted leading-snug">
            Pregões de {nomeCat?.toLowerCase()} deste órgão nos últimos {meses} meses:{' '}
            {data.base.licitacoes} {data.base.licitacoes === 1 ? 'pregão' : 'pregões'}, {data.base.itens} itens homologados.
          </div>
        </div>
      </div>

      {data.desconto && (
        <div className="flex items-baseline gap-2.5 flex-wrap mb-2.5">
          <span className="text-[22px] font-mono-custom font-bold text-strong leading-none">{data.desconto.mediana}%</span>
          <span className="text-[11px] text-muted leading-snug">
            é o desconto típico do vencedor sobre o valor estimado. Metade dos itens fechou entre{' '}
            <span className="text-strong font-medium">{data.desconto.faixa[0]}%</span> e{' '}
            <span className="text-strong font-medium">{data.desconto.faixa[1]}%</span> abaixo do estimado.
          </span>
        </div>
      )}

      {data.concorrentes && data.concorrentes.length > 0 && (
        <div>
          <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider mb-1">
            Quem mais ganha aqui
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-[9px] font-mono-custom text-faint uppercase tracking-wide text-left">
                  <th className="font-normal py-1 pr-3">Fornecedor</th>
                  <th className="font-normal py-1 pr-3 text-right whitespace-nowrap">Itens ganhos</th>
                  <th className="font-normal py-1 pr-3 text-right whitespace-nowrap">Desconto típico</th>
                  <th className="font-normal py-1 pr-3 text-right whitespace-nowrap">Valor</th>
                  <th className="font-normal py-1 text-right whitespace-nowrap">Última</th>
                </tr>
              </thead>
              <tbody>
                {data.concorrentes.map((c) => (
                  <tr key={c.cnpj} className="border-t border-subtle/60">
                    <td className="py-1.5 pr-3 text-strong min-w-[160px] max-w-[360px]">
                      <span className="flex items-baseline gap-1.5 min-w-0">
                        <span className="truncate" title={c.nome}>{c.nome}</span>
                        {c.porte && PORTE[c.porte] && (
                          <span className="text-[9px] font-mono-custom text-faint flex-shrink-0">{PORTE[c.porte]}</span>
                        )}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono-custom whitespace-nowrap">
                      {c.vitorias} <span className="text-faint">({c.participacao}%)</span>
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono-custom whitespace-nowrap">
                      {c.desconto != null ? `${c.desconto}%` : <span className="text-faint" title="Poucos itens dele aqui para um desconto típico">—</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono-custom whitespace-nowrap text-muted">{formatBRL(c.valor)}</td>
                    <td className="py-1.5 text-right font-mono-custom whitespace-nowrap text-faint">{quando(c.ultima)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-2 text-[9px] text-faint leading-snug">
        Calculado item a item sobre o valor estimado do edital, só em pregões. Itens em que o
        homologado repete o estimado ficam de fora, porque não mostram disputa.
      </p>
    </div>
  )
}
