// scripts/deck/numeros.ts — mede no banco os números que a apresentação comercial
// publica e grava em scripts/deck/numeros.json.
//
// Rodar: npm run deck:numeros
//
// POR QUE É TypeScript e não .mjs como o resto de scripts/: para importar ABERTA,
// UNIVERSO e ANO_CORRENTE de src/lib/licitacoes/universo.ts. A apresentação não
// pode ter a sua própria definição de "aberta" — foi exatamente essa duplicação,
// espalhada por cinco lugares, que fez a mesma pergunta ter três respostas
// diferentes na plataforma (192.467 na landing, 231.650 na lista, 319.377 no mapa).
// Se a regra mudar lá, este script muda com ela, sem ninguém precisar lembrar.

import { Pool } from 'pg'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ABERTA, UNIVERSO, ANO_CORRENTE } from '../../src/lib/licitacoes/universo'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL ausente. Rode com: node --env-file=.env.local ou npm run deck:numeros')
  process.exit(1)
}

const pool = new Pool({ connectionString: url })

async function main() {
  const { rows: [r] } = await pool.query<Record<string, number | string>>(
    `SELECT sum(c.valor_total_estimado)::float8 AS valor,
            count(*)::int AS total,
            count(distinct c.municipio)::int AS munis,
            count(distinct c.uf)::int AS ufs,
            to_char(max(c.data_publicacao), 'DD/MM/YYYY') AS atualizado,
            count(*) FILTER (WHERE ${ABERTA('c')})::int AS abertas,
            count(*) FILTER (WHERE ${ANO_CORRENTE('c')} AND ${ABERTA('c')})::int AS "abertasAno",
            (SELECT count(distinct ni_fornecedor)::int FROM resultados
              WHERE ni_fornecedor IS NOT NULL) AS fornecedores,
            (SELECT count(*)::int FROM capag) AS capag,
            (SELECT count(*)::int FROM capag WHERE nota IN ('C','D')) AS "capagFraca",
            (SELECT count(*)::int FROM emendas_saude
              WHERE ano = EXTRACT(YEAR FROM now())) AS emendas
       FROM contratacoes c
      WHERE ${UNIVERSO('c')}`,
  )

  // Portais de DISPUTA: mesma resolução da tela e da landing (resolverPortal),
  // não uma contagem de `usuario_nome` — aquilo conta sistema publicador (IPM,
  // Betha, Fiorilli), que não é portal onde a sessão acontece.
  const { resolverPortal, ePortalDeDisputa } = await import('../../src/lib/portais')
  const { rows } = await pool.query<{ host: string; sistema: string }>(
    `SELECT lower(split_part(split_part(regexp_replace(coalesce(link_externo,''), '^https?://', ''), '/', 1), ':', 1)) AS host,
            coalesce(usuario_nome, '') AS sistema
       FROM contratacoes
      WHERE link_externo IS NOT NULL OR usuario_nome IS NOT NULL
      GROUP BY 1, 2`,
  )
  const portais = new Set<string>()
  for (const row of rows) {
    const id = resolverPortal({ linkExterno: row.host || null, usuarioNome: row.sistema || null })
    if (ePortalDeDisputa(id)) portais.add(id)
  }

  const saida = {
    medidoEm: new Date().toLocaleDateString('pt-BR'),
    ano: new Date().getFullYear(),
    abertasAno: Number(r.abertasAno),
    abertas: Number(r.abertas),
    total: Number(r.total),
    munis: Number(r.munis),
    ufs: Number(r.ufs),
    portais: portais.size,
    fornecedores: Number(r.fornecedores),
    capag: Number(r.capag),
    capagFraca: Number(r.capagFraca),
    emendas: Number(r.emendas),
    valorBi: Math.round((Number(r.valor) / 1e9) * 10) / 10,
    atualizado: String(r.atualizado),
  }

  const destino = join(import.meta.dirname, 'numeros.json')
  writeFileSync(destino, JSON.stringify(saida, null, 2) + '\n', 'utf8')
  console.log(JSON.stringify(saida, null, 2))
  console.log('\ngravado em', destino, '— agora rode: npm run deck')
  await pool.end()
}

main().catch(async (e) => {
  console.error('falhou:', e instanceof Error ? e.message : e)
  await pool.end()
  process.exit(1)
})
