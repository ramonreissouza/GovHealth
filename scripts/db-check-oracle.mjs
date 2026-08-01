// Teste rápido de conectividade + leitura/escrita no Oracle VM (IP novo).
// Uso: node scripts/db-check-oracle.mjs "postgresql://.../govhealth?sslmode=require&uselibpqcompat=true"
import pg from 'pg';

const url = process.argv[2];
if (!url) {
  console.error('Faltou a URL do banco como argumento.');
  process.exit(2);
}

const pool = new pg.Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});

try {
  const t0 = Date.now();
  const v = await pool.query('select version()');
  const c = await pool.query('select count(*)::int as n from contratacoes');
  const i = await pool.query('select count(*)::int as n from itens');
  // escrita de teste isolada (cria/insere/remove numa tabela temporária efêmera)
  await pool.query('create temp table _chk (x int)');
  await pool.query('insert into _chk values (1)');
  const w = await pool.query('select count(*)::int as n from _chk');
  const ms = Date.now() - t0;
  console.log('OK conexão em', ms, 'ms');
  console.log('version:', v.rows[0].version.split(',')[0]);
  console.log('contratacoes:', c.rows[0].n);
  console.log('itens:', i.rows[0].n);
  console.log('escrita (temp):', w.rows[0].n === 1 ? 'OK' : 'FALHOU');
  process.exit(0);
} catch (e) {
  console.error('FALHOU:', e.message);
  process.exit(1);
} finally {
  await pool.end().catch(() => {});
}
