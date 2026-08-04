// src/app/api/radar/inbox/route.ts — caixa de entrada única do Radar.
// GET: mensagens (com filtros) + KPIs + SAÚDE dos conectores (requisito 4.2).
// Também dispara a seleção automática (throttle ~10 min) para manter o conjunto
// de processos e os alertas de nova licitação em dia.

import { NextRequest, NextResponse, after } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { tenantDe } from '@/lib/radar/db'
import { sincronizarSelecao } from '@/lib/radar/selecao'
import { resolverPortal } from '@/lib/portais'
import { cofreDisponivel } from '@/lib/radar/crypto'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * Dispara a seleção automática FORA do caminho da resposta.
 *
 * Duas correções em relação ao modelo anterior, em que a caixa esperava a seleção:
 *  1. a seleção é manutenção, não é necessária para desenhar a caixa — então roda em
 *     `after()` (depois da resposta ir para o cliente). Antes, cada GET pagava a
 *     seleção inteira e a rota estourava o próprio `maxDuration = 30`.
 *  2. o throttle agora é CARIMBADO ANTES do trabalho. Antes, o marcador de 'selecao'
 *     só era gravado no FIM: com a tela atualizando sozinha, chegava outro GET no
 *     meio e começava mais uma seleção em paralelo, empilhando sincronizações
 *     concorrentes sobre o mesmo tenant.
 *
 * De propósito NÃO usa advisory lock aqui: o banco fica atrás de PgBouncer e, em
 * pooling por transação, um lock de SESSÃO pode ser destravado por outra conexão —
 * vazando a trava para sempre. O carimbo antecipado já é commitado antes do
 * trabalho começar, então qualquer GET concorrente dentro da janela o enxerga.
 */
