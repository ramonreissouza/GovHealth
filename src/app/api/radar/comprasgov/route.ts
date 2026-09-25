import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { tenantDe } from '@/lib/radar/db'
import { comprasgovDoTenant, configuracaoComprasgov, modoComprasgov, schemaComprasgovPronto } from '@/lib/radar/comprasgov'
import { validarChaveCompra, linkComprasgovValido } from '@/lib/radar/comprasgov-identidade.mjs'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  return NextResponse.json(await comprasgovDoTenant(t.titularId))
}

export async function POST(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  // Esta porta é SÓ do modo API. No modo público o coletor nunca leria o que entrasse
  // aqui (ver modoComprasgov) — recusar é melhor que aceitar e não monitorar.
  if (modoComprasgov() !== 'api') {
    return NextResponse.json({
      error: 'O Radar está lendo o Compras.gov.br pelo painel público. Cadastre a compra colando o link público de acompanhamento em "Adicionar processo".',
      modo: 'publico',
    }, { status: 409 })
  }
  const b = await req.json().catch(() => null)
  let chave: string
  try { chave = validarChaveCompra(b?.chaveCompra) } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
  const cnpj = typeof b.cnpj === 'string' ? b.cnpj.replace(/\D/g, '') : ''
  const titulo = typeof b.titulo === 'string' ? b.titulo.trim() : ''
  const link = typeof b.linkPortal === 'string' ? b.linkPortal.trim() : ''
  if (!/^\d{14}$/.test(cnpj) || !titulo || titulo.length > 240 || !linkComprasgovValido(link) || link.length > 2000) {
    return NextResponse.json({ error: 'Informe CNPJ (14 dígitos), título (até 240 caracteres) e link HTTPS da compra no Compras.gov.br/Comprasnet.' }, { status: 400 })
  }
  if (!(await schemaComprasgovPronto())) return NextResponse.json({ error: 'Cadastro aguardando atualização do serviço. Contate o administrador.' }, { status: 503 })
  const { ambiente } = configuracaoComprasgov()
  if (!['producao', 'homologacao'].includes(ambiente)) return NextResponse.json({ error: 'Ambiente do serviço inválido.' }, { status: 503 })
  // Uma instrução = transação atômica, inclusive atrás do PgBouncer. Repetir o
  // cadastro não reativa uma compra pausada nem apaga checkpoints já capturados.
  const rows = await query<{ processo_id: string }>(
    `WITH processo AS (
       INSERT INTO radar_processos (id,titular_id,user_id,conector_id,cnpj,licitacao_id,titulo,link_portal,origem)
       VALUES ($1,$2,$3,'comprasgov',$4,$5,$6,$7,'manual')
       ON CONFLICT (titular_id,conector_id,cnpj,licitacao_id)
       DO UPDATE SET titulo=EXCLUDED.titulo,link_portal=EXCLUDED.link_portal,atualizado_em=now()
       RETURNING id
     ), canais AS (
       INSERT INTO radar_comprasgov_canais (processo_id,canal,ambiente,chave_compra)
       SELECT p.id,c.canal,$8,$9 FROM processo p CROSS JOIN (VALUES ('chat'),('diligencias')) c(canal)
       ON CONFLICT DO NOTHING
     ) SELECT id AS processo_id FROM processo`,
    [randomUUID(), t.titularId, t.userId, cnpj, `comprasgov:${ambiente}:${chave}`, titulo, link, ambiente, chave],
  )
  return NextResponse.json({ processoId: rows[0].processo_id, status: 'cadastrado', mensagem: 'Compra cadastrada. A conexão depende da primeira leitura completa.' }, { status: 201 })
}
