// src/app/api/resultados/detalhe/route.ts — detalhe de um resultado homologado.
// Alimenta a linha expandida da Tela 1 (Vencedores): dados do convênio,
// concorrentes do mesmo item (ordem de classificação) e itens do processo.
// Tudo lido do banco (populado pelo ETL) — não chama o PNCP ao vivo.

import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'

export const runtime = 'nodejs'

interface CabecalhoRow {
  numero_controle_pncp: string
  cnpj_orgao: string | null
  razao_social_orgao: string | null
  municipio: string | null
  uf: string | null
  modalidade_nome: string | null
  objeto_compra: string | null
  ano_compra: number | null
  sequencial_compra: number | null
  valor_total_estimado: number | null
  data_publicacao: string | null
  situacao_id: number | null
}

interface ItemRow {
  numero_item: number | null
  descricao: string | null
  codigo_catmat: string | null
  nome_catmat: string | null
  quantidade: number | null
  valor_unitario_estimado: number | null
  situacao_item_id: number | null
}

interface ConcorrenteRow {
  ni_fornecedor: string | null
  nome_fornecedor: string | null
  porte_fornecedor: string | null
  qtd: number | null
  valor_unitario: number | null
  valor: number | null
  ordem: number | null
  data_resultado: string | null
}

interface ProcessoItemRow {
  numero_item: number | null
  item: string | null
  codigo_catmat: string | null
  vencedor: string | null
  valor: number | null
}

// mapa de situação da compra (situacaoCompraId do PNCP)
const SITUACAO: Record<number, string> = {
  1: 'Divulgada no PNCP',
  2: 'Revogada',
  3: 'Anulada',
  4: 'Suspensa',
}

// monta o link público do processo no portal do PNCP a partir do cabeçalho
function pncpUrl(cnpj: string | null, ano: number | null, seq: number | null): string | null {
  if (!cnpj || !ano || seq == null) return null
  return `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seq}`
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const convenio = searchParams.get('convenio')?.trim()
  const itemParam = searchParams.get('item')
  const numeroItem = itemParam != null && itemParam !== '' ? Number(itemParam) : null

  if (!convenio) {
    return NextResponse.json({ error: 'Parâmetro "convenio" (numero_controle_pncp) obrigatório.' }, { status: 400 })
  }

  try {
    const [cabecalho, item, concorrentes, processoItens] = await Promise.all([
      queryOne<CabecalhoRow>(
        `SELECT numero_controle_pncp, cnpj_orgao, razao_social_orgao, municipio, uf,
                modalidade_nome, objeto_compra, ano_compra, sequencial_compra,
                valor_total_estimado::float8 AS valor_total_estimado,
                data_publicacao, situacao_id
         FROM contratacoes WHERE numero_controle_pncp = $1`,
        [convenio],
      ),
      numeroItem != null
        ? queryOne<ItemRow>(
            `SELECT numero_item, descricao, codigo_catmat, nome_catmat,
                    quantidade::float8 AS quantidade,
                    valor_unitario_estimado::float8 AS valor_unitario_estimado,
                    situacao_item_id
             FROM itens WHERE numero_controle_pncp = $1 AND numero_item = $2`,
            [convenio, numeroItem],
          )
        : Promise.resolve(null),
      numeroItem != null
        ? query<ConcorrenteRow>(
            `SELECT ni_fornecedor, nome_fornecedor, porte_fornecedor,
                    quantidade_homologada::float8     AS qtd,
                    valor_unitario_homologado::float8 AS valor_unitario,
                    valor_total_homologado::float8    AS valor,
                    ordem_classificacao_srp           AS ordem,
                    data_resultado
             FROM resultados
             WHERE numero_controle_pncp = $1 AND numero_item = $2
             ORDER BY ordem_classificacao_srp ASC NULLS LAST,
                      valor_total_homologado ASC NULLS LAST`,
            [convenio, numeroItem],
          )
        : Promise.resolve([]),
      query<ProcessoItemRow>(
        `SELECT DISTINCT ON (r.numero_item)
                r.numero_item,
                COALESCE(NULLIF(r.nome_catmat, ''), '(sem descrição)') AS item,
                r.codigo_catmat,
                r.nome_fornecedor AS vencedor,
                r.valor_total_homologado::float8 AS valor
         FROM resultados r
         WHERE r.numero_controle_pncp = $1
         ORDER BY r.numero_item ASC,
                  r.ordem_classificacao_srp ASC NULLS LAST,
                  r.valor_total_homologado ASC NULLS LAST`,
        [convenio],
      ),
    ])

    if (!cabecalho) {
      return NextResponse.json({ error: 'Convênio não encontrado no banco.' }, { status: 404 })
    }

    return NextResponse.json({
      cabecalho: {
        ...cabecalho,
        situacao_label: cabecalho.situacao_id != null ? (SITUACAO[cabecalho.situacao_id] ?? null) : null,
        pncp_url: pncpUrl(cabecalho.cnpj_orgao, cabecalho.ano_compra, cabecalho.sequencial_compra),
      },
      item,
      concorrentes,
      processoItens,
      atualizadoEm: new Date().toISOString(),
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('DATABASE_URL') || /relation .* does not exist/i.test(msg)) {
      return NextResponse.json(
        { error: 'Banco não configurado/populado', instrucoes: 'Rode `npm run db:setup` e `npm run etl`.' },
        { status: 503 },
      )
    }
    console.error('[resultados/detalhe]', error)
    return NextResponse.json({ error: 'Erro ao consultar detalhe', detalhe: msg }, { status: 500 })
  }
}
