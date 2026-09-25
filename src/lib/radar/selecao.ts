// src/lib/radar/selecao.ts — SELEÇÃO AUTOMÁTICA de processos a partir do PERFIL.
// O usuário não cadastra licitações uma a uma: o perfil (UFs, categorias, termos,
// faixa de valor) + portfólio (produtos/palavras-chave) decidem o que acompanhar.
// Reusa a base de licitações (contratacoes/resultados) e a mesma ideia de matching
// de lib/alertas + lib/portfolio. Quando acha um processo NOVO, enfileira um alerta
// de "nova licitação" por e-mail ao endereço cadastrado do fornecedor.

import { query, queryOne } from '@/lib/db'
import { ABERTA } from '@/lib/licitacoes/universo'
import { normalizeText } from '@/lib/text'
import { needlesDoProduto } from '@/lib/portfolio-servidor'
import { CONECTORES, licitacaoDoPortal } from '@/lib/radar/conectores'

const CONECTOR_PADRAO = 'comprasgov'
const PORTAL_PNCP = 'https://pncp.gov.br/app/editais'

/**
 * Link do processo NAQUELE portal.
 *
 * Todos os conectores partem da mesma verdade (PNCP, o agregador nacional), e por muito
 * tempo o link gravado era sempre a busca no PNCP. Para um conector de LOGIN tanto faz —
 * ele acha os processos pela área do próprio cliente. Para um conector PÚBLICO, não:
 * ele precisa da página do processo, e uma busca no PNCP não é ela. Enquanto
 * `link_portal` guardava o link do PNCP, o passo público não tinha por onde começar.
 *
 * O PNCP já publica esse endereço em `link_externo`, então basta usá-lo quando a
 * licitação for mesmo daquele portal — `licitacaoDoPortal` é quem decide. Sem link do
 * portal, cai no PNCP como antes (e o PCP ainda tem o seu resolvedor no worker).
 */
