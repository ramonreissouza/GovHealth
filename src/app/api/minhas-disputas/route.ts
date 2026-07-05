// src/app/api/minhas-disputas/route.ts
// "Minhas Disputas": as licitações que o fornecedor logado participou (match pelo
// CNPJ da conta contra resultados.ni_fornecedor), com o valor homologado dele, o
// vencedor de cada item e — quando existir — os concorrentes.
//
// LIMITAÇÃO DE DADOS (importante e honesta): os dados abertos homologados do PNCP
// publicam, na esmagadora maioria dos itens, APENAS o vencedor. Preços e
// especificações das propostas concorrentes NÃO estão no dado estruturado — vivem
// na ata de julgamento / propostas do edital (PDF). Por isso sinalizamos o gap.

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { query, queryOne } from '@/lib/db'
import { getCached, setCached, TTL } from '@/lib/server-cache'

export const runtime = 'nodejs'

const soDigitos = (s: string) => s.replace(/\D/g, '')

interface DisputaHeaderRow {
  nc: string
  uf: string | null
  orgao: string | null
  objeto: string | null
  data: string | null
  meus_itens: number
  meu_valor: number
  itens_vencidos: number
}
interface LinhaRow {
  nc: string
  numero_item: number
  nome_catmat: string | null
  ni_fornecedor: string | null
  nome_fornecedor: string | null
  ordem: number | null
  valor: number | null
}

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  const email = (token?.id as string | undefined) ?? (token?.sub as string | undefined)
  if (!email) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  const conta = await queryOne<{ cnpj: string | null; empresa: string | null }>(
    `SELECT cnpj, empresa FROM usuarios WHERE id = $1`, [email.toLowerCase()],
  )
  const cnpj = conta?.cnpj ? soDigitos(conta.cnpj) : ''
  if (!cnpj) {
    return NextResponse.json({
      fornecedor: { cnpj: null, nome: conta?.empresa ?? null },
      semCnpj: true,
      disputas: [], ufs: [],
    })
  }

  const uf = req.nextUrl.searchParams.get('uf')?.toUpperCase().trim() || undefined
  const cacheKey = `disputas:${cnpj}:${uf ?? ''}`
  const cached = getCached<object>(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    // Cabeçalho das disputas do fornecedor (join com contratacoes p/ órgão/objeto/data).
    const params: unknown[] = [cnpj]
    let ufWhere = ''
    if (uf) { params.push(uf); ufWhere = `AND r.uf = $${params.length}` }
    const headers = await query<DisputaHeaderRow>(
      `SELECT r.numero_controle_pncp AS nc,
              MAX(r.uf) AS uf,
              MAX(c.razao_social_orgao) AS orgao,
              MAX(c.objeto_compra) AS objeto,
              to_char(MAX(c.data_publicacao), 'YYYY-MM-DD') AS data,
              COUNT(*)::int AS meus_itens,
              COALESCE(SUM(r.valor_total_homologado), 0)::float8 AS meu_valor,
              COUNT(*) FILTER (WHERE r.ordem_classificacao_srp = 1)::int AS itens_vencidos
         FROM resultados r
         LEFT JOIN contratacoes c ON c.numero_controle_pncp = r.numero_controle_pncp
        WHERE regexp_replace(r.ni_fornecedor, '\\D', '', 'g') = $1 ${ufWhere}
        GROUP BY r.numero_controle_pncp
        ORDER BY data DESC NULLS LAST
        LIMIT 10`,
      params,
    )

    const ncs = headers.map((h) => h.nc)
    // Todas as linhas (eu + concorrentes) dos itens dessas licitações.
    const linhas = ncs.length
      ? await query<LinhaRow>(
          `SELECT numero_controle_pncp AS nc, numero_item, nome_catmat,
                  ni_fornecedor, nome_fornecedor, ordem_classificacao_srp AS ordem,
                  valor_total_homologado::float8 AS valor
             FROM resultados
            WHERE numero_controle_pncp = ANY($1)
            ORDER BY numero_item, ordem NULLS LAST`,
          [ncs],
        )
      : []

    // Monta cada disputa com seus itens; marca "eu" e concorrentes.
    const porNc = new Map<string, LinhaRow[]>()
    for (const l of linhas) { (porNc.get(l.nc) ?? porNc.set(l.nc, []).get(l.nc)!).push(l) }

    let totalConcorrentes = 0
    const disputas = headers.map((h) => {
      const rows = porNc.get(h.nc) ?? []
      const porItem = new Map<number, LinhaRow[]>()
      for (const r of rows) { (porItem.get(r.numero_item) ?? porItem.set(r.numero_item, []).get(r.numero_item)!).push(r) }
      const itens = [...porItem.entries()].map(([numeroItem, rs]) => {
        const meu = rs.find((r) => soDigitos(r.ni_fornecedor ?? '') === cnpj)
        const concorrentes = rs.filter((r) => soDigitos(r.ni_fornecedor ?? '') !== cnpj)
        totalConcorrentes += concorrentes.length
        const vencedor = rs.find((r) => r.ordem === 1) ?? rs[0]
        return {
          numeroItem,
          descricao: meu?.nome_catmat ?? rs[0]?.nome_catmat ?? '(sem descrição)',
          meuValor: meu?.valor ?? null,
          minhaOrdem: meu?.ordem ?? null,
          venciEste: soDigitos(vencedor?.ni_fornecedor ?? '') === cnpj,
          vencedor: vencedor ? { nome: vencedor.nome_fornecedor, valor: vencedor.valor } : null,
          concorrentes: concorrentes.map((cc) => ({ nome: cc.nome_fornecedor, valor: cc.valor, ordem: cc.ordem })),
        }
      })
      return {
        nc: h.nc,
        uf: h.uf,
        orgao: h.orgao,
        objeto: h.objeto,
        data: h.data,
        meusItens: h.meus_itens,
        meuValor: h.meu_valor,
        itensVencidos: h.itens_vencidos,
        venci: h.itens_vencidos === h.meus_itens ? 'total' : h.itens_vencidos > 0 ? 'parcial' : 'nao',
        link: `https://pncp.gov.br/app/editais/${h.nc.split('-')[0]}`,
        itens,
      }
    })

    const ufsRows = await query<{ uf: string }>(
      `SELECT DISTINCT uf FROM resultados WHERE regexp_replace(ni_fornecedor,'\\D','','g') = $1 AND uf IS NOT NULL ORDER BY uf`,
      [cnpj],
    )

    const payload = {
      fornecedor: { cnpj: conta?.cnpj ?? null, nome: conta?.empresa ?? null },
      disputas,
      ufs: ufsRows.map((u) => u.uf),
      // Gap de dados: concorrentes por item são raríssimos no dado aberto homologado.
      concorrentesDisponiveis: totalConcorrentes,
      aviso:
        'Os dados abertos homologados do PNCP publicam, na maioria dos itens, apenas o vencedor. ' +
        'Preços e especificações das propostas dos concorrentes não estão no dado estruturado — ' +
        'ficam na ata de julgamento / propostas do edital (PDF), que exigiria extração documental.',
      atualizadoEm: new Date().toISOString(),
    }
    setCached(cacheKey, payload, TTL.SHORT)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[minhas-disputas]', error)
    return NextResponse.json({ error: 'Erro ao buscar disputas', detalhe: String(error) }, { status: 500 })
  }
}
