// src/lib/radar/selecao.ts — SELEÇÃO AUTOMÁTICA de processos a partir do PERFIL.
// O usuário não cadastra licitações uma a uma: o perfil (UFs, categorias, termos,
// faixa de valor) + portfólio (produtos/palavras-chave) decidem o que acompanhar.
// Reusa a base de licitações (contratacoes/resultados) e a mesma ideia de matching
// de lib/alertas + lib/portfolio. Quando acha um processo NOVO, enfileira um alerta
// de "nova licitação" por e-mail ao endereço cadastrado do fornecedor.

import { query, queryOne } from '@/lib/db'
import { normalizeText } from '@/lib/text'
import { CONECTORES, licitacaoDoPortal } from '@/lib/radar/conectores'

const CONECTOR_PADRAO = 'comprasgov'
const PORTAL_PNCP = 'https://pncp.gov.br/app/editais'

// Todos os conectores partem da mesma verdade (PNCP, o agregador nacional). O link
// específico de cada portal (BLL/PCP/Licitações-e) entra na etapa 2, junto do
// mapeamento do id-do-portal — por ora todos apontam para o edital no PNCP.
function linkDoProcesso(_conectorId: string, numero: string): string {
  return `${PORTAL_PNCP}?q=${encodeURIComponent(numero)}`
}

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

/**
 * Estados e categorias do Setup da Empresa, com o mesmo fallback para as chaves
 * legadas que a seleção usa. A CAIXA do Radar precisa deste recorte além da seleção:
 * `sincronizarSelecao` filtra o que ENTRA em radar_processos, mas o que já entrou
 * fica — então, quando o cliente estreita o setup, a caixa continuava mostrando os
 * processos escolhidos sob o setup antigo (e os de outros usuários do mesmo tenant).
 */
