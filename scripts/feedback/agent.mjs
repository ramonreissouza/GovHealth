// scripts/feedback/agent.mjs — AGENTE de suporte: consome o backlog feedback_issues,
// triága, gera solução e (após aprovação humana) integra. Roda LOCAL (não na Vercel):
// no modo 'real' invoca o Claude Code HEADLESS na SUA assinatura (sem custo de API por
// token) dentro de um git worktree isolado, captura o diff e propõe. Você valida no
// /admin (Suporte) e, ao aprovar, o worker faz merge→push (deploy Vercel automático).
//
// Uso:
//   npm run feedback:agent            # loop contínuo (poll)
//   node scripts/feedback/agent.mjs --once
// Env:
//   FEEDBACK_MODE=stub|real   (padrão stub — NÃO toca git/Claude; testa o pipeline)
//   FEEDBACK_POLL_MS=15000
//   CLAUDE_CMD=claude         (comando do Claude Code headless)
//   FEEDBACK_MAIN_BRANCH=main
//   ZAI_API_KEY / ZAI_MODEL   (triagem no modo real; cai p/ heurística sem chave)
//   FEEDBACK_AUTODEPLOY=0|1   (1 = push p/ main na integração; 0 = só merge local)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import pg from 'pg'

// ── env ───────────────────────────────────────────────────────────────────────
function loadEnv() {
  if (process.env.DATABASE_URL) return
  try {
    const env = fs.readFileSync('.env.local', 'utf8')
    for (const k of ['DATABASE_URL', 'ZAI_API_KEY', 'ZAI_MODEL', 'ZAI_BASE_URL']) {
      const m = env.match(new RegExp(`^${k}=(.*)$`, 'm'))
      if (m && !process.env[k]) process.env[k] = m[1].trim().replace(/^["']|["']$/g, '')
    }
  } catch { /* sem .env.local */ }
}
loadEnv()
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const MODE = (process.env.FEEDBACK_MODE ?? 'stub').toLowerCase()
const POLL_MS = Number(process.env.FEEDBACK_POLL_MS ?? 15000)
const ONCE = process.argv.includes('--once')
const CLAUDE_CMD = process.env.CLAUDE_CMD ?? 'claude'
const MAIN_BRANCH = process.env.FEEDBACK_MAIN_BRANCH ?? 'main'
const AUTODEPLOY = process.env.FEEDBACK_AUTODEPLOY === '1'
const REPO = process.cwd()
const ts = () => new Date().toLocaleString('pt-BR')
const log = (...a) => console.log(`[feedback-agent ${ts()}]`, ...a)

// ── pg ────────────────────────────────────────────────────────────────────────
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await db.connect()
async function q(text, params) { return db.query(text, params) }

// Reivindica UM issue de um status e move para outro (atômico, single-worker-safe).
async function claim(deStatus, paraStatus) {
  const r = await q(
    `UPDATE feedback_issues SET status = $2, atualizado_em = now()
     WHERE id = (SELECT id FROM feedback_issues WHERE status = $1 ORDER BY criado_em LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING *`, [deStatus, paraStatus])
  return r.rows[0] ?? null
}
async function setSolucao(id, solucao, status) {
  await q(`UPDATE feedback_issues SET solucao = $2::jsonb, status = $3, atualizado_em = now() WHERE id = $1`,
    [id, JSON.stringify(solucao), status])
}
async function setAnalise(id, analise, status) {
  await q(`UPDATE feedback_issues SET analise = $2::jsonb, status = $3, atualizado_em = now() WHERE id = $1`,
    [id, JSON.stringify(analise), status])
}
async function setStatus(id, status, resolvido = false) {
  await q(`UPDATE feedback_issues SET status = $2, atualizado_em = now(),
           resolvido_em = CASE WHEN $3 THEN now() ELSE resolvido_em END WHERE id = $1`, [id, status, resolvido])
}

// ── git helpers ───────────────────────────────────────────────────────────────
function git(args, cwd = REPO) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
}
function branchName(id) { return `feedback/${id.slice(0, 8)}` }

// ── triagem (novo → triado) ───────────────────────────────────────────────────
const CAT_HEURISTICA = [
  [/login|senha|sessão|sessao|autentic|logout/i, 'auth'],
  [/lento|trava|demora|performance|carregando/i, 'performance'],
  [/erro|falha|quebr|bug|não funciona|nao funciona|500|undefined/i, 'bug'],
  [/tela|bot[aã]o|layout|cor|texto|filtro|coluna|design/i, 'ui'],
  [/dado|valor|número|numero|errado|divergente|c[aá]lculo/i, 'dados'],
]
function triarHeuristica(issue) {
  const txt = `${issue.titulo} ${issue.descricao}`
  const categoria = (CAT_HEURISTICA.find(([re]) => re.test(txt)) ?? [null, 'bug'])[1]
  const componentes = issue.contexto?.rota ? [`rota ${issue.contexto.rota}`] : []
  return { categoria, componentes, severidadeSugerida: issue.severidade, resumo: issue.titulo, modelo: 'heuristica', triadoEm: new Date().toISOString() }
}
async function triarZai(issue) {
  if (!process.env.ZAI_API_KEY) return triarHeuristica(issue)
  try {
    const base = process.env.ZAI_BASE_URL ?? 'https://api.z.ai/api/paas/v4'
    const model = process.env.ZAI_MODEL ?? 'glm-4.5-flash'
    const prompt = `Classifique este relato de suporte de um SaaS (Next.js). Responda SOMENTE JSON: {"categoria":"ui|dados|auth|performance|bug|outro","componentes":["área/arquivo provável"],"severidadeSugerida":"baixa|media|alta|critica","resumo":"1 frase"}.\nTítulo: ${issue.titulo}\nDetalhes: ${issue.descricao}\nRota: ${issue.contexto?.rota ?? '—'}`
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ZAI_API_KEY}` },
      body: JSON.stringify({ model, temperature: 0.2, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(60000),
    })
    const j = await res.json()
    const txt = j.choices?.[0]?.message?.content ?? ''
    const m = txt.match(/\{[\s\S]*\}/)
    const parsed = m ? JSON.parse(m[0]) : {}
    return { ...triarHeuristica(issue), ...parsed, modelo: 'zai-glm', triadoEm: new Date().toISOString() }
  } catch (e) {
    log('triagem Z.ai falhou, usando heurística:', e.message)
    return triarHeuristica(issue)
  }
}

async function passoTriagem() {
  const issue = await claim('novo', 'triado')
  if (!issue) return false
  log(`triando ${issue.id.slice(0, 8)} — "${issue.titulo}"`)
  const analise = MODE === 'real' ? await triarZai(issue) : triarHeuristica(issue)
  await setAnalise(issue.id, analise, 'triado')
  return true
}

// ── geração de solução (triado → solucao_proposta) ────────────────────────────
function promptClaude(issue) {
  return [
    `Você é um engenheiro do GovHealth AI (Next.js 14 + TypeScript). Um usuário reportou:`,
    `TÍTULO: ${issue.titulo}`,
    `DETALHES: ${issue.descricao || '(sem detalhes)'}`,
    `ROTA/CONTEXTO: ${issue.contexto?.rota ?? '—'}`,
    ``,
    `Tarefa: localize a causa e IMPLEMENTE a correção mínima e segura editando os arquivos.`,
    `NÃO faça commit, NÃO faça push. Mantenha o escopo pequeno. Ao terminar, escreva um`,
    `resumo curto do diagnóstico e do que mudou.`,
  ].join('\n')
}

function gerarSolucaoReal(issue) {
  const branch = branchName(issue.id)
  const wt = path.join(os.tmpdir(), `govhealth-feedback-${issue.id.slice(0, 8)}`)
  fs.rmSync(wt, { recursive: true, force: true })
  // Worktree isolado a partir da main → o agente não mexe na sua árvore de trabalho.
  try { git(['worktree', 'remove', '--force', wt]) } catch { /* inexistente */ }
  try { git(['branch', '-D', branch]) } catch { /* inexistente */ }
  git(['worktree', 'add', '-b', branch, wt, MAIN_BRANCH])
  let resultado = ''
  try {
    // Claude Code headless na assinatura (sem ANTHROPIC_API_KEY). acceptEdits: aplica
    // as edições sem prompt interativo. Roda com CWD no worktree.
    const out = execFileSync(CLAUDE_CMD, ['-p', promptClaude(issue), '--output-format', 'json', '--permission-mode', 'acceptEdits'],
      { cwd: wt, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60 * 1000 })
    try { resultado = JSON.parse(out).result ?? out } catch { resultado = out }
  } catch (e) {
    resultado = `Claude Code falhou: ${e.message}`
  }
  // Captura o diff (inclui novos arquivos via add -A).
  git(['add', '-A'], wt)
  const diff = git(['diff', '--cached'], wt)
  const arquivos = diff ? git(['diff', '--cached', '--name-only'], wt).split('\n').filter(Boolean) : []
  if (diff) {
    // Commit na branch p/ a integração poder fazer merge depois; remove o worktree (mantém a branch).
    git(['commit', '-m', `fix: ${issue.titulo} (feedback ${issue.id.slice(0, 8)})`], wt)
  }
  try { git(['worktree', 'remove', '--force', wt]) } catch { /* ok */ }
  return {
    resumo: (resultado || issue.titulo).split('\n')[0].slice(0, 160),
    diagnostico: resultado, plano: resultado, arquivos, diff, branch,
    risco: arquivos.length > 6 ? 'alto' : arquivos.length > 2 ? 'medio' : 'baixo',
    geradoEm: new Date().toISOString(), modelo: 'claude-code-headless',
    ...(diff ? {} : { erro: 'nenhuma alteração gerada — revisar manualmente' }),
  }
}

function gerarSolucaoStub(issue) {
  return {
    resumo: `(stub) proposta simulada para: ${issue.titulo}`,
    diagnostico: 'Modo stub — nenhuma análise real executada. Rode FEEDBACK_MODE=real para gerar patch com o Claude Code.',
    plano: 'n/a (stub)', arquivos: [], diff: '', branch: '',
    risco: 'baixo', geradoEm: new Date().toISOString(), modelo: 'stub',
  }
}

async function passoResolucao() {
  const issue = await claim('triado', 'em_analise')
  if (!issue) return false
  log(`resolvendo ${issue.id.slice(0, 8)} (modo ${MODE})`)
  try {
    const solucao = MODE === 'real' ? gerarSolucaoReal(issue) : gerarSolucaoStub(issue)
    await setSolucao(issue.id, solucao, 'solucao_proposta')
    log(`  → solução proposta (${solucao.arquivos?.length ?? 0} arquivo(s), risco ${solucao.risco})`)
  } catch (e) {
    log(`  ✗ falha ao resolver: ${e.message}`)
    await setSolucao(issue.id, { erro: e.message, geradoEm: new Date().toISOString(), modelo: MODE }, 'solucao_proposta')
  }
  return true
}

// ── integração (aprovado → integrado) ─────────────────────────────────────────
async function passoIntegracao() {
  const issue = await claim('aprovado', 'integrado') // otimista; revertemos se falhar
  if (!issue) return false
  const branch = issue.solucao?.branch
  log(`integrando ${issue.id.slice(0, 8)} (branch ${branch || '—'})`)
  if (MODE !== 'real' || !branch) {
    log('  modo stub ou sem branch — marcado como integrado (sem merge).')
    await setStatus(issue.id, 'integrado', true)
    return true
  }
  try {
    git(['checkout', MAIN_BRANCH])
    git(['merge', '--no-ff', branch, '-m', `merge: solução do feedback ${issue.id.slice(0, 8)} — ${issue.titulo}`])
    if (AUTODEPLOY) { git(['push', 'origin', MAIN_BRANCH]); log('  push→main feito (deploy Vercel disparado).') }
    else log('  merge local feito. FEEDBACK_AUTODEPLOY=1 para dar push e deployar.')
    try { git(['branch', '-d', branch]) } catch { /* mantém se falhar */ }
    await setStatus(issue.id, 'integrado', true)
  } catch (e) {
    log(`  ✗ integração falhou: ${e.message} — revertendo status para 'aprovado'.`)
    try { git(['merge', '--abort']) } catch { /* ok */ }
    await setStatus(issue.id, 'aprovado')
  }
  return true
}

// ── limpeza de rejeitados (best-effort) ───────────────────────────────────────
async function passoRejeicao() {
  const r = await q(`SELECT id, solucao FROM feedback_issues WHERE status = 'rejeitado' AND solucao->>'branch' IS NOT NULL AND solucao->>'branch' <> '' LIMIT 5`)
  let fez = false
  for (const row of r.rows) {
    const branch = row.solucao?.branch
    if (!branch) continue
    try { git(['worktree', 'prune']); git(['branch', '-D', branch]); fez = true; log(`branch de rejeitado removida: ${branch}`) } catch { /* já removida */ }
  }
  return fez
}

// ── loop ──────────────────────────────────────────────────────────────────────
async function ciclo() {
  // Faz UM passo por vez, priorizando integração > resolução > triagem.
  return (await passoIntegracao()) || (await passoResolucao()) || (await passoTriagem()) || (await passoRejeicao())
}

log(`iniciando — modo=${MODE} · poll=${POLL_MS}ms · autodeploy=${AUTODEPLOY ? 'on' : 'off'} · repo=${REPO}`)
if (MODE === 'real') {
  try { const v = execFileSync(CLAUDE_CMD, ['--version'], { encoding: 'utf8' }).trim(); log(`Claude Code: ${v}`) }
  catch { log(`⚠ '${CLAUDE_CMD} --version' falhou — verifique se o Claude Code está instalado e logado (modo real).`) }
}

if (ONCE) {
  let fez = true, n = 0
  while (fez && n < 50) { fez = await ciclo(); if (fez) n++ }
  log(`--once: ${n} passo(s) processado(s).`)
  await db.end()
  process.exit(0)
} else {
  // Loop contínuo. Ctrl+C para sair.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try { await ciclo() } catch (e) { log('erro no ciclo:', e.message) }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}
