// scripts/lib/pagometro-contratacoes.mjs — grava em cada contratação o prazo de quem a
// paga (contratacoes.pagometro_dias / _pagador / _fonte), com a MESMA decisão do selo
// (acharPagador, src/lib/pagometro-calculo.mjs).
//
// Por que gravar: o score e o filtro "paga em até N dias" rodam em SQL sobre o universo
// inteiro (ordenar e paginar no banco). A regra de quem paga — esfera do PNCP, nome do
// órgão, Unidade Gestora federal — não cabe em SQL sem virar uma segunda cópia que
// diverge da tela. Gravando o resultado, o SQL só lê uma coluna.
//
// Roda ao fim das cargas do Pagômetro (municipal e federal) e pode ser chamado sozinho
// (npm run pagometro:contratacoes). Só escreve o que mudou, em lotes.

import { acharPagador, rotuloPagador } from '../../src/lib/pagometro-calculo.mjs'

const LOTE = 20_000

async function carregarTabelas(pool) {
  const estados = new Map(), municipios = new Map(), federais = new Map()
  const { rows } = await pool.query(
    `SELECT ente_tipo, uf, municipio_key, municipio_nome, dias::float8 AS dias, dias_saude::float8 AS dias_saude FROM pagometro`,
  )
  for (const r of rows) {
    if (r.ente_tipo === 'estado') estados.set(r.uf, r)
    else municipios.set(`${r.uf}:${r.municipio_key}`, r)
  }
  try {
    const fed = await pool.query(`SELECT ug, nome, dias::float8 AS dias FROM pagometro_federal WHERE dias IS NOT NULL`)
    for (const r of fed.rows) federais.set(r.ug, r)
  } catch { /* carga federal ainda não rodou: só municípios e estados */ }
  return {
    estado: (uf) => estados.get(uf),
    municipio: (uf, chave) => municipios.get(`${uf}:${chave}`),
    federal: (ug) => federais.get(ug),
  }
}

const igual = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.05)

/**
 * Recalcula o prazo de todas as contratações e grava o que mudou.
 * @returns {Promise<{ lidas: number, comPrazo: number, alteradas: number }>}
 */
export async function atualizarPagometroContratacoes(pool, { log = console.log } = {}) {
  const tem = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'contratacoes' AND column_name = 'pagometro_fonte'`,
  )
  if (!tem.rows.length) { log('[pagometro] contratacoes sem as colunas do Pagômetro (ou sem a tabela): nada a gravar'); return { lidas: 0, comPrazo: 0, alteradas: 0 } }
  const buscar = await carregarTabelas(pool)
  let ultimo = '', lidas = 0, comPrazo = 0, alteradas = 0
  for (;;) {
    const { rows } = await pool.query(
      `SELECT numero_controle_pncp AS id, uf, municipio, razao_social_orgao AS orgao, esfera, codigo_unidade AS ug,
              pagometro_dias::float8 AS dias, pagometro_pagador AS pagador, pagometro_fonte AS fonte
         FROM contratacoes WHERE numero_controle_pncp > $1 ORDER BY numero_controle_pncp LIMIT ${LOTE}`,
      [ultimo],
    )
    if (!rows.length) break
    ultimo = rows[rows.length - 1].id
    lidas += rows.length
    const mud = { id: [], dias: [], pagador: [], fonte: [] }
    for (const r of rows) {
      const p = acharPagador(r, buscar)
      const novo = p
        ? { dias: Math.round(p.dias * 10) / 10, pagador: rotuloPagador(p, r.municipio), fonte: p.tipo === 'federal' ? 'portal' : 'siconfi' }
        : { dias: null, pagador: null, fonte: null }
      if (p) comPrazo++
      if (igual(novo.dias, r.dias) && (novo.pagador ?? null) === (r.pagador ?? null) && (novo.fonte ?? null) === (r.fonte ?? null)) continue
      mud.id.push(r.id); mud.dias.push(novo.dias); mud.pagador.push(novo.pagador); mud.fonte.push(novo.fonte)
    }
    if (mud.id.length) {
      await pool.query(
        `UPDATE contratacoes c SET pagometro_dias = u.dias, pagometro_pagador = u.pagador, pagometro_fonte = u.fonte
           FROM unnest($1::text[], $2::numeric[], $3::text[], $4::text[]) AS u(id, dias, pagador, fonte)
          WHERE c.numero_controle_pncp = u.id`,
        [mud.id, mud.dias, mud.pagador, mud.fonte],
      )
      alteradas += mud.id.length
    }
  }
  log(`[pagometro] contratações: ${lidas} lidas, ${comPrazo} com prazo de quem paga, ${alteradas} atualizadas`)
  return { lidas, comPrazo, alteradas }
}
