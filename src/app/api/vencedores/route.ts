// src/app/api/vencedores/route.ts
// Agrega fornecedores vencedores de licitações de saúde via PNCP /resultado

import { NextRequest, NextResponse } from 'next/server'
import { buscarContratacoes, buscarResultadoCompra, buscarVencedoresSaude, isSaudeRelated } from '@/lib/pncp'
import { inferirCategoria } from '@/lib/score-engine'
import { getCached, setCached, TTL } from '@/lib/server-cache'
import { MOCK_VENCEDORES } from '@/lib/mock-data'

export const runtime = 'nodejs'
export const revalidate = 3600

export interface VencedorAgregado {
  id: string
  nome: string
  cnpj: string
  valor: number
  contratos: number
  ufs: string[]
  categorias: string[]
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const fonte = searchParams.get('fonte')
  const uf = searchParams.get('uf') ?? undefined

  // fonte=orgaos → consolidação de vencedores por órgão (homologações recentes via /proposta)
  if (fonte === 'orgaos') {
    const cacheKey = `vencedores:orgaos:${uf ?? ''}`
    const cachedOrgaos = getCached<object>(cacheKey)
    if (cachedOrgaos) return NextResponse.json(cachedOrgaos)

    try {
      const mapa = await buscarVencedoresSaude(uf)
      const orgaos = Object.entries(mapa)
        .map(([cnpj, d]) => ({ cnpj, ...d }))
        .sort((a, b) => b.valorTotal - a.valorTotal)
        .slice(0, 50)
      const payload = {
        orgaos,
        total: orgaos.length,
        fonte: 'PNCP /contratacoes/proposta (consolidado por órgão)',
        atualizadoEm: new Date().toISOString(),
      }
      setCached(cacheKey, payload, TTL.MEDIUM)
      return NextResponse.json(payload)
    } catch (error) {
      console.error('[vencedores:orgaos]', error)
      return NextResponse.json({ error: String(error) }, { status: 500 })
    }
  }

  const cached = getCached<object>('vencedores')
  if (cached) return NextResponse.json(cached)

  try {
    // Usa janelas mais amplas (2023-2025) para capturar contratos já homologados
    const slots: [string, string, number][] = [
      ['2025-07-01', '2025-12-31', 6],
      ['2025-01-01', '2025-06-30', 6],
      ['2024-07-01', '2024-12-31', 6],
      ['2024-01-01', '2024-06-30', 6],
      ['2023-07-01', '2023-12-31', 6],
      ['2023-01-01', '2023-06-30', 6],
    ]

    const fetches = await Promise.allSettled(
      slots.map(([dataInicial, dataFinal, modalidade]) =>
        buscarContratacoes({ dataInicial, dataFinal, modalidade, tamanhoPagina: 40 })
      )
    )

    // Inclui TODOS contratos de saúde (não só com valorHomologado > 0)
    // O /resultado retornará vazio para os não-homologados — é esperado
    const contratos = fetches
      .flatMap((r) => (r.status === 'fulfilled' ? r.value.data : []))
      .filter((c) => isSaudeRelated(c.objetoCompra))
      // Prioriza os que já têm valor homologado registrado
      .sort((a, b) =>
        ((b.valorTotalHomologado ?? 0) || (b.valorTotalEstimado ?? 0)) -
        ((a.valorTotalHomologado ?? 0) || (a.valorTotalEstimado ?? 0))
      )
      .slice(0, 10)  // 10 resultado calls max — manter tempo de resposta razoável

    // Busca resultado por contrato em paralelo
    const resultados = await Promise.allSettled(
      contratos.map((c) =>
        buscarResultadoCompra(c.orgaoEntidade.cnpj, c.anoCompra, c.sequencialCompra).then(
          (items) =>
            items.map((r) => ({
              niFornecedor: r.niFornecedor,
              nomeFornecedor: r.nomeFornecedor,
              valorTotalHomologado: r.valorTotalHomologado ?? 0,
              uf: c.unidadeOrgao?.ufSigla ?? c.orgaoEntidade.ufSigla ?? '',
              categoria: inferirCategoria(c.objetoCompra),
            }))
        )
      )
    )

    // Agrega por fornecedor
    const mapa: Record<
      string,
      { nome: string; cnpj: string; valor: number; contratos: number; ufs: Set<string>; categorias: Set<string> }
    > = {}

    for (const r of resultados) {
      if (r.status !== 'fulfilled') continue
      for (const item of r.value) {
        const key = item.niFornecedor || item.nomeFornecedor
        if (!key || !item.nomeFornecedor) continue
        if (!mapa[key]) {
          mapa[key] = {
            nome: item.nomeFornecedor,
            cnpj: item.niFornecedor ?? '',
            valor: 0,
            contratos: 0,
            ufs: new Set(),
            categorias: new Set(),
          }
        }
        mapa[key].valor += item.valorTotalHomologado
        mapa[key].contratos++
        if (item.uf) mapa[key].ufs.add(item.uf)
        if (item.categoria) mapa[key].categorias.add(item.categoria)
      }
    }

    const vencedores: VencedorAgregado[] = Object.entries(mapa)
      .sort((a, b) => b[1].valor - a[1].valor)
      .slice(0, 10)
      .map(([id, d]) => ({
        id,
        nome: d.nome,
        cnpj: d.cnpj,
        valor: d.valor,
        contratos: d.contratos,
        ufs: [...d.ufs],
        categorias: [...d.categorias],
      }))

    // Fallback: se PNCP não retornou fornecedores, usa dataset local
    const mockVencedores: VencedorAgregado[] = MOCK_VENCEDORES.map((v) => ({
      id: v.cnpj,
      nome: v.nome,
      cnpj: v.cnpj,
      valor: v.valorTotal,
      contratos: v.vitorias,
      ufs: ['SP', 'RJ', 'MG', 'BA', 'RS'],
      categorias: ['imagem', 'uti', 'laboratorio'],
    }))

    const resultFinal = vencedores.length > 0
      ? { vencedores, fallback: false, atualizadoEm: new Date().toISOString() }
      : {
          vencedores: mockVencedores,
          fallback: true,
          atualizadoEm: new Date().toISOString(),
        }

    setCached('vencedores', resultFinal, TTL.MEDIUM)
    return NextResponse.json(resultFinal)
  } catch (error) {
    console.error('[vencedores]', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