function linkDoProcesso(conectorId: string, c: Pick<Candidato, 'numero_controle_pncp' | 'objeto_compra' | 'link_externo'>): string {
  if (c.link_externo && licitacaoDoPortal(conectorId, c)) return c.link_externo
  return `${PORTAL_PNCP}?q=${encodeURIComponent(c.numero_controle_pncp)}`
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
  const cond: string[] = [ABERTA('c')]
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
  // Compras.gov.br só recebe candidatos com origem confirmada no portal.
  // O piloto público consulta apenas compras cadastradas explicitamente pelo link.
  const conectoresBase = [...new Set(conectados.length ? conectados : [CONECTOR_PADRAO])]

  // ── GRAVAÇÃO EM LOTE (2026-09-16) ──────────────────────────────────────────
  //
  // Antes daqui saía um `await` por candidato, POR PORTAL: 5.000 candidatos viravam
  // 5.000+ idas ao banco, sequenciais, atravessando o PgBouncer com TLS até a VM. As
  // rodadas que sobreviveram mediram 13 a 29 segundos — e o `maxDuration` da rota que
  // chama isto era 30. Resultado medido na auditoria: 14 das 49 seleções começaram e
  // NUNCA registraram o fim. Não havia erro nem log, porque timeout não é exceção: a
  // invocação simplesmente deixa de existir no meio do laço.
  //
  // Montar as linhas em memória e gravar de 500 em 500 troca 5.000 idas por 10.
  const LOTE = 500

  interface LinhaProcesso {
    id: string; conectorId: string; licitacaoId: string; titulo: string
    uf: string | null; valor: number | null; motivo: string; link: string
  }
  interface Alerta { assunto: string; corpo: string; link: string }

  // Chaveado pelo `id` de propósito: `ON CONFLICT DO UPDATE` RECUSA a instrução inteira
  // se ela tocar a mesma linha duas vezes ("cannot affect row a second time"). Um
  // `numero_controle_pncp` repetido entre os candidatos derrubaria o lote inteiro — o
  // Map deduplica antes de o SQL ter chance de reclamar.
  const linhas = new Map<string, LinhaProcesso>()
  const alertas = new Map<string, Alerta>()

  let novos = 0
  let total = 0

  try {
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

      // Uma linha POR PORTAL conectado (cada worker de portal enxerga o seu). O portal
      // público só entra para as licitações que realmente correm nele — do contrário o
      // worker sai procurando no PCP a página de um pregão do BB.
      const conectoresAlvo = [...new Set([...conectoresBase, ...publicos])].filter((id) => licitacaoDoPortal(id, c))
      for (const conectorId of conectoresAlvo) {
        const id = `${conectorId}:${titularId}:${c.numero_controle_pncp}`.slice(0, 200)
        linhas.set(id, {
          id,
          conectorId,
          licitacaoId: c.numero_controle_pncp,
          titulo,
          uf: c.uf,
          valor: c.valor_total_estimado,
          motivo: JSON.stringify(motivo),
          link: linkDoProcesso(conectorId, c),
        })
      }

      // Alerta de "nova licitação" é por LICITAÇÃO (não por portal): um e-mail só,
      // mesmo quando a mesma licitação entra por três portais.
      const razao = termosBatem[0] || produtosBatem[0] || c.categoria_saude || c.uf || 'perfil'
      alertas.set(c.numero_controle_pncp, {
        assunto: `Nova licitação para o seu perfil: ${titulo.slice(0, 90) || c.numero_controle_pncp}`,
        corpo: JSON.stringify({
          objeto: titulo, uf: c.uf, municipio: c.municipio,
          valor: c.valor_total_estimado, motivo: razao, nome: titular?.nome,
        }),
        link: linkDoProcesso(CONECTOR_PADRAO, c),
      })
    }

    // `xmax = 0` continua sendo quem distingue o INÉDITO do já conhecido — agora lido
    // do RETURNING do lote inteiro, em vez de linha a linha.
    const ineditas = new Set<string>()
    const refPorLicitacao = new Map<string, string>()
    const todas = [...linhas.values()]

    for (let i = 0; i < todas.length; i += LOTE) {
      const bloco = todas.slice(i, i + LOTE)
      const ins = await query<{ id: string; licitacao_id: string; novo: boolean }>(
        `INSERT INTO radar_processos
           (id, titular_id, user_id, conector_id, cnpj, licitacao_id, titulo, uf, valor, motivo_match, link_portal, atualizado_em)
         SELECT t.id, $1, $2, t.conector_id, $3, t.licitacao_id, t.titulo, t.uf, t.valor, t.motivo::jsonb, t.link, now()
           FROM unnest($4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::numeric[], $10::text[], $11::text[])
                AS t(id, conector_id, licitacao_id, titulo, uf, valor, motivo, link)
         ON CONFLICT (titular_id, conector_id, cnpj, licitacao_id) DO UPDATE
           SET titulo = EXCLUDED.titulo, uf = EXCLUDED.uf, valor = EXCLUDED.valor,
               motivo_match = EXCLUDED.motivo_match, atualizado_em = now()
         RETURNING id, licitacao_id, (xmax = 0) AS novo`,
        [
          titularId, userId, cnpj,
          bloco.map((l) => l.id), bloco.map((l) => l.conectorId), bloco.map((l) => l.licitacaoId),
          bloco.map((l) => l.titulo), bloco.map((l) => l.uf), bloco.map((l) => l.valor),
          bloco.map((l) => l.motivo), bloco.map((l) => l.link),
        ],
      )
      for (const r of ins) {
        // Qualquer linha da licitação serve de referência para o alerta — o RETURNING
        // não promete ordem, e o processo_id é só o endereço para onde o e-mail aponta.
        if (!refPorLicitacao.has(r.licitacao_id)) refPorLicitacao.set(r.licitacao_id, r.id)
        if (r.novo) ineditas.add(r.licitacao_id)
      }
    }

    const aAvisar = [...ineditas]
      .map((lic) => ({ lic, ref: refPorLicitacao.get(lic), a: alertas.get(lic) }))
      .filter((x): x is { lic: string; ref: string; a: Alerta } => !!x.ref && !!x.a)
    novos = aAvisar.length

    for (let i = 0; i < aAvisar.length; i += LOTE) {
      const bloco = aAvisar.slice(i, i + LOTE)
      const ids = bloco.map((x) => `nl:${titularId}:${x.lic}`)
      const idsApp = bloco.map((x) => `nl-app:${titularId}:${x.lic}`)
      const refs = bloco.map((x) => x.ref)
      const assuntos = bloco.map((x) => x.a.assunto)
      const links = bloco.map((x) => x.a.link)

      await query(
        `INSERT INTO radar_notificacoes (id, titular_id, evento, processo_id, destinatario, canal, assunto, corpo, link)
         SELECT t.id, $1, 'nova_licitacao', t.processo, $2, 'email', t.assunto, t.corpo, t.link
           FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
                AS t(id, processo, assunto, corpo, link)
         ON CONFLICT (id) DO NOTHING`,
        [titularId, destinatario, ids, refs, assuntos, bloco.map((x) => x.a.corpo), links],
      )
      // Notificação in-app (mesmo id-base, canal distinto).
      await query(
        `INSERT INTO radar_notificacoes (id, titular_id, evento, processo_id, destinatario, canal, assunto, link, status)
         SELECT t.id, $1, 'nova_licitacao', t.processo, $2, 'in_app', t.assunto, t.link, 'entregue'
           FROM unnest($3::text[], $4::text[], $5::text[], $6::text[])
                AS t(id, processo, assunto, link)
         ON CONFLICT (id) DO NOTHING`,
        [titularId, destinatario, idsApp, refs, assuntos, links],
      )
    }
  } catch (e) {
    // Fecha a auditoria marcando PARCIAL antes de propagar: sem isto a linha de início
    // fica órfã, e uma falha de verdade vira indistinguível de uma invocação morta.
    await registrarFim(titularId, userId, {
      candidatos: candidatos.length, total, novos, parcial: true, erro: String(e).slice(0, 200),
    })
    throw e
  }

  await registrarFim(titularId, userId, { candidatos: candidatos.length, total, novos })

  return { novos, total }
}

/**
 * Carimbo de ENCERRAMENTO da seleção. É o par do carimbo de INÍCIO que a rota grava
 * (api/radar/inbox): início sem fim significa que a invocação morreu, e é assim que o
 * throttle de lá descobre que pode tentar de novo em vez de esperar a janela inteira.
 *
 * Nunca deixa o próprio registro derrubar a seleção — se o banco recusar ESTA linha, o
 * trabalho já feito continua valendo.
 */
async function registrarFim(titularId: string, userId: string, detalhe: Record<string, unknown>) {
  try {
    await query(
      `INSERT INTO radar_auditoria (titular_id, user_id, acao, entidade, detalhe)
       VALUES ($1,$2,'selecao','radar_processos',$3::jsonb)`,
      [titularId, userId, JSON.stringify(detalhe)],
    )
  } catch (e) {
    console.warn('[radar/selecao] auditoria de fim:', e)
  }
}
