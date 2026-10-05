// src/app/api/raio-x/route.ts — Raio-X da disputa de um órgão (ver src/lib/raio-x.ts).
// GET ?cnpj=<CNPJ do órgão>&cat=<categoria_saude da licitação>
// Recorte sempre órgão + categoria; categoria fora de CATEGORIAS_RAIO_X nem consulta o banco.
//
// Só pregão: em dispensa, credenciamento e inexigibilidade o homologado repete o estimado
// em 64-83% dos itens — não houve disputa para medir. Pelo mesmo motivo sai todo item com
// homologado = estimado, e a razão fica entre 0,05 e 1,5 (fora disso é unidade trocada
// entre estimado e homologado, não desconto).

import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'
import { getCached, setCached, TTL } from '@/lib/server-cache'
import {
  JANELA_DIAS, TOP_CONCORRENTES, estatDoBanco, montarRaioX, raioXDisponivel,
  type ConcorrenteBruto, type RaioX,
} from '@/lib/raio-x'

export const runtime = 'nodejs'

const ESTAT = `json_build_object(
  'n',          count(ratio),
  'p25',        percentile_cont(0.25) WITHIN GROUP (ORDER BY ratio),
  'p50',        percentile_cont(0.5)  WITHIN GROUP (ORDER BY ratio),
  'p75',        percentile_cont(0.75) WITHIN GROUP (ORDER BY ratio),
  'itens',      count(*),
  'licitacoes', count(DISTINCT ncp),
  'licitacoes_desconto', count(DISTINCT ncp) FILTER (WHERE ratio IS NOT NULL),
  'vencedores', count(DISTINCT forn))`

const SQL = `
WITH base AS (
  SELECT r.ni_fornecedor forn, r.nome_fornecedor nome, r.porte_fornecedor porte,
         r.data_resultado dt, r.valor_total_homologado vt, c.numero_controle_pncp ncp,
         CASE WHEN i.valor_unitario_estimado > 0
               AND r.valor_unitario_homologado <> i.valor_unitario_estimado
               AND r.valor_unitario_homologado / i.valor_unitario_estimado > 0.05
               AND r.valor_unitario_homologado / i.valor_unitario_estimado <= 1.5
              THEN r.valor_unitario_homologado / i.valor_unitario_estimado END AS ratio
    FROM contratacoes c
    JOIN resultados r ON r.numero_controle_pncp = c.numero_controle_pncp
    JOIN itens i ON i.numero_controle_pncp = r.numero_controle_pncp AND i.numero_item = r.numero_item
   WHERE c.cnpj_orgao = $1
     AND c.categoria_saude = $2
     AND c.modalidade_nome LIKE 'Pregão%'
     AND r.valor_unitario_homologado > 0
     AND r.data_resultado >= current_date - ${JANELA_DIAS}
)
SELECT
  (SELECT ${ESTAT} FROM base) AS estat,
  (SELECT coalesce(json_agg(x), '[]'::json) FROM (
     SELECT forn AS cnpj, max(nome) AS nome, max(porte) AS porte,
            count(*) AS vitorias, sum(vt) AS valor, count(ratio) AS n_desconto,
            count(DISTINCT ncp) FILTER (WHERE ratio IS NOT NULL) AS pregoes_desconto,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY ratio) AS ratio_mediana,
            to_char(max(dt), 'YYYY-MM-DD') AS ultima
       FROM base
      GROUP BY forn
      ORDER BY count(*) DESC, sum(vt) DESC NULLS LAST
      LIMIT ${TOP_CONCORRENTES}
  ) x) AS concorrentes
`

interface Linha {
  estat: Record<string, unknown> | null
  concorrentes: ConcorrenteBruto[] | null
}

export async function GET(req: NextRequest) {
  const cnpj = (req.nextUrl.searchParams.get('cnpj') ?? '').replace(/\D/g, '')
  const cat = (req.nextUrl.searchParams.get('cat') ?? '').trim().toLowerCase()
  if (cnpj.length !== 14) return NextResponse.json({ erro: 'cnpj do órgão inválido' }, { status: 400 })
  if (!raioXDisponivel(cat)) return NextResponse.json({ erro: 'categoria sem Raio-X' }, { status: 404 })

  const chave = `raio-x:${cnpj}:${cat}`
  const cache = getCached<RaioX>(chave)
  if (cache) return NextResponse.json(cache)

  try {
    const l = await queryOne<Linha>(SQL, [cnpj, cat])
    const raio = montarRaioX({ estat: estatDoBanco(l?.estat), concorrentes: l?.concorrentes ?? [] })
    // O histórico muda uma vez por dia (sync noturno de resultados).
    setCached(chave, raio, TTL.LONG)
    return NextResponse.json(raio)
  } catch (e) {
    console.error('[raio-x]', e)
    return NextResponse.json({ erro: 'Não foi possível montar o Raio-X agora.' }, { status: 503 })
  }
}
