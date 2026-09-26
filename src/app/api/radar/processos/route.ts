// src/app/api/radar/processos/route.ts — processos monitorados (auto-selecionados).
// GET: lista (com motivo_match). PATCH: fixar/silenciar/atribuir/prioridade.
// POST/DELETE: exceções manuais. Isolado por titular_id.

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { query, queryOne } from '@/lib/db'
import { tenantDe } from '@/lib/radar/db'
import { CONECTORES, conectorPublico, licitacaoDoPortal } from '@/lib/radar/conectores'
import { compraPublica } from '@/lib/radar/comprasgov-publico.mjs'
import { modoComprasgov } from '@/lib/radar/comprasgov'
import { candidatosNoPncp } from '@/lib/radar/link-processo.mjs'
import { conectorDoPortal, lerLinkDoRadar, nomeCurto } from '@/lib/radar/adicionar-pregao'
import { resolverPortal, nomePortal } from '@/lib/portais'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const rows = await query(
    `SELECT id, conector_id, cnpj, licitacao_id, titulo, uf, valor, responsavel, prioridade,
            status, origem, mutado, participando, participando_em, motivo_match, link_portal, atualizado_em
       FROM radar_processos
      WHERE titular_id = $1
      ORDER BY (prioridade = 'alta') DESC, atualizado_em DESC
      LIMIT 1000`,
    [t.titularId],
  )
  return NextResponse.json({ processos: rows })
}

