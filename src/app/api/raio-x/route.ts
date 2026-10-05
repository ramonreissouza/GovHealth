// src/app/api/raio-x/route.ts — Raio-X da disputa de um órgão (ver src/lib/raio-x.ts).
// GET ?cnpj=<CNPJ do órgão>&cat=<categoria_saude da licitação>
// Recorte sempre órgão + categoria; categoria fora de CATEGORIAS_RAIO_X nem consulta o banco.
//
// A consulta só traz os itens homologados do recorte (pregão, últimos 24 meses). Filtro de
// razão, percentis e concorrentes são calculados em calcularRaioX, onde há teste. O maior
// recorte medido tem ~1 mil itens.

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getCached, setCached, TTL } from '@/lib/server-cache'
import { JANELA_DIAS, calcularRaioX, raioXDisponivel, type ItemHomologado, type RaioX } from '@/lib/raio-x'

export const runtime = 'nodejs'

// Só pregão: em dispensa, credenciamento e inexigibilidade o homologado repete o estimado
// em 64-83% dos itens — não houve disputa para medir.
const SQL = `
SELECT c.numero_controle_pncp        AS pregao,
       r.ni_fornecedor               AS fornecedor,
       r.nome_fornecedor             AS nome,
       r.porte_fornecedor            AS porte,
       to_char(r.data_resultado, 'YYYY-MM-DD') AS data,
       r.valor_unitario_homologado::float8 AS homologado,
       i.valor_unitario_estimado::float8   AS estimado,
       r.valor_total_homologado::float8    AS "valorTotal"
  FROM contratacoes c
  JOIN resultados r ON r.numero_controle_pncp = c.numero_controle_pncp
  JOIN itens i ON i.numero_controle_pncp = r.numero_controle_pncp AND i.numero_item = r.numero_item
 WHERE c.cnpj_orgao = $1
   AND c.categoria_saude = $2
   AND c.modalidade_nome LIKE 'Pregão%'
   AND r.valor_unitario_homologado > 0
   AND r.data_resultado >= current_date - ${JANELA_DIAS}
`

export async function GET(req: NextRequest) {
  const cnpj = (req.nextUrl.searchParams.get('cnpj') ?? '').replace(/\D/g, '')
  const cat = (req.nextUrl.searchParams.get('cat') ?? '').trim().toLowerCase()
  if (cnpj.length !== 14) return NextResponse.json({ erro: 'cnpj do órgão inválido' }, { status: 400 })
  if (!raioXDisponivel(cat)) return NextResponse.json({ erro: 'categoria sem Raio-X' }, { status: 404 })

  const chave = `raio-x:${cnpj}:${cat}`
  const cache = getCached<RaioX>(chave)
  if (cache) return NextResponse.json(cache)

  try {
    const raio = calcularRaioX(await query<ItemHomologado>(SQL, [cnpj, cat]))
    // O histórico muda uma vez por dia (sync noturno de resultados).
    setCached(chave, raio, TTL.LONG)
    return NextResponse.json(raio)
  } catch (e) {
    console.error('[raio-x]', e)
    return NextResponse.json({ erro: 'Não foi possível montar o Raio-X agora.' }, { status: 503 })
  }
}
