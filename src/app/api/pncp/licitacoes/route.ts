// src/app/api/pncp/licitacoes/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { buscarComprasSaude, buscarContratacoes, normalizarLicitacao } from '@/lib/pncp'

export const runtime = 'nodejs'
export const revalidate = 900 // 15 min

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const uf = searchParams.get('uf') ?? undefined
    const pagina = Number(searchParams.get('pagina') ?? 1)
    const tamanhoPagina = Number(searchParams.get('tamanhoPagina') ?? 50)
    const somentesSaude = searchParams.get('saude') !== 'false'
    const dataInicial = searchParams.get('dataInicial') ?? undefined
    const dataFinal = searchParams.get('dataFinal') ?? undefined

    const resultado = somentesSaude
      ? await buscarComprasSaude({ uf, tamanhoPagina, dataInicial, dataFinal })
      : await buscarContratacoes({ uf, pagina, tamanhoPagina, dataInicial, dataFinal })

    const licitacoes = resultado.data.map(normalizarLicitacao)

    return NextResponse.json({
      licitacoes,
      total: resultado.totalRegistros,
      pagina,
      fonte: 'PNCP',
      atualizadoEm: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[PNCP licitacoes]', error)
    return NextResponse.json(
      { error: 'Erro ao buscar dados do PNCP', detalhe: String(error) },
      { status: 502 }
    )
  }
}