export async function PATCH(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  let body: { id?: string; mutado?: boolean; prioridade?: string; responsavel?: string; status?: string; linkPortal?: string; participando?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'body inválido' }, { status: 400 }) }
  if (!body.id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })

  const sets: string[] = []
  const params: unknown[] = [body.id, t.titularId]
  if (body.mutado != null) { params.push(body.mutado); sets.push(`mutado = $${params.length}`) }
  if (body.prioridade) { params.push(body.prioridade); sets.push(`prioridade = $${params.length}`) }
  if (body.responsavel !== undefined) { params.push(body.responsavel || null); sets.push(`responsavel = $${params.length}`) }
  if (body.status) { params.push(body.status); sets.push(`status = $${params.length}`) }
  if (body.linkPortal !== undefined) {
    // O coletor abre este link. Conferido contra o conector da PRÓPRIA linha (ver linkSeguro).
    const dona = await queryOne<{ conector_id: string }>(
      `SELECT conector_id FROM radar_processos WHERE id = $1 AND titular_id = $2`, [body.id, t.titularId])
    if (!dona) return NextResponse.json({ error: 'não encontrado' }, { status: 404 })
    const link = dona.conector_id === 'comprasgov' ? compraPublica(body.linkPortal ?? '')?.url ?? null : linkSeguro(dona.conector_id, body.linkPortal)
    if (body.linkPortal && !link) return NextResponse.json({ error: 'Este link não é a página de um pregão que o Radar lê neste portal.' }, { status: 400 })
    params.push(link); sets.push(`link_portal = $${params.length}`)
  }
  // `participando_em` anda junto com a marca, na MESMA instrucao: uma coluna de data
  // escrita num segundo passo fica dessincronizada no primeiro erro de rede, e depois
  // ninguem sabe se a ausencia de data significa "nao marcou" ou "marcou e falhou".
  // Desmarcar zera a data — guardar quando alguem participou de algo que diz nao ter
  // participado nao serve a ninguem.
  if (body.participando != null) {
    params.push(body.participando)
    sets.push(`participando = $${params.length}`)
    sets.push(`participando_em = CASE WHEN $${params.length} THEN now() ELSE NULL END`)
  }
  if (!sets.length) return NextResponse.json({ error: 'nada a atualizar' }, { status: 400 })

  // "Estou participando" é informação comercialmente sensível — diz em que pregão a
  // empresa entrou, e a participação é sigilosa até a sessão. Mudá-la sem rastro deixava
  // sem resposta "quem desmarcou isto, e quando?". Por isso, quando ela vem no pedido,
  // a leitura do valor anterior, a atualização e a linha de auditoria são UMA instrução:
  // no Postgres, CTEs de escrita rodam na mesma transação implícita, então ou as três
  // acontecem ou nenhuma. Audita só quando o valor MUDA (duplo clique não vira ruído).
  let row: { id: string } | null
  if (body.participando != null) {
    params.push(t.userId)
    const pUser = params.length
    row = await queryOne<{ id: string }>(
      `WITH anterior AS (
         SELECT id, participando FROM radar_processos
          WHERE id = $1 AND titular_id = $2
          FOR UPDATE
       ), alterado AS (
         UPDATE radar_processos p SET ${sets.join(', ')}, atualizado_em = now()
           FROM anterior WHERE p.id = anterior.id
         RETURNING p.id, anterior.participando AS valor_antes, p.participando AS valor_depois
       ), auditoria AS (
         INSERT INTO radar_auditoria (titular_id, user_id, acao, entidade, entidade_id, detalhe)
         SELECT $2, $${pUser}, 'participacao', 'radar_processos', id,
                jsonb_build_object('antes', valor_antes, 'depois', valor_depois)
           FROM alterado
          WHERE valor_antes IS DISTINCT FROM valor_depois
       )
       SELECT id FROM alterado`,
      params,
    )
  } else {
    row = await queryOne<{ id: string }>(
      `UPDATE radar_processos SET ${sets.join(', ')}, atualizado_em = now()
        WHERE id = $1 AND titular_id = $2 RETURNING id`,
      params,
    )
  }
  if (!row) return NextResponse.json({ error: 'não encontrado' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  let body: { conectorId?: string; cnpj?: string; licitacaoId?: string; titulo?: string; uf?: string; linkPortal?: string; link?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'body inválido' }, { status: 400 }) }
  if (typeof body.link === 'string') return adicionarPorLink(t, body.link)
  const cnpj = (body.cnpj ?? '').replace(/\D+/g, '')
  const conectorId = body.conectorId ?? 'comprasgov'
  const uf = (body.uf ?? '').trim().toUpperCase().slice(0, 2) || null
  // Em portal PÚBLICO, a licitação é o próprio objeto/título — não exige nº de controle
  // (quem adiciona à mão nem sempre tem o número em mãos). Era 'pcp' escrito na regra, e
  // por isso adicionar um processo do BLL/BNC à mão respondia 400 sem explicar por quê.
  // Com a integração oficial ligada, o coletor público não roda para o Compras.gov.br:
  // uma compra cadastrada aqui ficaria invisível. A porta do modo API é outra.
  if (conectorId === 'comprasgov' && modoComprasgov() === 'api') {
    return NextResponse.json({
      error: 'O Radar está lendo o Compras.gov.br pela integração oficial, e nesse modo a compra não entra pelo link público.',
      modo: 'api',
    }, { status: 409 })
  }
  const compra = conectorId === 'comprasgov' ? compraPublica(body.linkPortal) : null
  if (conectorId === 'comprasgov' && !compra) return NextResponse.json({ error: 'Cole o link público de acompanhamento da compra no Compras.gov.br, contendo ?compra= e os 17 dígitos da identificação.' }, { status: 400 })
  const licitacaoId = compra ? `comprasgov:publico:${compra.chave}` : (body.licitacaoId ?? '').trim() || (conectorPublico(conectorId) ? (body.titulo ?? '').trim().slice(0, 120) : '')
  if (!licitacaoId) return NextResponse.json({ error: 'licitacaoId (ou título) obrigatório' }, { status: 400 })
  const id = randomUUID()
  await query(
    `INSERT INTO radar_processos (id, titular_id, user_id, conector_id, cnpj, licitacao_id, titulo, uf, origem, link_portal)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9)
     ON CONFLICT (titular_id, conector_id, cnpj, licitacao_id) DO UPDATE SET
       titulo = COALESCE(EXCLUDED.titulo, radar_processos.titulo),
       uf = COALESCE(EXCLUDED.uf, radar_processos.uf),
       link_portal = COALESCE(EXCLUDED.link_portal, radar_processos.link_portal),
       atualizado_em = now()`,
    [id, t.titularId, t.userId, conectorId, cnpj, licitacaoId, body.titulo ?? null, uf, compra?.url ?? linkSeguro(conectorId, body.linkPortal)],
  )
  return NextResponse.json({ ok: true })
}

