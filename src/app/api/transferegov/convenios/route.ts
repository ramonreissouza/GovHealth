// src/app/api/transferegov/convenios/route.ts
import { NextRequest, NextResponse } from 'next/server'
import {
  buscarConveniosSaudeUF,
  buscarConveniosSaudeNacional,
  buscarConveniosUF,
  buscarConveniosMunicipio,
} from '@/lib/transferegov'

export const runtime = 'nodejs'
export const revalidate = 3600 // 1h

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const uf = searchParams.get('uf')?.toUpperCase() ?? undefined
    const municipio = searchParams.get('municipio')?.trim() || undefined
    const pagina = Number(searchParams.get('pagina') ?? 1)
    const somenteAtivos = searchParams.get('ativos') !== 'false'

    // municipio → convênios "Em Execução" daquele município (opcionalmente com UF).
    // somenteAtivos → filtra pelo objeto (saúde). Por UF se informada, senão cobertura nacional.
    // ativos=false → página crua de uma UF (a API do TransfereGov exige filtro por UF).
    let convenios
    if (municipio) {
      convenios = await buscarConveniosMunicipio(municipio, uf, pagina)
    } else if (somenteAtivos) {
      convenios = uf
        ? await buscarConveniosSaudeUF(uf)
        : await buscarConveniosSaudeNacional()
    } else {
      if (!uf) {
        return NextResponse.json(
          { error: 'Parâmetro "uf" é obrigatório quando ativos=false (a API exige filtro por UF).' },
          { status: 400 },
        )
      }
      convenios = await buscarConveniosUF({ uf, pagina })
    }

    return NextResponse.json({
      convenios,
      total: convenios.length,
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
