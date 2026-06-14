// src/app/api/debug/route.ts
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET() {
  const results: Record<string, unknown> = {}
  const fmt = (d: Date) => d.toISOString().split('T')[0].replace(/-/g, '')
  const key = process.env.PORTAL_TRANSPARENCIA_API_KEY!

  // 1. PNCP — quantos itens de SAÚDE em 1 página de dispensas (modalidade 8)
  try {
    const hoje = new Date()
    const trinta = new Date(hoje.getTime() - 30 * 86400000)
    const url = `https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=${fmt(trinta)}&dataFinal=${fmt(hoje)}&codigoModalidadeContratacao=8&pagina=1&tamanhoPagina=50`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    const data = await res.json()
    const kws = ['saúde','hospital','médic','tomógrafo','ultrassom','uti','enfermagem','medicamento','equipamento','clínic','ambulânc','cirúrg']
    const itens = (data.data ?? []).map((c: any) => c.objetoCompra)
    const saude = itens.filter((o: string) => kws.some(k => (o ?? '').toLowerCase().includes(k)))
    results.pncp = {
      totalNaPagina: itens.length,
      itensSaudeEncontrados: saude.length,
      amostraSaude: saude.slice(0, 5),
      amostraGeral: itens.slice(0, 3),
    }
  } catch (e) {
    results.pncp = { erro: String(e) }
  }

  // 2. Emendas — varre 5 páginas e lista TODAS as funções existentes
  try {
    const ano = new Date().getFullYear()
    const todasFuncoes = new Set<string>()
    let totalSaude = 0
    for (let p = 1; p <= 5; p++) {
      const res = await fetch(
        `https://api.portaldatransparencia.gov.br/api-de-dados/emendas?ano=${ano}&pagina=${p}`,
        { headers: { 'chave-api-dados': key, Accept: 'application/json' } }
      )
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0) break
      for (const e of data) {
        if (e.funcao) todasFuncoes.add(e.funcao)
        if ((e.funcao ?? '').toLowerCase().includes('saúde') || (e.funcao ?? '').toLowerCase().includes('saude')) totalSaude++
      }
    }
    results.emendas = {
      funcoesEncontradas: [...todasFuncoes],
      totalSaudeEm5Paginas: totalSaude,
    }
  } catch (e) {
    results.emendas = { erro: String(e) }
  }

  // 3. Convênios de saúde — testa filtro por função saúde
  try {
    const res = await fetch(
      'https://api.portaldatransparencia.gov.br/api-de-dados/convenios?uf=CE&pagina=1',
      { headers: { 'chave-api-dados': key, Accept: 'application/json' } }
    )
    const data = await res.json()
    results.convenios = {
      total: Array.isArray(data) ? data.length : 0,
      objetos: Array.isArray(data) ? data.slice(0, 5).map((c: any) => c.dimConvenio?.objeto?.substring(0, 60)) : [],
    }
  } catch (e) {
    results.convenios = { erro: String(e) }
  }

  return NextResponse.json(results, { status: 200 })
}