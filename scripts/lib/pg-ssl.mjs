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
//
// MAS O QUE VOLTA É CIFRAGEM, NÃO IDENTIDADE. `rejectUnauthorized: false` cifra o
// canal e NÃO verifica o certificado do servidor: protege contra escuta passiva, não
// contra MITM ativo — e o caminho em questão leva credenciais de produção por IP
// público. Os 66 scripts já faziam isso antes deste helper existir, então não é
// regressão; o que mudou é que agora há UMA linha para corrigir quando houver uma CA
// para confiar. `PGSSLROOTCERT` liga a verificação sem tocar em nenhum call site.

import fs from 'node:fs'
import pg from 'pg'

/** Lê a CA de `PGSSLROOTCERT`, quando houver. Sem ela, segue cifrando sem verificar. */
function caDoAmbiente() {
  const caminho = process.env.PGSSLROOTCERT
  if (!caminho) return null
  try { return fs.readFileSync(caminho, 'utf8') } catch (e) {
    console.warn(`[pg-ssl] PGSSLROOTCERT aponta para ${caminho}, que não deu para ler:`, String(e?.message ?? e))
    return null
  }
}

/**
 * @param {string | undefined} connectionString
 * @returns {false | { rejectUnauthorized: boolean, ca?: string }}
 */
export function sslParaHost(connectionString) {
  const bruta = String(connectionString ?? '')
  let host = null
  try { host = new URL(bruta).hostname } catch { /* tratado abaixo */ }

  // O SILÊNCIO FOI O QUE DEIXOU O BUG ORIGINAL SOBREVIVER UM ANO E MEIO. Quando não dá
  // para ler o host, o default é o seguro (TLS), mas ele passa a ser DITO: formato
  // `key=value` (`host=localhost port=5432`) e socket unix são aceitos pelo `pg` e
  // rejeitados pelo `URL`, e senha com `/`, `#` ou `@` não escapado faz o parse errar o
  // hostname em vez de lançar. Nesses casos quem lê o log fica sabendo.
  if (host === null) {
    console.warn('[pg-ssl] não consegui ler o host da connection string — assumindo TLS.'
      + ' Se o destino não tem TLS (túnel/localhost), a conexão vai falhar com'
      + ' "The server does not support SSL connections".')
  }

  const semTls = host === 'db' || host === 'localhost' || host === '127.0.0.1'
  if (semTls) return false
  const ca = caDoAmbiente()
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: false }
}

/**
 * FÁBRICAS — use estas, não o `sslParaHost` solto.
 *
 * A assinatura de `sslParaHost(s)` aceita uma string sem relação obrigatória com a que
 * vai para `connectionString`, e foi exatamente assim que 5 scripts saíram errados na
 * conversão em massa: decidiam o TLS por `process.env.DATABASE_URL` e conectavam numa
 * URL vinda do `argv`, de `dbUrl()` ou do `.env.local`. Aqui isso é impossível por
 * construção — a mesma `url` decide e conecta.
 */
export function novoClient(url = process.env.DATABASE_URL, extra = {}) {
  return new pg.Client({ connectionString: url, ssl: sslParaHost(url), ...extra })
}

export function novoPool(url = process.env.DATABASE_URL, extra = {}) {
  return new pg.Pool({ connectionString: url, ssl: sslParaHost(url), ...extra })
}
