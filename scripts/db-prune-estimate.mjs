import fs from 'node:fs'
import pg from 'pg'
if (!process.env.DATABASE_URL) {
  try { const env = fs.readFileSync('.env.local','utf8'); const m=env.match(/^DATABASE_URL=(.*)$/m); if(m) process.env.DATABASE_URL=m[1].trim().replace(/^["']|["']$/g,'') } catch {}
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} })
await client.connect()
try {
  // Como itens/resultados se ligam a contratacoes?
  const fk = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='itens'`)
  console.log('Colunas de itens:', fk.rows.map(r=>r.column_name).join(', '))
  const fr = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='resultados'`)
  console.log('Colunas de resultados:', fr.rows.map(r=>r.column_name).join(', '))

  // Quantos itens/resultados pertencem a contratacoes encerradas há +365 dias
  for (const dias of [365, 730]) {
    try {
      const q = await client.query(`
        WITH velhas AS (
          SELECT numero_controle_pncp FROM contratacoes
          WHERE data_encerramento_proposta < now() - ($1||' days')::interval
            AND data_encerramento_proposta < now()
        )
        SELECT
          (SELECT count(*) FROM velhas) AS contratacoes,
          (SELECT count(*) FROM itens i JOIN velhas v ON i.numero_controle_pncp=v.numero_controle_pncp) AS itens,
          (SELECT count(*) FROM resultados r JOIN velhas v ON r.numero_controle_pncp=v.numero_controle_pncp) AS resultados
      `,[dias])
      console.log(`\nEncerradas há +${dias} dias: ${q.rows[0].contratacoes} contratações, ${q.rows[0].itens} itens, ${q.rows[0].resultados} resultados`)
    } catch(e){ console.log(`(join por numero_controle_pncp falhou p/ ${dias}d: ${e.message})`) }
  }

  // Índices das 3 tabelas grandes
  const idx = await client.query(`
    SELECT tablename, indexname, pg_size_pretty(pg_relation_size(indexrelid)) AS tamanho
    FROM pg_stat_user_indexes JOIN pg_indexes USING (indexname)
    WHERE tablename IN ('itens','resultados','contratacoes')
    ORDER BY pg_relation_size(indexrelid) DESC`)
  console.log('\nÍNDICES das tabelas grandes:')
  for (const x of idx.rows) console.log('  '+String(x.tablename).padEnd(14), String(x.indexname).padEnd(40), x.tamanho)
} catch(e){ console.error('Falha:', e.message); process.exitCode=1 } finally { await client.end() }
