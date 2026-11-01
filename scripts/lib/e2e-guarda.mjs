// scripts/lib/e2e-guarda.mjs — antes de um teste e2e APAGAR um banco, prove que ele é
// descartável.
//
// POR QUE (revisão da #68). Os e2e fazem `DROP SCHEMA public CASCADE` e a única guarda era
// "host é localhost". Só que o banco do k3s se acessa por `kubectl port-forward` — a URL de
// PRODUÇÃO tunelada também é localhost, e passava. Agora são três provas, todas exigidas:
//   1. host local (localhost/127.0.0.1);
//   2. o NOME do banco, lido do próprio servidor (`current_database()`, não da URL),
//      termina em `_e2e` — o de produção se chama `govhealth`;
//   3. ALLOW_DESTRUCTIVE_E2E=<CONFIRMACAO_E2E> no ambiente: ninguém apaga por acidente
//      rodando o script com o DATABASE_URL errado à mão.

export const CONFIRMACAO_E2E = 'apagar-banco-descartavel'
const NOME_E2E = /_e2e$/

/** Prova 1 (antes de conectar). Lança se o host não for local. */
export function conferirHostE2E(url) {
  const host = new URL(url).hostname
  if (!['localhost', '127.0.0.1'].includes(host)) {
    throw new Error(`recuso apagar o banco em ${host}: só host local`)
  }
}

/**
 * Provas 2 e 3 (com o cliente já conectado, antes do primeiro comando destrutivo).
 * `client` é qualquer objeto com `query` do `pg`. Lança se faltar qualquer prova.
 */
export async function exigirBancoDescartavel(client, env = process.env) {
  if (env.ALLOW_DESTRUCTIVE_E2E !== CONFIRMACAO_E2E) {
    throw new Error(`teste destrutivo: defina ALLOW_DESTRUCTIVE_E2E=${CONFIRMACAO_E2E} para confirmar que o banco pode ser apagado`)
  }
  const { rows } = await client.query('SELECT current_database() AS banco')
  const banco = rows[0]?.banco
  if (!NOME_E2E.test(String(banco ?? ''))) {
    throw new Error(`recuso apagar o banco "${banco}": o nome de um banco descartável termina em _e2e`)
  }
  return banco
}