type Contratacao = { numero_controle_pncp: string; objeto_compra: string | null; uf: string | null; link_externo: string | null }

/**
 * O link que o COLETOR vai abrir, conferido pela mesma regra do "Adicionar pregão". Link
 * de outro portal, de host alheio ou fora do formato vira null: o coletor valida por
 * trecho do texto (`https://x.com/?a=licitanet.com.br/sessao/1` passa lá) e navega até
 * o que estiver salvo. Sem link, o PCP ainda acha a página pelo objeto e pela UF.
 */
function linkSeguro(conectorId: string, link: string | null | undefined): string | null {
  if (!link) return null
  const lido = lerLinkDoRadar(link)
  return lido.tipo === 'portal' && lido.conectorId === conectorId ? lido.url : null
}

/**
 * "ADICIONAR PREGÃO FORA DO PERFIL": só o link, do portal ou do PNCP.
 *
 * A regra do link é a de lib/radar/adicionar-pregao.ts, a mesma que a janela usa enquanto
 * a pessoa cola: o servidor não aceita o que a tela recusou, nem o contrário.
 *
 * O PREGÃO QUE O RADAR JÁ TEM É REUSADO, NÃO DUPLICADO. Procura, deste titular e deste
 * conector, a linha com o mesmo nº do PNCP (com qualquer CNPJ: o "Acompanhar no Radar" de
 * /oportunidades e o antigo "Conectar portal" gravavam CNPJ vazio) ou com o mesmo link
 * (o cache do pcp-resolver, os cadastros antigos). Achou: reativa aquela. Duas linhas do
 * mesmo pregão viravam dois cartões e duas leituras da mesma página.
 *
 * Linha nova: `licitacao_id` = nº do PNCP quando o pregão está em `contratacoes` (o JOIN da
 * inbox preenche órgão, prazo e situação, e é o mesmo id da seleção automática). No
 * Compras.gov.br é sempre `comprasgov:publico:<chave>`, o formato que a coleta assistida e
 * a saúde do conector procuram. Sem par no PNCP, o id vem do portal (`<conector>:link:<id>`).
 *
 * Custo medido em 25/09/2026: `link_externo` não tem índice, e o link que não está na base
 * varre as ~378 mil linhas em ~0,65 s. É um clique raro de uma pessoa; um índice resolve se
 * isso mudar.
 */
