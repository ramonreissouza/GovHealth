// src/lib/radar/selecao.ts — SELEÇÃO AUTOMÁTICA de processos a partir do PERFIL.
// O usuário não cadastra licitações uma a uma: o perfil (UFs, categorias, termos,
// faixa de valor) + portfólio (produtos/palavras-chave) decidem o que acompanhar.
// Reusa a base de licitações (contratacoes/resultados) e a mesma ideia de matching
// de lib/alertas + lib/portfolio. Quando acha um processo NOVO, enfileira um alerta
// de "nova licitação" por e-mail ao endereço cadastrado do fornecedor.

import { query, queryOne } from '@/lib/db'
import { normalizeText } from '@/lib/text'

const CONECTOR = 'comprasgov'
const PORTAL_PNCP = 'https://pncp.gov.br/app/editais'

interface Perfil {
  ufs?: string[]
  categorias?: string[]
  termosBusca?: string[]
  valorMin?: number
  valorMax?: number
}
interface ProdutoLike {
  nome?: string; marca?: string; modelo?: string; palavrasChave?: string[]; ativo?: boolean
}

async function lerUserData<T>(userId: string, chave: string, fallback: T): Promise<T> {
  const row = await queryOne<{ valor: T }>(
    `SELECT valor FROM user_data WHERE user_id = $1 AND chave = $2`, [userId, chave],
  )
  return (row?.valor ?? fallback) as T
}

/** Frases-alvo (normalizadas) de um produto do portfólio. */
function needlesDoProduto(p: ProdutoLike): string[] {
  const fontes = [...(p.palavrasChave ?? []), p.nome ?? '', p.marca ?? '', p.modelo ?? '']
  const out = new Set<string>()
  for (const f of fontes) { const n = normalizeText(f); if (n.length >= 3) out.add(n) }
  return [...out]
}

interface Candidato {
  numero_controle_pncp: string
  objeto_compra: string | null
  uf: string | null
  municipio: string | null
  valor_total_estimado: number | null
  categoria_saude: string | null
}

/**
 * Sincroniza a seleção para um usuário: casa o perfil com licitações abertas,
 * faz UPSERT em radar_processos (origem 'auto') e enfileira alertas de nova
 * licitação para os processos inéditos. Retorna quantos entraram e o total.
 */