export async function filtrosDoSetup(
  userId: string,
): Promise<{ ufs: string[]; categorias: string[] }> {
  const empresa = await lerUserData<Perfil | null>(userId, 'empresa', null)
  const temEmpresa = !!empresa && (empresa.ufs != null || empresa.categorias != null)
  const perfil: Perfil = temEmpresa ? empresa! : await lerUserData<Perfil>(userId, 'perfil', {})
  return {
    ufs: (perfil.ufs ?? []).map((u) => u.toUpperCase()),
    categorias: perfil.categorias ?? [],
  }
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
  link_externo: string | null
  fonte: string | null
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
  // Fonte de verdade: o Setup da Empresa unificado (chave 'empresa'). Fallback para
  // as chaves legadas ('perfil'/'portfolio') de contas que ainda não regravaram o setup.
  const empresa = await lerUserData<(Perfil & { produtos?: ProdutoLike[] }) | null>(userId, 'empresa', null)
  const temEmpresa = !!empresa && (
    empresa.produtos != null || empresa.ufs != null || empresa.categorias != null || empresa.termosBusca != null
  )
  const perfil: Perfil = temEmpresa ? empresa! : await lerUserData<Perfil>(userId, 'perfil', {})
  const produtosRaw = temEmpresa
    ? (empresa!.produtos ?? [])
    : await lerUserData<ProdutoLike[]>(userId, 'portfolio', [])
  const produtos = produtosRaw.filter((p) => p.ativo !== false)

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
  // UF / categoria / faixa de valor / TEXTO, recentes.
  const cond: string[] = [`NOT EXISTS (SELECT 1 FROM resultados r WHERE r.numero_controle_pncp = c.numero_controle_pncp)`]
  const params: unknown[] = []
  if (ufs.length) { params.push(ufs); cond.push(`c.uf = ANY($${params.length})`) }
  if (categorias.length) { params.push(categorias); cond.push(`c.categoria_saude = ANY($${params.length})`) }
  if (perfil.valorMin != null) { params.push(perfil.valorMin); cond.push(`c.valor_total_estimado >= $${params.length}`) }
  if (perfil.valorMax != null) { params.push(perfil.valorMax); cond.push(`c.valor_total_estimado <= $${params.length}`) }

  // O filtro de TEXTO agora vai para o SQL (antes era só em JS, DEPOIS do LIMIT).
  // Aquele `LIMIT 800` recortava as 800 contratações mais recentes e só então casava
  // termos/portfólio: um perfil amplo (poucas UFs, sem categoria, muitos produtos)
  // nunca via o resto da base. `translate` remove os acentos do lado do banco para
  // casar com as agulhas já normalizadas — dá para usar sem a extensão `unaccent`,
  // que não está instalada.
  // `LIKE ANY(array)` de propósito, NÃO um OR de N LIKEs: com um OR, o Postgres
  // reavalia translate(lower(objeto)) uma vez POR AGULHA em cada linha — com 101
  // agulhas isso media 33s. Com ANY(array) a expressão é avaliada uma única vez por
  // linha e o índice trigram entra: as mesmas 101 agulhas caem para ~640ms.
  // O índice que sustenta isso é idx_contratacoes_objeto_trgm (scripts/migrate-trgm.mjs)
  // e ele é sobre ESTA expressão — mudar o translate aqui exige recriar o índice.
  const SEM_ACENTO = `translate(lower(c.objeto_compra), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')`
  if (temFiltroTexto) {
    const alvos = [...new Set([...termos, ...needles])]
    params.push(alvos.map((t) => `%${t}%`))
    cond.push(`${SEM_ACENTO} LIKE ANY($${params.length})`)
  }

  // Teto de segurança aplicado DEPOIS de todos os filtros (inclusive texto), não
  // como recorte cego da base. Alto o bastante para não cortar perfil real.
  const TETO_CANDIDATOS = 5000

  const candidatos = await query<Candidato>(
    `SELECT numero_controle_pncp, objeto_compra, uf, municipio, valor_total_estimado, categoria_saude,
            link_externo, fonte
       FROM contratacoes c
      WHERE ${cond.join(' AND ')}
        AND (data_publicacao IS NULL OR data_publicacao >= (now() - interval '8 months'))
      ORDER BY data_publicacao DESC NULLS LAST
      LIMIT ${TETO_CANDIDATOS}`,
    params,
  )

  // Portais-alvo da seleção: os CONECTADOS (credencial ativa) MAIS os de modo
  // público, que não pedem credencial nenhuma.
  //
  // O PCP é lido pela página pública (conectores.ts) e o worker já tem um passo
  // "público" para tenants SEM credencial de PCP (scripts/radar/run.mjs). Só que a
  // seleção só olhava para credenciais, então nenhum processo era criado com
  // conector_id='pcp' e esse passo nunca tinha o que capturar. Resultado: uma conta
  // recém-criada via o Radar inteiro como "nenhum conector conectado / 0 mensagens",
  // com o monitoramento que já funciona de graça parado por falta de trabalho.
  const credConectores = await query<{ conector_id: string }>(
    `SELECT DISTINCT conector_id FROM radar_credenciais WHERE titular_id = $1 AND ativo = true`,
    [titularId],
  )
  const publicos = CONECTORES.filter((c) => c.disponivel && c.modoPublico).map((c) => c.id)
  const conectados = credConectores.map((r) => r.conector_id)
  // Sem credencial alguma, o Compras.gov.br continua entrando: os processos ficam
  // selecionados e acompanhados por prazo desde já, e passam a ter chat assim que o
  // cliente conclui o login.
  const conectoresBase = [...new Set(conectados.length ? conectados : [CONECTOR_PADRAO])]

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
    const titulo = (c.objeto_compra ?? '').slice(0, 240)

    // UPSERT de um processo POR PORTAL conectado (cada worker de portal enxerga o
    // seu). RETURNING (xmax=0) detecta o INÉDITO para alertar sem duplicar.
    let inseriuNovo = false
    let processoRef = ''
    // O portal público só entra para as licitações que realmente correm nele — do
    // contrário o worker sai procurando no PCP a página de um pregão do BB.
    const conectoresAlvo = [...conectoresBase, ...publicos.filter((id) => licitacaoDoPortal(id, c))]
    for (const conectorId of conectoresAlvo) {
      const id = `${conectorId}:${titularId}:${c.numero_controle_pncp}`.slice(0, 200)
      const link = linkDoProcesso(conectorId, c.numero_controle_pncp)
      const ins = await query<{ id: string; novo: boolean }>(
        `INSERT INTO radar_processos
           (id, titular_id, user_id, conector_id, cnpj, licitacao_id, titulo, uf, valor, motivo_match, link_portal, atualizado_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11, now())
         ON CONFLICT (titular_id, conector_id, cnpj, licitacao_id) DO UPDATE
           SET titulo = EXCLUDED.titulo, uf = EXCLUDED.uf, valor = EXCLUDED.valor,
               motivo_match = EXCLUDED.motivo_match, atualizado_em = now()
         RETURNING id, (xmax = 0) AS novo`,
        [id, titularId, userId, conectorId, cnpj, c.numero_controle_pncp, titulo, c.uf,
         c.valor_total_estimado, JSON.stringify(motivo), link],
      )
      if (!processoRef) processoRef = ins[0]?.id ?? id
      if (ins[0]?.novo) inseriuNovo = true
    }

    // Alerta de "nova licitação" é por LICITAÇÃO (não por portal): id de notificação
    // no nível da licitação evita duplicar quando há vários portais conectados.
    if (inseriuNovo) {
      novos++
      const link = linkDoProcesso(CONECTOR_PADRAO, c.numero_controle_pncp)
      const razao = termosBatem[0] || produtosBatem[0] || c.categoria_saude || c.uf || 'perfil'
      const assunto = `Nova licitação para o seu perfil: ${titulo.slice(0, 90) || c.numero_controle_pncp}`
      await query(
        `INSERT INTO radar_notificacoes (id, titular_id, evento, processo_id, destinatario, canal, assunto, corpo, link)
         VALUES ($1,$2,'nova_licitacao',$3,$4,'email',$5,$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [`nl:${titularId}:${c.numero_controle_pncp}`, titularId, processoRef, destinatario, assunto,
         JSON.stringify({ objeto: titulo, uf: c.uf, municipio: c.municipio, valor: c.valor_total_estimado, motivo: razao, nome: titular?.nome }),
         link],
      )
      // Notificação in-app (mesmo id-base, canal distinto).
      await query(
        `INSERT INTO radar_notificacoes (id, titular_id, evento, processo_id, destinatario, canal, assunto, link, status)
         VALUES ($1,$2,'nova_licitacao',$3,$4,'in_app',$5,$6,'entregue')
         ON CONFLICT (id) DO NOTHING`,
        [`nl-app:${titularId}:${c.numero_controle_pncp}`, titularId, processoRef, destinatario, assunto, link],
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
