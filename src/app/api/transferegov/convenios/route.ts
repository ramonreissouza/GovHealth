// src/app/api/transferegov/convenios/route.ts
import { NextRequest, NextResponse } from 'next/server'
import {
  buscarConveniosSaudeAtivos,
  buscarConvenios,
  normalizarConvenio,
} from '@/lib/transferegov'

export const runtime = 'nodejs'
export const revalidate = 3600 // 1h

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const uf = searchParams.get('uf') ?? undefined
    const municipio = searchParams.get('municipio') ?? undefined
    const pagina = Number(searchParams.get('pagina') ?? 1)
    const somenteAtivos = searchParams.get('ativos') !== 'false'

    const resultado = somenteAtivos
      ? await buscarConveniosSaudeAtivos(uf)
      : await buscarConvenios({ uf, municipio, pagina, tamanhoPagina: 100 })

    return NextResponse.json({
      convenios: resultado.convenios,
      total: resultado.total,
      fonte: 'TransfereGov / Portal da Transparência',
      atualizadoEm: new Date().toISOString(),
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)

    // Erro de chave não configurada — resposta clara para o dev
    if (msg.includes('PORTAL_TRANSPARENCIA_API_KEY')) {
      return NextResponse.json(
        {
          error: 'API key do Portal da Transparência não configurada',
          instrucoes:
            'Cadastre-se gratuitamente em https://portaldatransparencia.gov.br/api-de-dados e adicione a chave em PORTAL_TRANSPARENCIA_API_KEY no .env.local',
        },
        { status: 401 }
      )
    }

    console.error('[TransfereGov convenios]', error)
    return NextResponse.json(
      { error: 'Erro ao buscar convênios do TransfereGov', detalhe: msg },
      { status: 502 }
    )
  }
}
