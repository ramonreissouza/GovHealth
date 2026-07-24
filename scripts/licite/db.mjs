// scripts/licite/db.mjs — grava licitações do Licitações-e em `contratacoes`
// (fonte='licitacoes-e'), reutilizando a mesma tabela do PNCP para que apareçam
// automaticamente nas telas. Sem itens/resultados → aparecem como "Em aberto".
//
// Chave sintética: numero_controle_pncp = 'LICE-<numero>' (não colide com o PNCP).
// Valor/datas não vêm na lista do portal (só no detalhe) → nulos na v1; o link_externo
// aponta para o detalhe no próprio Licitações-e.

import pg from 'pg'
import { categoria } from '../saude-filter.mjs'
import { linkDetalhe } from './collect.mjs'

export function novoDb() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  c.on('error', (e) => console.warn(`  [db] erro de conexão: ${e.message}`))
  return c
}

export async function upsertLicitacoes(db, rows) {
  let n = 0
  for (const r of rows) {
    const id = `LICE-${r.numero}`
    await db.query(
      `INSERT INTO contratacoes (numero_controle_pncp, cnpj_orgao, razao_social_orgao, municipio, uf,
         modalidade_nome, objeto_compra, ano_compra, sequencial_compra, valor_total_estimado,
         data_publicacao, situacao_id, categoria_saude, coletado_em, fonte, link_externo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now(), 'licitacoes-e', $14)
       ON CONFLICT (numero_controle_pncp) DO UPDATE SET
         razao_social_orgao = EXCLUDED.razao_social_orgao,
         uf                 = EXCLUDED.uf,
         modalidade_nome    = EXCLUDED.modalidade_nome,
         objeto_compra      = EXCLUDED.objeto_compra,
         categoria_saude    = EXCLUDED.categoria_saude,
         link_externo       = EXCLUDED.link_externo,
         coletado_em        = now()`,
      [
        id,
        '',                       // cnpj_orgao (NOT NULL) — a lista não expõe CNPJ
        r.orgao || null,
        null,                     // municipio (só no detalhe)
        r.uf || null,
        r.modalidade || null,
        r.objeto || null,
        null, null,               // ano/sequencial (não se aplica)
        null,                     // valor_total_estimado (só no detalhe)
        null,                     // data_publicacao (só no detalhe)
        1,                        // situacao_id (cosmético; status real = ausência de resultado)
        categoria(r.objeto),
        linkDetalhe(r.numero),
      ],
    )
    n++
  }
  return n
}
