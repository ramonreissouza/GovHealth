// src/lib/jira.ts — integração com o Jira (backlog espelhado). Server-only.
// INERTE até as credenciais serem configuradas: sem as envs, todas as funções viram
// no-op (retornam null) e nada quebra. É o "último passo" do pipeline de suporte.
//
// Go-live (envs na Vercel + .env.local):
//   JIRA_BASE_URL     = https://SEU-SITE.atlassian.net
//   JIRA_EMAIL        = e-mail da conta Atlassian
//   JIRA_API_TOKEN    = token de API (id.atlassian.com → Security → API tokens)
//   JIRA_PROJECT_KEY  = ex. SUP
//   JIRA_ISSUE_TYPE   = (opcional) tipo de issue; padrão 'Task'
//
// Usa a REST API v2 (description em texto puro — evita o ADF da v3).

import type { FeedbackTipo, FeedbackSeveridade, FeedbackStatus } from './feedback'
import { STATUS_LABEL, TIPO_LABEL, SEVERIDADE_LABEL } from './feedback'

interface JiraCfg { baseUrl: string; email: string; token: string; projectKey: string; issueType: string }

function cfg(): JiraCfg | null {
  const baseUrl = process.env.JIRA_BASE_URL?.replace(/\/+$/, '')
  const email = process.env.JIRA_EMAIL
  const token = process.env.JIRA_API_TOKEN
  const projectKey = process.env.JIRA_PROJECT_KEY
  if (!baseUrl || !email || !token || !projectKey) return null
  return { baseUrl, email, token, projectKey, issueType: process.env.JIRA_ISSUE_TYPE || 'Task' }
}

export function jiraConfigurado(): boolean {
  return cfg() !== null
}

function authHeader(c: JiraCfg): string {
  return 'Basic ' + Buffer.from(`${c.email}:${c.token}`).toString('base64')
}

interface CriarCardInput {
  titulo: string
  descricao: string
  tipo: FeedbackTipo
  severidade: FeedbackSeveridade
  reporter?: string | null
  rota?: string | null
  issueId: string
}

/** Cria um card no Jira. Retorna a key (ex.: SUP-123) ou null (não configurado/erro). */
export async function criarCardJira(input: CriarCardInput): Promise<string | null> {
  const c = cfg()
  if (!c) return null
  const descricao = [
    input.descricao || '(sem detalhes)',
    '',
    `Tipo: ${TIPO_LABEL[input.tipo]}`,
    `Severidade: ${SEVERIDADE_LABEL[input.severidade]}`,
    input.reporter ? `Reportado por: ${input.reporter}` : '',
    input.rota ? `Rota: ${input.rota}` : '',
    `GovHealth issue: ${input.issueId}`,
  ].filter(Boolean).join('\n')

  try {
    const res = await fetch(`${c.baseUrl}/rest/api/2/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader(c) },
      body: JSON.stringify({
        fields: {
          project: { key: c.projectKey },
          summary: input.titulo.slice(0, 250),
          description: descricao,
          issuetype: { name: c.issueType },
          labels: ['govhealth', `sev-${input.severidade}`, input.tipo],
        },
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) { console.warn('[jira] criar card falhou:', res.status, await res.text().catch(() => '')); return null }
    const j = await res.json()
    return j.key ?? null
  } catch (e) {
    console.warn('[jira] criar card erro:', e instanceof Error ? e.message : e)
    return null
  }
}

/** Adiciona um comentário ao card (usado nas mudanças de status). Best-effort. */
export async function comentarJira(jiraKey: string, texto: string): Promise<boolean> {
  const c = cfg()
  if (!c || !jiraKey) return false
  try {
    const res = await fetch(`${c.baseUrl}/rest/api/2/issue/${encodeURIComponent(jiraKey)}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader(c) },
      body: JSON.stringify({ body: texto }),
      signal: AbortSignal.timeout(15000),
    })
    return res.ok
  } catch { return false }
}

/** Comentário padronizado de mudança de status. */
export function comentarStatus(jiraKey: string, status: FeedbackStatus, extra?: string): Promise<boolean> {
  const txt = `GovHealth — status atualizado para "${STATUS_LABEL[status]}".${extra ? `\n${extra}` : ''}`
  return comentarJira(jiraKey, txt)
}
