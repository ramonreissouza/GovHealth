// scripts/jira/list-issues.mjs
// Lista os issues ABERTOS do backlog de suporte ("Reporte um problema") em JSON.
// Fonte: Jira (se JIRA_* estiver configurado); senão, cai para a tabela local
// feedback_issues (que espelha o Jira). Uso: node scripts/jira/list-issues.mjs
//   ou:  npm run jira:issues
//
// Saída: JSON puro no stdout — consumido pelo comando /check-bugs do Claude Code.
// NÃO implementa nada; é só leitura (barato). O ranking/seleção é feito pelo Claude.

import fs from 'node:fs'

function loadEnv() {
  try {
    const env = fs.readFileSync('.env.local', 'utf8')
    for (const line of env.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  } catch { /* sem .env.local */ }
}
loadEnv()

const jira = {
  baseUrl: process.env.JIRA_BASE_URL?.replace(/\/+$/, ''),
  email: process.env.JIRA_EMAIL,
  token: process.env.JIRA_API_TOKEN,
  projectKey: process.env.JIRA_PROJECT_KEY,
}
const jiraOk = !!(jira.baseUrl && jira.email && jira.token && jira.projectKey)

// severidade a partir das labels que o app grava (sev-critica, sev-alta…)
function sevFromLabels(labels = []) {
  const m = labels.find((l) => l.startsWith('sev-'))
  return m ? m.slice(4) : null
}
function tipoFromLabels(labels = []) {
  return labels.find((l) => ['bug', 'sugestao', 'duvida', 'melhoria'].includes(l)) ?? null
}

async function fromJira() {
  const jql = `project = "${jira.projectKey}" AND statusCategory != Done ORDER BY created DESC`
  const auth = 'Basic ' + Buffer.from(`${jira.email}:${jira.token}`).toString('base64')
  const res = await fetch(`${jira.baseUrl}/rest/api/2/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({
      jql,
      maxResults: 100,
      fields: ['summary', 'description', 'priority', 'labels', 'status', 'created', 'reporter'],
    }),
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`Jira ${res.status}: ${await res.text().catch(() => '')}`)
  const j = await res.json()
  return (j.issues ?? []).map((it) => {
    const f = it.fields ?? {}
    return {
      key: it.key,
      titulo: f.summary ?? '',
      descricao: f.description ?? '',
      tipo: tipoFromLabels(f.labels),
      severidade: sevFromLabels(f.labels),
      prioridadeJira: f.priority?.name ?? null,
      status: f.status?.name ?? null,
      reporter: f.reporter?.displayName ?? null,
      criadoEm: f.created ?? null,
      url: `${jira.baseUrl}/browse/${it.key}`,
    }
  })
}

async function fromDb() {
  const pg = (await import('pg')).default
  if (!process.env.DATABASE_URL) throw new Error('Sem JIRA_* e sem DATABASE_URL — nada para listar.')
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const r = await c.query(
      `SELECT id, titulo, descricao, tipo, severidade, status, jira_key,
              contexto->>'rota' AS rota, user_email, criado_em,
              (SELECT count(*)::int FROM feedback_anexos a WHERE a.issue_id = f.id) AS anexos
         FROM feedback_issues f
        WHERE status NOT IN ('integrado','rejeitado')
        ORDER BY criado_em DESC LIMIT 100`)
    return r.rows.map((x) => ({
      key: x.jira_key ?? x.id.slice(0, 8),
      titulo: x.titulo,
      descricao: x.descricao,
      tipo: x.tipo,
      severidade: x.severidade,
      prioridadeJira: null,
      status: x.status,
      reporter: x.user_email,
      rota: x.rota,
      anexos: x.anexos,
      criadoEm: x.criado_em,
      url: null,
    }))
  } finally { await c.end() }
}

try {
  const source = jiraOk ? 'jira' : 'db'
  const issues = jiraOk ? await fromJira() : await fromDb()
  console.log(JSON.stringify({ source, jiraConfigurado: jiraOk, total: issues.length, issues }, null, 2))
} catch (e) {
  console.log(JSON.stringify({ erro: e instanceof Error ? e.message : String(e), jiraConfigurado: jiraOk }, null, 2))
  process.exitCode = 1
}