export async function sincronizarSelecao(
  titularId: string,
  userId: string,
): Promise<{ novos: number; total: number; puloMotivo?: string }> {
  const perfil = await lerUserData<Perfil>(userId, 'perfil', {})
  const produtos = (await lerUserData<ProdutoLike[]>(userId, 'portfolio', [])).filter((p) => p.ativo !== false)

  const ufs = (perfil.ufs ?? []).map((u) => u.toUpperCase())
  const categorias = perfil.categorias ?? []
  const termos = (perfil.termosBusca ?? []).map(normalizeText).filter((t) => t.length >= 3)
  const needles = produtos.flatMap(needlesDoProduto)
  const temFiltroTexto = termos.length > 0 || needles.length > 0

  // Sem nenhum sinal de interesse não há o que selecionar (evita monitorar tudo).
  if (ufs.length === 0 && categorias.length === 0 && !temFiltroTexto) {
    return { novos: 0, total: 0, puloMotivo: 'perfil vazio' }
  }

  // Empresa (CNPJ/e-mail/nome) para amarrar o processo e endereçar o alerta.
  const titular = await queryOne<{ cnpj: string | null; email: string; nome: string | null }>(
    `SELECT cnpj, email, nome FROM usuarios WHERE id = $1`, [titularId],
  )
  const cnpj = (titular?.cnpj ?? '').replace(/\D+/g, '')
  const destinatario = titular?.email ?? titularId

  // Candidatos: contratações ABERTAS (sem resultado homologado) filtradas por
  // UF / categoria / faixa de valor, recentes. Texto é filtrado depois em JS.
  const cond: string[] = [`NOT EXISTS (SELECT 1 FROM resultados r WHERE r.numero_controle_pncp = c.numero_controle_pncp)`]
  const params: unknown[] = []
  if (ufs.length) { params.push(ufs); cond.push(`c.uf = ANY($${params.length})`) }
  if (categorias.length) { params.push(categorias); cond.push(`c.categoria_saude = ANY($${params.length})`) }
  if (perfil.valorMin != null) { params.push(perfil.valorMin); cond.push(`c.valor_total_estimado >= $${params.length}`) }
  if (perfil.valorMax != null) { params.push(perfil.valorMax); cond.push(`c.valor_total_estimado <= $${params.length}`) }

  const candidatos = await query<Candidato>(
    `SELECT numero_controle_pncp, objeto_compra, uf, municipio, valor_total_estimado, categoria_saude
       FROM contratacoes c
      WHERE ${cond.join(' AND ')}
        AND (data_publicacao IS NULL OR data_publicacao >= (now() - interval '8 months'))
      ORDER BY data_publicacao DESC NULLS LAST
      LIMIT 800`,
    params,
  )

  let novos = 0
  let total = 0
  for (const c of candidatos) {
    const hay = normalizeText(c.objeto_compra ?? '')
    const termosBatem = termos.filter((t) => hay.includes(t))
    const produtosBatem = needles.filter((n) => hay.includes(n))

    // Se o usuário definiu texto (termos/portfólio), exige casar. Se só definiu
    // UF/categoria, aceita pelo próprio filtro SQL.
    if (temFiltroTexto && termosBatem.length === 0 && produtosBatem.length === 0) continue

    total++
    const motivo = {
      termos: termosBatem,
      produtos: [...new Set(produtosBatem)],
      categoria: c.categoria_saude,
      uf: c.uf,
    }
    const id = `${titularId}:${c.numero_controle_pncp}`.slice(0, 200)
    const link = `${PORTAL_PNCP}?q=${encodeURIComponent(c.numero_controle_pncp)}`
    const titulo = (c.objeto_compra ?? '').slice(0, 240)

    // UPSERT idempotente. RETURNING só devolve linha quando de fato INSERE (xmax=0),
    // então detectamos os processos INÉDITOS para alertar sem duplicar.
    const ins = await query<{ novo: boolean }>(
      `INSERT INTO radar_processos
         (id, titular_id, user_id, conector_id, cnpj, licitacao_id, titulo, uf, valor, motivo_match, link_portal, atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11, now())
       ON CONFLICT (titular_id, conector_id, cnpj, licitacao_id) DO UPDATE
         SET titulo = EXCLUDED.titulo, uf = EXCLUDED.uf, valor = EXCLUDED.valor,
             motivo_match = EXCLUDED.motivo_match, atualizado_em = now()
       RETURNING (xmax = 0) AS novo`,
      [id, titularId, userId, CONECTOR, cnpj, c.numero_controle_pncp, titulo, c.uf,
       c.valor_total_estimado, JSON.stringify(motivo), link],
    )
    if (ins[0]?.novo) {
      novos++
      const razao = termosBatem[0] || produtosBatem[0] || c.categoria_saude || c.uf || 'perfil'
      const assunto = `Nova licitação para o seu perfil: ${titulo.slice(0, 90) || c.numero_controle_pncp}`
      await query(
        `INSERT INTO radar_notificacoes (id, titular_id, evento, processo_id, destinatario, canal, assunto, corpo, link)
         VALUES ($1,$2,'nova_licitacao',$3,$4,'email',$5,$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [`nl:${id}`, titularId, id, destinatario, assunto,
         JSON.stringify({ objeto: titulo, uf: c.uf, municipio: c.municipio, valor: c.valor_total_estimado, motivo: razao, nome: titular?.nome }),
         link],
      )
      // Notificação in-app (mesmo id-base, canal distinto).
      await query(
        `INSERT INTO radar_notificacoes (id, titular_id, evento, processo_id, destinatario, canal, assunto, link, status)
         VALUES ($1,$2,'nova_licitacao',$3,$4,'in_app',$5,$6,'entregue')
         ON CONFLICT (id) DO NOTHING`,
        [`nl-app:${id}`, titularId, id, destinatario, assunto, link],
      )
    }
  }

  await query(
    `INSERT INTO radar_auditoria (titular_id, user_id, acao, entidade, detalhe)
     VALUES ($1,$2,'selecao','radar_processos',$3::jsonb)`,
    [titularId, userId, JSON.stringify({ candidatos: candidatos.length, total, novos })],
  )

  return { novos, total }
}
