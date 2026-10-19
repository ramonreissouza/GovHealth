// scripts/lib/senha-revoga.mjs — a regra da guarda auth-senha-revoga, como função pura.
//
// Em cada literal SQL (entre crases) que ATRIBUI senha_hash, a MESMA cláusula SET precisa
// atribuir senha_alterada_em. Só mencionar não vale: a 1ª versão aceitava a coluna em
// qualquer lugar do literal, e `... WHERE id=$2 AND senha_alterada_em IS NOT NULL` passava
// sem revogar nada (revisão da #68). Comentários SQL são ignorados pelo mesmo motivo.

const ATRIB_SENHA = /senha_hash\s*=(?!=)/g
const ATRIB_VERSAO = /\bsenha_alterada_em\s*=(?!=)/i
const FIM_DO_SET = /\b(WHERE|RETURNING|FROM)\b/gi

/** Troca comentários SQL por espaços do mesmo tamanho (as posições continuam valendo). */
function semComentarios(sql) {
  return sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
}

/**
 * Violações em `texto` (conteúdo de um arquivo-fonte): [{ linha, motivo }].
 * Uma `senha_hash =` fora de qualquer SET (comparação no WHERE de um SELECT) não conta.
 */
export function violacoesSenha(texto) {
  const out = []
  for (const m of texto.matchAll(ATRIB_SENHA)) {
    const linha = texto.slice(0, m.index).split('\n').length
    const ini = texto.lastIndexOf('`', m.index)
    const fim = texto.indexOf('`', m.index)
    if (ini < 0 || fim < 0) { out.push({ linha, motivo: 'senha_hash= fora de um literal SQL entre crases; revise à mão' }); continue }

    const sql = semComentarios(texto.slice(ini + 1, fim))
    const pos = m.index - (ini + 1)
    if (sql.slice(pos, pos + 'senha_hash'.length) !== 'senha_hash') continue // estava num comentário

    // O SET que contém esta atribuição: o último SET antes dela…
    let inicioSet = -1
    for (const s of sql.slice(0, pos).matchAll(/\bSET\b/gi)) inicioSet = s.index
    if (inicioSet < 0) continue // sem SET: comparação (WHERE senha_hash = …), não atribuição
    // …desde que nenhum WHERE/RETURNING/FROM o tenha fechado antes dela.
    if (/\b(WHERE|RETURNING|FROM)\b/i.test(sql.slice(inicioSet, pos))) continue
    // …e vai até o primeiro WHERE/RETURNING/FROM depois dela (ou o fim do comando).
    FIM_DO_SET.lastIndex = pos
    const f = FIM_DO_SET.exec(sql)
    const clausulaSet = sql.slice(inicioSet, f ? f.index : sql.length)

    if (!ATRIB_VERSAO.test(clausulaSet)) {
      out.push({ linha, motivo: 'grava senha_hash sem atribuir senha_alterada_em no mesmo SET (as sessões abertas sobreviveriam)' })
    }
  }
  return out
}
