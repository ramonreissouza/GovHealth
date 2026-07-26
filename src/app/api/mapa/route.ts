// src/app/api/mapa/route.ts — dados agregados por MUNICÍPIO p/ o mapa de calor.
// Agrega TODAS as contratações abertas (sem resultado homologado) por município e
// categoria, junta com as coordenadas IBGE e devolve ~4,6k pontos (não os ~69k
// individuais). O cliente monta o heatmap (zoom baixo) e os círculos (zoom alto).

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { coordMunicipio } from '@/lib/geo/municipios'
import { getCached, setCached, TTL } from '@/lib/server-cache'

export const runtime = 'nodejs'

interface AggRow { uf: string; municipio: string; cat: string | null; n: number; valor: number }
interface MunicipioPonto {
  uf: string; municipio: string; lat: number; lng: number
  n: number; valor: number; cats: Record<string, number>
}

export async function GET(req: NextRequest) {
  const ano = req.nextUrl.searchParams.get('ano')
  const anoNum = ano && /^\d{4}$/.test(ano) ? Number(ano) : undefined

  const cacheKey = `mapa:municipios:${anoNum ?? 'todos'}`
  try {
    const cached = getCached<unknown>(cacheKey)
    if (cached) return NextResponse.json(cached)

    {
      const params: unknown[] = []
      const cond = [`NOT EXISTS (SELECT 1 FROM resultados r WHERE r.numero_controle_pncp = c.numero_controle_pncp)`,
        `c.municipio IS NOT NULL`, `c.uf IS NOT NULL`]
      if (anoNum) { params.push(anoNum); cond.push(`c.ano = $${params.length}`) }

      const rows = await query<AggRow>(
        `SELECT c.uf, c.municipio, COALESCE(c.categoria_saude, 'outros') AS cat,
                COUNT(*)::int AS n, COALESCE(SUM(c.valor_total_estimado), 0)::float8 AS valor
         FROM contratacoes c
         WHERE ${cond.join(' AND ')}
         GROUP BY c.uf, c.municipio, COALESCE(c.categoria_saude, 'outros')`, params)

      // Colapsa por município, acumulando o breakdown por categoria.
      const porMun = new Map<string, MunicipioPonto>()
      let semCoord = 0
      let semCoordN = 0
      for (const r of rows) {
        const coord = coordMunicipio(r.uf, r.municipio)
        if (!coord) { semCoord++; semCoordN += r.n; continue }
        const key = `${r.uf}|${r.municipio}`
        let p = porMun.get(key)
        if (!p) { p = { uf: r.uf, municipio: r.municipio, lat: coord[0], lng: coord[1], n: 0, valor: 0, cats: {} }; porMun.set(key, p) }
        p.n += r.n
        p.valor += r.valor
        const cat = r.cat ?? 'outros'
        p.cats[cat] = (p.cats[cat] ?? 0) + r.n
      }

      const pontos = [...porMun.values()].map((p) => ({ ...p, valor: Math.round(p.valor) }))
      const totalLic = pontos.reduce((s, p) => s + p.n, 0)
      const payload = {
        pontos,
        municipios: pontos.length,
        totalLicitacoes: totalLic,
        semCoord, semCoordN,
        atualizadoEm: new Date().toISOString(),
        fonte: 'PNCP · contratações abertas (agregadas por município)',
      }
      setCached(cacheKey, payload, TTL.MEDIUM)
      return NextResponse.json(payload)
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('DATABASE_URL') || /relation .* does not exist/i.test(msg)) {
      return NextResponse.json({ error: 'Banco não configurado/populado', pontos: [] }, { status: 503 })
    }
    console.error('[api/mapa]', error)
    return NextResponse.json({ error: 'Erro ao agregar o mapa', detalhe: msg, pontos: [] }, { status: 500 })
  }
}
