// src/app/api/estados-insights/route.ts — Insights de portais estaduais (piloto BA).
// Expõe o Item 3 (despesas + contratos de saúde) para análise:
//  - demanda: despesa de saúde paga por órgão/ano (para onde vai a verba);
//  - renovacoes: contratos de saúde vencendo em breve (oportunidade de re-licitação);
//  - concorrencia: maiores fornecedores de saúde por valor contratado.
// Complementa o Radar de Verba (emendas estaduais / capacidade de pagamento — itens 1 e 2).

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getCached, setCached, TTL } from '@/lib/server-cache'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const uf = (req.nextUrl.searchParams.get('uf') || 'BA').toUpperCase()
  const janela = Number(req.nextUrl.searchParams.get('dias') || 180) // janela de vencimento

  const cacheKey = `estados-insights:${uf}:${janela}`
  const cached = getCached<object>(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    const [demanda, renovacoes, concorrencia, resumo] = await Promise.all([
      query(`SELECT ano, orgao_nome AS orgao, pago::float8 AS pago, empenhado::float8 AS empenhado
               FROM despesa_saude_agg WHERE uf=$1 AND favorecido_key='' ORDER BY ano DESC, pago DESC LIMIT 40`, [uf]),
      query(`SELECT numero, orgao, fornecedor_nome AS fornecedor, objeto, valor::float8 AS valor,
                    to_char(data_fim,'YYYY-MM-DD') AS data_fim
               FROM contrato_estadual
              WHERE uf=$1 AND categoria_saude AND data_fim BETWEEN current_date AND current_date + $2::int
              ORDER BY valor DESC NULLS LAST LIMIT 100`, [uf, janela]),
      query(`SELECT fornecedor_nome AS fornecedor, fornecedor_doc AS doc, count(*)::int AS contratos,
                    sum(valor)::float8 AS valor_total
               FROM contrato_estadual WHERE uf=$1 AND categoria_saude AND fornecedor_nome<>''
              GROUP BY 1,2 ORDER BY valor_total DESC NULLS LAST LIMIT 30`, [uf]),
      query(`SELECT
                (SELECT count(*)::int FROM contrato_estadual WHERE uf=$1 AND categoria_saude) AS contratos_saude,
                (SELECT count(*)::int FROM contrato_estadual WHERE uf=$1 AND categoria_saude AND data_fim BETWEEN current_date AND current_date + $2::int) AS vencendo,
                (SELECT count(*)::int FROM emendas_estaduais WHERE uf=$1 AND categoria_saude) AS emendas_saude`, [uf, janela]),
    ])

    const payload = {
      uf,
      janelaDias: janela,
      resumo: resumo[0] ?? {},
      demanda,       // demanda de saúde por órgão/ano
      renovacoes,    // contratos vencendo (oportunidade)
      concorrencia,  // maiores fornecedores
      fonte: `Portal de Transparência de ${uf} (dados abertos)`,
      atualizadoEm: new Date().toISOString(),
    }
    setCached(cacheKey, payload, TTL.SHORT)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[estados-insights]', error)
    return NextResponse.json({ error: 'Erro ao carregar insights estaduais', detalhe: String(error) }, { status: 500 })
  }
}
