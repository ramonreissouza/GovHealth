// scripts/lib/pg-ssl.mjs — decide TLS pelo HOST, igual a `src/lib/db.ts`.
//
// POR QUE ISTO EXISTE (17/09/2026)
//
// 66 dos 73 scripts que falam com o banco cravavam `ssl: { rejectUnauthorized: false }`
// na mão. Isso funcionou por um ano e meio porque o banco sempre esteve atrás de um
// PgBouncer com TLS, num IP público. Na virada para a VPS nova o Postgres passou a
// viver dentro do compose, preso em `127.0.0.1:5432`, e o acesso de fora vira túnel
// SSH — ou seja, `localhost`, sem TLS, porque o túnel JÁ é o canal cifrado.
//
// E aí o modo de falha é o pior possível: exigir SSL contra um Postgres que não tem
// TLS não degrada para texto puro, **derruba a conexão inteira**:
//
//     Error: The server does not support SSL connections
//
// Foi exatamente assim que o coletor do Radar morreu na primeira passada depois da
// migração. A `src/lib/db.ts` já tratava isso — e tem o comentário explicando — mas
// os scripts nunca souberam, porque cada um montava o próprio Pool.
//
// A regra é a mesma dos dois lados, e o ponto é esse: um lugar só para mudar.
//
//   host `db` / `localhost` / `127.0.0.1` → sem TLS (rede interna do compose ou túnel)
//   qualquer outro host                   → TLS
//
// Isso continua certo se um dia o pooler for exposto de novo num IP público: o host
// deixa de ser localhost e o TLS volta sozinho, sem tocar em script nenhum.

/**
 * @param {string | undefined} connectionString
 * @returns {false | { rejectUnauthorized: boolean }}
 */
export function sslParaHost(connectionString) {
  let host = ''
  // connectionString malformada cai no default seguro (com TLS) lá embaixo.
  try { host = new URL(String(connectionString ?? '')).hostname } catch { /* ignore */ }
  const semTls = host === 'db' || host === 'localhost' || host === '127.0.0.1'
  return semTls ? false : { rejectUnauthorized: false }
}

/** Atalho para o caso comum: decidir a partir do DATABASE_URL do ambiente. */
export function sslDoAmbiente() {
  return sslParaHost(process.env.DATABASE_URL)
}
