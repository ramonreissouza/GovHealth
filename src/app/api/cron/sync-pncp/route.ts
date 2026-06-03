// src/app/api/cron/sync-pncp/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { buscarComprasSaude } from '@/lib/pncp'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  // Vercel Cron autentica via CRON_SECRET
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const ontem = new Date()
    ontem.setDate(ontem.getDate() - 1)
    const dataInicial = ontem.toISOString().split('T')[0]

    const resultado = await buscarComprasSaude({ dataInicial, tamanhoPagina: 200 })

    console.log(`[cron:sync-pncp] ${resultado.data.length} compras de saúde sincronizadas`)

    return NextResponse.json({
      ok: true,
      sincronizados: resultado.data.length,
      rodarEm: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[cron:sync-pncp]', error)
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 })
  }
}
