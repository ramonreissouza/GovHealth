// scripts/etl-checkpoint-pendentes.teste.mjs — a lista de páginas abandonadas aguenta
// o que a produção faz com ela?
//
// POR QUE ESTE TESTE EXISTE. A perda de página do ETL era MUDA: o checkpoint avançava
// por cima da página abandonada e nenhuma execução futura a revisitava. Ninguém recebia
// erro. Foram duas páginas perdidas em dois mutirões (05-06/09/2026), achadas só porque
// alguém leu o stderr e caçou o buraco na sequência à mão.
//
// O conserto tem duas metades: a LISTA (aqui) e o LAÇO que a revisita (no etl-pncp).
// Esta metade dá para provar sem falar com o PNCP, e por isso é provada aqui — em vez
// de esperar uma falha real acontecer para descobrir se funciona.
//
// Usa uma chave sintética que não existe na produção e a apaga no fim.
//
// Uso: npm run checkpoint:teste     (sai 1 se falhar)

import fs from 'node:fs'
import pg from 'pg'

if (!process.env.DATABASE_URL) {
  for (const f of ['.env.local', '.env']) {
    if (!fs.existsSync(f)) continue
    const m = fs.readFileSync(f, 'utf8').match(/^DATABASE_URL=(.*)$/m)
    if (m) { process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, ''); break }
  }
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await db.connect()
const dbQuery = (q, p) => db.query(q, p)

const CHAVE = `uf:ZZ:mod:0:rTESTE_${process.pid}`
const TETO_PENDENTES = 100

// Cópias EXATAS das funções do etl-pncp.mjs. Divergir aqui é o modo de falha deste
// arquivo, então qualquer mexida numa das pontas tem de ser espelhada na outra.
async function lerPuladas(chave) {
  const r = await dbQuery('SELECT paginas_puladas FROM etl_checkpoint WHERE chave = $1', [chave])
  return r.rows[0]?.paginas_puladas ?? []
}
async function marcarPulada(chave, pagina) {
  await dbQuery(`INSERT INTO etl_checkpoint (chave, ultima_pagina, paginas_puladas)
    VALUES ($1, $2, ARRAY[$2::int])
    ON CONFLICT (chave) DO UPDATE SET
      paginas_puladas = CASE
        WHEN cardinality(etl_checkpoint.paginas_puladas) >= ${TETO_PENDENTES}
          THEN etl_checkpoint.paginas_puladas
        ELSE (SELECT array_agg(DISTINCT p ORDER BY p)
                FROM unnest(etl_checkpoint.paginas_puladas || ARRAY[$2::int]) p)
      END`, [chave, pagina])
}
async function limparPulada(chave, pagina) {
  await dbQuery('UPDATE etl_checkpoint SET paginas_puladas = array_remove(paginas_puladas, $2::int) WHERE chave = $1',
    [chave, pagina])
}
async function salvarCheckpoint(chave, pagina) {
  await dbQuery(`INSERT INTO etl_checkpoint (chave, ultima_pagina) VALUES ($1,$2)
    ON CONFLICT (chave) DO UPDATE SET ultima_pagina = EXCLUDED.ultima_pagina, atualizado_em = now()`, [chave, pagina])
}

let ok = 0
let falhou = 0
const conferir = (nome, real, esperado) => {
  if (JSON.stringify(real) === JSON.stringify(esperado)) { ok++; console.log(`  ok   ${nome}`) }
  else { falhou++; console.log(`  FALHOU ${nome} — esperado ${JSON.stringify(esperado)}, real ${JSON.stringify(real)}`) }
}

try {
  await dbQuery('DELETE FROM etl_checkpoint WHERE chave = $1', [CHAVE])

  conferir('chave inexistente devolve lista vazia', await lerPuladas(CHAVE), [])

  // A primeira anotação costuma acontecer numa chave que JÁ existe (o checkpoint foi
  // gravado antes), mas pode acontecer numa que não existe — se a página 1 falhar de
  // cara. Por isso é INSERT ... ON CONFLICT e não UPDATE.
  await marcarPulada(CHAVE, 14)
  conferir('anota numa chave que ainda não existia', await lerPuladas(CHAVE), [14])

  await marcarPulada(CHAVE, 22)
  await marcarPulada(CHAVE, 3)
  conferir('acumula e mantém ordenado', await lerPuladas(CHAVE), [3, 14, 22])

  // Idempotência importa: a mesma página pode falhar de novo numa rodada seguinte, e
  // duplicar faria a revisita buscar a mesma página duas vezes.
  await marcarPulada(CHAVE, 14)
  conferir('anotar de novo não duplica', await lerPuladas(CHAVE), [3, 14, 22])

  // O checkpoint segue avançando por cima: é ele que mantém o progresso durável. A
  // lista é justamente o que impede que esse avanço APAGUE a página.
  await salvarCheckpoint(CHAVE, 47)
  const r = await dbQuery('SELECT ultima_pagina, paginas_puladas FROM etl_checkpoint WHERE chave = $1', [CHAVE])
  conferir('salvarCheckpoint NÃO apaga a lista', r.rows[0].paginas_puladas, [3, 14, 22])
  conferir('e o checkpoint avançou mesmo assim', r.rows[0].ultima_pagina, 47)

  await limparPulada(CHAVE, 14)
  conferir('recuperar tira só aquela página', await lerPuladas(CHAVE), [3, 22])

  await limparPulada(CHAVE, 999)
  conferir('limpar página que não está na lista é inócuo', await lerPuladas(CHAVE), [3, 22])

  await limparPulada(CHAVE, 3)
  await limparPulada(CHAVE, 22)
  conferir('lista esvazia por completo', await lerPuladas(CHAVE), [])

  // O teto existe para o caso patológico: paginação profunda inteira morta faria a
  // lista virar uma fila de milhares que nunca esvazia e custaria uma rodada inteira
  // só de revisita.
  for (let p = 1; p <= TETO_PENDENTES + 15; p++) await marcarPulada(CHAVE, p)
  const cheia = await lerPuladas(CHAVE)
  conferir(`para de crescer no teto de ${TETO_PENDENTES}`, cheia.length, TETO_PENDENTES)
  conferir('e o que ficou são as PRIMEIRAS (as mais antigas)', [cheia[0], cheia[cheia.length - 1]], [1, TETO_PENDENTES])
} finally {
  await dbQuery('DELETE FROM etl_checkpoint WHERE chave = $1', [CHAVE])
  const sobrou = await dbQuery('SELECT 1 FROM etl_checkpoint WHERE chave = $1', [CHAVE])
  conferir('a chave de teste foi apagada da produção', sobrou.rowCount, 0)
  await db.end()
}

console.log(`\n${ok} ok · ${falhou} falharam`)
process.exit(falhou ? 1 : 0)
