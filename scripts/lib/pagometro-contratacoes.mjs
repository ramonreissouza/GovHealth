// scripts/lib/pagometro-contratacoes.mjs — grava em cada contratação quem a paga
// (contratacoes.pagador_tipo, que a CAPAG do score usa) e o prazo desse pagador
// (pagometro_dias / _pagador / _fonte), com a MESMA decisão do selo (pagadorDe e
// acharPagador, src/lib/pagometro-calculo.mjs).
//
// Por que gravar: o score e o filtro "paga em até N dias" rodam em SQL sobre o universo
// inteiro (ordenar e paginar no banco). A regra de quem paga — esfera do PNCP, nome do
// órgão, Unidade Gestora federal — não cabe em SQL sem virar uma segunda cópia que
// diverge da tela. Gravando o resultado, o SQL só lê uma coluna.
//
// Roda ao fim das cargas do Pagômetro (municipal e federal) e pode ser chamado sozinho
// (npm run pagometro:contratacoes). Só escreve o que mudou, em lotes.

import { acharPagador, pagadorDe, rotuloPagador } from '../../src/lib/pagometro-calculo.mjs'

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
  } catch (e) {
    // Só "a tabela não existe" (42P01) quer dizer que a carga federal ainda não rodou.
    // Qualquer outro erro para tudo: seguir com o mapa vazio apagaria os prazos federais.
    if (e?.code !== '42P01') throw e
  }
  return {
    estado: (uf) => estados.get(uf),
    municipio: (uf, chave) => municipios.get(`${uf}:${chave}`),
    federal: (ug) => federais.get(ug),
    // Fonte sem nenhuma linha (tabela recém-criada, esvaziada para recarga): não há o
    // que comparar, então o prazo que ela deu antes fica gravado em vez de virar NULL.
    vazia: { siconfi: estados.size + municipios.size === 0, portal: federais.size === 0 },
  }
}

const igual = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.05)

/**
 * Recalcula quem paga e o prazo de todas as contratações e grava o que mudou.
 * @returns {Promise<{ lidas: number, comPrazo: number, alteradas: number }>}
 */
export async function atualizarPagometroContratacoes(pool, { log = console.log } = {}) {
  // pagador_tipo é a última coluna que o schema acrescenta: com ela, todas existem.
  const tem = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'contratacoes' AND column_name = 'pagador_tipo'`,
  )
  if (!tem.rows.length) { log('[pagometro] contratacoes sem as colunas do Pagômetro (ou sem a tabela): nada a gravar'); return { lidas: 0, comPrazo: 0, alteradas: 0 } }
  const buscar = await carregarTabelas(pool)
  let ultimo = '', lidas = 0, comPrazo = 0, alteradas = 0
  for (;;) {
    const { rows } = await pool.query(
      `SELECT numero_controle_pncp AS id, uf, municipio, razao_social_orgao AS orgao, esfera, codigo_unidade AS ug,
              pagometro_dias::float8 AS dias, pagometro_pagador AS pagador, pagometro_fonte AS fonte, pagador_tipo AS tipo
         FROM contratacoes WHERE numero_controle_pncp > $1 ORDER BY numero_controle_pncp LIMIT ${LOTE}`,
      [ultimo],
    )
    if (!rows.length) break
    ultimo = rows[rows.length - 1].id
    lidas += rows.length
    const mud = { id: [], dias: [], pagador: [], fonte: [], tipo: [] }
    for (const r of rows) {
      const tipo = pagadorDe(r.orgao, r.esfera)
      const p = acharPagador(r, buscar)
      let novo = p
        ? { dias: Math.round(p.dias * 10) / 10, pagador: rotuloPagador(p, r.municipio), fonte: p.tipo === 'federal' ? 'portal' : 'siconfi' }
        : { dias: null, pagador: null, fonte: null }
      if (!p && r.fonte && buscar.vazia[r.fonte]) novo = { dias: r.dias, pagador: r.pagador, fonte: r.fonte }
      if (novo.dias != null) comPrazo++
      if (igual(novo.dias, r.dias) && (novo.pagador ?? null) === (r.pagador ?? null) && (novo.fonte ?? null) === (r.fonte ?? null)
          && tipo === r.tipo) continue
      mud.id.push(r.id); mud.dias.push(novo.dias); mud.pagador.push(novo.pagador); mud.fonte.push(novo.fonte); mud.tipo.push(tipo)
    }
    if (mud.id.length) {
      await pool.query(
        `UPDATE contratacoes c SET pagometro_dias = u.dias, pagometro_pagador = u.pagador, pagometro_fonte = u.fonte, pagador_tipo = u.tipo
           FROM unnest($1::text[], $2::numeric[], $3::text[], $4::text[], $5::text[]) AS u(id, dias, pagador, fonte, tipo)
          WHERE c.numero_controle_pncp = u.id`,
        [mud.id, mud.dias, mud.pagador, mud.fonte, mud.tipo],
      )
      alteradas += mud.id.length
    }
  }
  log(`[pagometro] contratações: ${lidas} lidas, ${comPrazo} com prazo de quem paga, ${alteradas} atualizadas`)
  return { lidas, comPrazo, alteradas }
}
