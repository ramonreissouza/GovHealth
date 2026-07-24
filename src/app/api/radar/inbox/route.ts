// src/app/api/radar/inbox/route.ts — caixa de entrada única do Radar.
// GET: mensagens (com filtros) + KPIs + SAÚDE dos conectores (requisito 4.2).
// Também dispara a seleção automática (throttle ~10 min) para manter o conjunto
// de processos e os alertas de nova licitação em dia.

import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { tenantDe } from '@/lib/radar/db'
import { sincronizarSelecao } from '@/lib/radar/selecao'

export const runtime = 'nodejs'
export const maxDuration = 30

async function talvezSincronizar(titularId: string, userId: string) {
  const ultima = await queryOne<{ criado_em: string }>(
    `SELECT criado_em FROM radar_auditoria
      WHERE titular_id = $1 AND acao = 'selecao'
      ORDER BY criado_em DESC LIMIT 1`,
    [titularId],
  )
  const recente = ultima && (Date.now() - new Date(ultima.criado_em).getTime() < 10 * 60_000)
  if (recente) return
  try { await sincronizarSelecao(titularId, userId) } catch (e) { console.warn('[radar/inbox] selecao:', e) }
}

export async function GET(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  await talvezSincronizar(t.titularId, t.userId)

  const sp = req.nextUrl.searchParams
  const cond: string[] = ['m.titular_id = $1']
  const params: unknown[] = [t.titularId]
  const add = (frag: string, val: unknown) => { params.push(val); cond.push(frag.replace('$?', `$${params.length}`)) }
  if (sp.get('cnpj')) add('m.cnpj = $?', sp.get('cnpj')!.replace(/\D+/g, ''))
  if (sp.get('processo')) add('m.processo_id = $?', sp.get('processo'))
  if (sp.get('prioridade')) add('m.prioridade = $?', sp.get('prioridade'))
  if (sp.get('categoria')) add('$? = ANY(m.categorias)', sp.get('categoria'))
  if (sp.get('lida') === '0') cond.push('m.lida = false')
  if (sp.get('lida') === '1') cond.push('m.lida = true')

  const mensagens = await query(
    `SELECT m.id, m.processo_id, m.conector_id, m.cnpj, m.licitacao_id, m.autor, m.texto,
            m.anexos, m.horario_origem, m.capturado_em, m.categorias, m.prioridade,
            m.lida, m.lida_por, m.lida_em, p.titulo, p.link_portal
       FROM radar_mensagens m
       LEFT JOIN radar_processos p ON p.id = m.processo_id
      WHERE ${cond.join(' AND ')}
      ORDER BY m.lida ASC, m.capturado_em DESC
      LIMIT 300`,
    params,
  )

  const [kpi] = await query<{ nao_lidas: string; processos_ativos: string }>(
    `SELECT
       (SELECT count(*) FROM radar_mensagens WHERE titular_id = $1 AND lida = false) AS nao_lidas,
       (SELECT count(*) FROM radar_processos WHERE titular_id = $1 AND status = 'ativo') AS processos_ativos`,
    [t.titularId],
  )

  const saude = await query<{
    credencial_id: string; conector_id: string; cnpj: string; status: string
    verificado_em: string | null; tentado_em: string | null; detalhe: string | null
  }>(
    `SELECT s.credencial_id, s.conector_id, c.cnpj, s.status, s.verificado_em, s.tentado_em, s.detalhe
       FROM radar_saude s JOIN radar_credenciais c ON c.id = s.credencial_id
      WHERE s.titular_id = $1`,
    [t.titularId],
  )

  return NextResponse.json({
    mensagens,
    kpis: {
      naoLidas: Number(kpi?.nao_lidas ?? 0),
      processosAtivos: Number(kpi?.processos_ativos ?? 0),
      conectores: saude.length,
    },
    saude: saude.map((s) => ({
      credencialId: s.credencial_id, conectorId: s.conector_id, cnpj: s.cnpj,
      status: s.status, verificadoEm: s.verificado_em, tentadoEm: s.tentado_em, detalhe: s.detalhe,
    })),
    atualizadoEm: new Date().toISOString(),
  })
}