async function talvezSincronizar(titularId: string, userId: string) {
  const ultima = await queryOne<{ criado_em: string }>(
    `SELECT criado_em FROM radar_auditoria
      WHERE titular_id = $1 AND acao = 'selecao'
      ORDER BY criado_em DESC LIMIT 1`,
    [titularId],
  )
  const recente = ultima && (Date.now() - new Date(ultima.criado_em).getTime() < 10 * 60_000)
  if (recente) return

  // Carimba a tentativa JÁ (fecha a janela de corrida do throttle). O registro do
  // resultado vem depois, de dentro de sincronizarSelecao.
  await query(
    `INSERT INTO radar_auditoria (titular_id, user_id, acao, entidade, detalhe)
     VALUES ($1,$2,'selecao','radar_processos',$3::jsonb)`,
    [titularId, userId, JSON.stringify({ inicio: true })],
  )

  after(async () => {
    try {
      await sincronizarSelecao(titularId, userId)
    } catch (e) {
      console.warn('[radar/inbox] selecao:', e)
    }
  })
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
            m.lida, m.lida_por, m.lida_em, p.titulo, p.link_portal,
            -- lote é coluna nova (ver schema-radar.sql). Lida via to_jsonb para a
            -- caixa NÃO quebrar em banco que ainda não recebeu a migração: chave
            -- ausente devolve NULL em vez de erro de coluna inexistente.
            to_jsonb(m) ->> 'lote' AS lote
       FROM radar_mensagens m
       LEFT JOIN radar_processos p ON p.id = m.processo_id
      WHERE ${cond.join(' AND ')}
      ORDER BY m.lida ASC, m.capturado_em DESC
      LIMIT 300`,
    params,
  )

  // Lista dos pregões MONITORADOS — independente de já ter mensagem capturada.
  // (Antes a caixa era montada só a partir de radar_mensagens, então um processo
  // recém-monitorado ficava invisível até o worker capturar a primeira mensagem.)
  // Enriquecido com o órgão/prazo/situação vindos de `contratacoes`; aberto×encerrada
  // segue a regra do produto: presença de resultado homologado = encerrada.
  const processos = await query<{
    id: string; conector_id: string; cnpj: string; licitacao_id: string; titulo: string | null
    uf: string | null; valor: string | null; prioridade: string; mutado: boolean
    user_id: string; origem: string; link_portal: string | null; atualizado_em: string
    orgao: string | null; municipio: string | null; modalidade: string | null
    objeto: string | null; prazo: string | null; abertura: string | null; encerrada: boolean
    link_externo: string | null; fonte: string | null
  }>(
    `SELECT p.id, p.conector_id, p.cnpj, p.licitacao_id, p.titulo, p.uf, p.valor,
            p.prioridade, p.mutado, p.user_id, p.origem, p.link_portal, p.atualizado_em,
            c.razao_social_orgao AS orgao, c.municipio, c.modalidade_nome AS modalidade,
            c.objeto_compra AS objeto, c.link_externo, c.fonte,
            c.data_encerramento_proposta AS prazo, c.data_abertura_proposta AS abertura,
            EXISTS (SELECT 1 FROM resultados r WHERE r.numero_controle_pncp = p.licitacao_id) AS encerrada
       FROM radar_processos p
       LEFT JOIN contratacoes c ON c.numero_controle_pncp = p.licitacao_id
      WHERE p.titular_id = $1 AND p.status = 'ativo'
      ORDER BY p.atualizado_em DESC
      LIMIT 500`,
    [t.titularId],
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
    processos: processos.map((p) => ({
      id: p.id, conectorId: p.conector_id, cnpj: p.cnpj, licitacaoId: p.licitacao_id,
      titulo: p.titulo || p.objeto, uf: p.uf, valor: p.valor == null ? null : Number(p.valor),
      prioridade: p.prioridade, mutado: p.mutado, origem: p.origem,
      linkPortal: p.link_portal, atualizadoEm: p.atualizado_em,
      orgao: p.orgao, municipio: p.municipio, modalidade: p.modalidade,
      prazo: p.prazo, abertura: p.abertura,
      situacao: p.encerrada ? 'encerrada' : 'aberta',
      // PORTAL REAL onde a sessão roda, derivado do que o PNCP entregou. Distinto de
      // `conectorId`, que é quem CAPTURA o chat: o selo deixa de dizer Compras.gov
      // para um pregão que na verdade acontece na Licitanet/BNC/BLL.
      portal: resolverPortal({ linkExterno: p.link_externo, objeto: p.objeto, fonte: p.fonte }),
      linkOrigem: p.link_externo,
      // "Monitorado por mim" × "por todos": quem cadastrou/recebeu a seleção.
      meu: p.user_id === t.userId,
    })),
    // A configuração de notificação é da empresa; a tela usa as palavras-chave para
    // pintar os termos na conversa, então já vão junto e evitam um segundo request.
    chaves: (await query<{ padrao: string }>(
      `SELECT padrao FROM radar_regras
        WHERE titular_id = $1 AND tipo = 'keyword' AND ativo = true AND padrao IS NOT NULL`,
      [t.titularId],
    )).map((r) => r.padrao),
    kpis: {
      naoLidas: Number(kpi?.nao_lidas ?? 0),
      processosAtivos: Number(kpi?.processos_ativos ?? 0),
      conectores: saude.length,
    },
    saude: saude.map((s) => ({
      credencialId: s.credencial_id, conectorId: s.conector_id, cnpj: s.cnpj,
      status: s.status, verificadoEm: s.verificado_em, tentadoEm: s.tentado_em, detalhe: s.detalhe,
    })),
    // O que este AMBIENTE consegue fazer. Sem isso a tela oferecia "Conectar
    // portal" onde conectar é impossível: sem RADAR_CRED_KEY o cadastro da
    // credencial devolve 503 ("cofre indisponível") e sem RADAR_CONNECT_URL o
    // login do gov.br não abre — o usuário clicava e batia num erro.
    // O caminho SEM LOGIN (andamento público) não depende de nenhum dos dois.
    capacidades: {
      cofre: cofreDisponivel(),
      hosted: !!(process.env.RADAR_CONNECT_URL && process.env.RADAR_CONNECT_TOKEN),
    },
    atualizadoEm: new Date().toISOString(),
  })
}