async function adicionarPorLink(t: { titularId: string; userId: string }, texto: string) {
  const lido = lerLinkDoRadar(texto)
  if (lido.tipo === 'vazio') return NextResponse.json({ error: 'Cole o link do pregão.' }, { status: 400 })
  if (lido.tipo === 'erro') return NextResponse.json({ error: lido.mensagem, motivo: lido.motivo }, { status: 400 })

  let c: Contratacao | null
  let conectorId: string
  let linkPortal: string | null
  let chaveCompra: string | null = null
  let rotuloPortal: string
  let aviso: string | null = null
  const linksConhecidos: string[] = []

  if (lido.tipo === 'pncp') {
    c = await queryOne<Contratacao>(
      `SELECT numero_controle_pncp, objeto_compra, uf, link_externo FROM contratacoes WHERE numero_controle_pncp = $1`,
      [lido.numeroControle],
    )
    if (!c) {
      return NextResponse.json({ error: 'Não achamos este edital na nossa base do PNCP, que guarda as licitações de saúde. Cole o link da página do pregão no portal da disputa.' }, { status: 404 })
    }
    // O portal da disputa sai do que o PNCP publicou, pela mesma regra da seleção
    // automática (licitacaoDoPortal): link do portal ou, no PCP, a marca no objeto.
    const alvo = CONECTORES.find((k) => k.disponivel && licitacaoDoPortal(k.id, c!))
    if (!alvo) {
      // O catálogo de portais reconhece mais coisa que os conectores (marca no objeto,
      // domínio antigo). Se ele aponta um portal que LEMOS, o que falta é o link da
      // página, e dizer "não lemos" seria falso.
      const portal = resolverPortal({ linkExterno: c.link_externo, objeto: c.objeto_compra })
      const lido2 = conectorDoPortal(portal)
      return NextResponse.json({
        error: portal === 'desconhecido'
          ? 'O PNCP não diz em que portal este pregão corre. Cole o link da página dele no portal da disputa.'
          : lido2
            ? `O PNCP não publicou o link da página deste pregão no ${nomeCurto(lido2)}. Cole o link da página dele no portal.`
            : `Este pregão corre no ${nomePortal(portal)}, e o Radar não lê esse portal.`,
      }, { status: 400 })
    }
    conectorId = alvo.id
    rotuloPortal = nomeCurto(alvo.id)
    // O link que o PNCP guardou passa pela MESMA leitura do link colado. Sem isso, um
    // endereço que o coletor descarta (domínio antigo, tela de compra direta) entraria
    // como "lido" e ninguém leria.
    const doPncp = c.link_externo ? lerLinkDoRadar(c.link_externo) : null
    const valido = doPncp?.tipo === 'portal' && doPncp.conectorId === conectorId ? doPncp : null
    linkPortal = valido?.url ?? null
    if (c.link_externo) linksConhecidos.push(c.link_externo)
    if (valido) linksConhecidos.push(valido.url)
    if (conectorId === 'comprasgov') {
      // Sem o link público de acompanhamento não há quadro, nem leitura, nem alerta: o
      // pregão entraria na lista sem nada que funcione. /oportunidades já esconde o botão
      // neste caso; aqui a resposta é a mesma, com o que colar no lugar.
      if (!valido) {
        return NextResponse.json({ error: 'O PNCP não publicou o link público de acompanhamento desta compra, então o chat oficial não abre no Radar. Cole o link de acompanhamento do Compras.gov.br (cnetmobile.estaleiro.serpro.gov.br/…/acompanhamento-compra?compra=…).' }, { status: 400 })
      }
      chaveCompra = valido.idPortal
    } else if (!valido) {
      if (conectorId !== 'pcp') {
        return NextResponse.json({ error: `O PNCP aponta para o ${alvo.nome}, mas o link que ele publicou não é a página do processo. Cole o link da página do pregão no ${nomeCurto(alvo.id)}.` }, { status: 400 })
      }
      // O PCP não publica o endereço do processo no PNCP; o coletor procura a página
      // pelo objeto e pela UF (pcp-resolver), como faz com os pregões do perfil.
      aviso = 'O Radar vai procurar a página deste pregão no Portal de Compras Públicas pelo objeto e pela UF.'
    }
  } else {
    conectorId = lido.conectorId
    rotuloPortal = `${lido.nome} · ${lido.descricao}`
    linkPortal = lido.url
    if (conectorId === 'comprasgov') chaveCompra = lido.idPortal
    const candidatos = candidatosNoPncp(texto, lido)
    linksConhecidos.push(...candidatos)
    c = await queryOne<Contratacao>(
      `SELECT numero_controle_pncp, objeto_compra, uf, link_externo FROM contratacoes WHERE link_externo = ANY($1) LIMIT 1`,
      [candidatos],
    )
  }

  // Com a integração oficial ligada, o coletor público não roda para o Compras.gov.br.
  if (conectorId === 'comprasgov' && modoComprasgov() === 'api') {
    return NextResponse.json({ error: 'O Radar está lendo o Compras.gov.br pela integração oficial, e nesse modo a compra não entra pelo link público.', modo: 'api' }, { status: 409 })
  }

  const titulo = (c?.objeto_compra ?? '').trim().slice(0, 240) || rotuloPortal
  const uf = c?.uf ?? null

  const antes = await queryOne<{ id: string; status: string; mutado: boolean }>(
    `SELECT id, status, mutado FROM radar_processos
      WHERE titular_id = $1 AND conector_id = $2
        AND (licitacao_id = ANY($3) OR link_portal = ANY($4))
      ORDER BY (licitacao_id = ANY($3)) DESC, (status = 'ativo' AND NOT mutado) DESC, atualizado_em DESC
      LIMIT 1`,
    [t.titularId, conectorId,
      [c?.numero_controle_pncp, chaveCompra ? `comprasgov:publico:${chaveCompra}` : null].filter(Boolean),
      [...new Set(linksConhecidos)]],
  )
  if (antes) {
    // `origem` vira 'manual' mesmo numa linha que a seleção criou: é isso que a mantém na
    // lista fora do recorte do perfil (inbox: `origem = 'manual' OR ...`), que é o pedido.
    // Reativar (status/mutado) é o mesmo pedido: quem cola o link quer acompanhar.
    await query(
      `UPDATE radar_processos SET origem = 'manual', status = 'ativo', mutado = false,
              titulo = COALESCE(NULLIF(titulo, ''), $2), uf = COALESCE(uf, $3),
              link_portal = COALESCE($4, link_portal), atualizado_em = now()
        WHERE id = $1`,
      [antes.id, titulo, uf, linkPortal],
    )
    return NextResponse.json({
      ok: true, id: antes.id, conectorId,
      situacao: antes.status === 'ativo' && !antes.mutado ? 'ja_estava' : 'reativado',
      aviso,
    })
  }

  const titular = await queryOne<{ cnpj: string | null }>(`SELECT cnpj FROM usuarios WHERE id = $1`, [t.titularId])
  const cnpj = (titular?.cnpj ?? '').replace(/\D+/g, '')
  const licitacaoId = chaveCompra
    ? `comprasgov:publico:${chaveCompra}`
    : c?.numero_controle_pncp ?? `${conectorId}:link:${lido.tipo === 'portal' ? lido.idPortal : ''}`.slice(0, 200)
  // Com nº do PNCP, o mesmo id que a seleção automática daria: se ela chegar depois, cai
  // no conflito da chave única e atualiza esta linha, sem duplicar.
  const id = !chaveCompra && c ? `${conectorId}:${t.titularId}:${c.numero_controle_pncp}`.slice(0, 200) : randomUUID()
  const row = await queryOne<{ id: string }>(
    `INSERT INTO radar_processos (id, titular_id, user_id, conector_id, cnpj, licitacao_id, titulo, uf, origem, link_portal)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9)
     ON CONFLICT (titular_id, conector_id, cnpj, licitacao_id) DO UPDATE SET
       origem = 'manual', status = 'ativo', mutado = false,
       titulo = COALESCE(NULLIF(radar_processos.titulo, ''), EXCLUDED.titulo),
       uf = COALESCE(radar_processos.uf, EXCLUDED.uf),
       link_portal = COALESCE(EXCLUDED.link_portal, radar_processos.link_portal),
       atualizado_em = now()
     RETURNING id`,
    [id, t.titularId, t.userId, conectorId, cnpj, licitacaoId, titulo, uf, linkPortal],
  )
  return NextResponse.json({ ok: true, id: row?.id ?? id, conectorId, situacao: 'novo', aviso })
}

export async function DELETE(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
  await query(`DELETE FROM radar_processos WHERE id = $1 AND titular_id = $2 AND origem = 'manual'`, [id, t.titularId])
  return NextResponse.json({ ok: true })
}
