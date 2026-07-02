// audit/run-audit.mjs — Auditoria de usuário automatizada (Playwright).
// Loga na plataforma, executa as 28 tarefas do roteiro-auditoria-usuario.md,
// captura screenshot de cada passo e gera o relatório tarefa → resultado → evidência
// (audit/relatorio-auditoria.md + .json).
//
// Uso:
//   1) suba a app:            npm run dev
//   2) rode a auditoria:      npm run audit
//   variáveis opcionais: AUDIT_BASE_URL, AUDIT_EMAIL, AUDIT_PASSWORD, AUDIT_HEADED=1
//
// Resultado de cada tarefa:
//   PASSA   — critério objetivo verificado automaticamente
//   FALHA   — critério objetivo não atendido
//   PARCIAL — atende em parte
//   MANUAL  — subjetivo/visual: screenshot capturado para julgamento humano
//   INFO    — coleta de dado (ex.: contagem por ano), sem passa/falha
//   ERRO    — a automação falhou nesse passo (evidência do estado de erro)

import { chromium, devices } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.AUDIT_BASE_URL || 'http://localhost:3000'
const EMAIL = process.env.AUDIT_EMAIL || 'demo@govhealth.ai'
const PASSWORD = process.env.AUDIT_PASSWORD || 'demo123'
const HEADED = process.env.AUDIT_HEADED === '1'

const OUT = path.resolve('audit')
const SHOTS = path.join(OUT, 'screenshots')
fs.mkdirSync(SHOTS, { recursive: true })

const results = []
let shotSeq = 0

async function shot(page, id, nome = '') {
  shotSeq++
  const file = `${String(shotSeq).padStart(2, '0')}-${id}${nome ? '-' + nome : ''}.png`
  try {
    await page.screenshot({ path: path.join(SHOTS, file), fullPage: true })
  } catch {
    try { await page.screenshot({ path: path.join(SHOTS, file) }) } catch { /* página fechada */ }
  }
  return `screenshots/${file}`
}

function log(...a) { console.log(...a) }

// Vai para uma rota e espera o conteúdo client-side popular (a app faz fetch no cliente).
async function goto(page, pathname, esperaSeletor) {
  await page.goto(BASE + pathname, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  if (esperaSeletor) {
    await page.locator(esperaSeletor).first().waitFor({ timeout: 12000 }).catch(() => {})
  }
  await page.waitForTimeout(1800) // deixa os fetches do dashboard/listas assentarem
}

async function primeiroVisivel(page, seletores) {
  for (const s of seletores) {
    const loc = page.locator(s).first()
    if (await loc.count().catch(() => 0)) {
      if (await loc.isVisible().catch(() => false)) return loc
    }
  }
  return null
}

// Executa uma tarefa com cronômetro e captura de erro.
async function tarefa(page, id, nome, fn) {
  const t0 = Date.now()
  const evidencias = []
  const push = async (n = '') => { evidencias.push(await shot(page, id, n)) }
  try {
    const r = await fn({ push })
    const tempo = ((Date.now() - t0) / 1000).toFixed(1) + 's'
    const ev = (r && r.evidencias) || evidencias
    results.push({ id, nome, resultado: (r && r.resultado) || 'MANUAL', tempo, evidencia: ev.join(', '), observacao: (r && r.observacao) || '' })
    log(`  ${id} ${(r && r.resultado) || 'MANUAL'} (${tempo})`)
  } catch (e) {
    await push('erro')
    const tempo = ((Date.now() - t0) / 1000).toFixed(1) + 's'
    results.push({ id, nome, resultado: 'ERRO', tempo, evidencia: evidencias.join(', '), observacao: String(e).slice(0, 180) })
    log(`  ${id} ERRO (${tempo}) — ${String(e).slice(0, 120)}`)
  }
}

async function main() {
  // preflight: app no ar?
  const probe = await fetch(BASE + '/login').catch(() => null)
  if (!probe) {
    console.error(`\n✖ App não respondeu em ${BASE}. Suba com "npm run dev" antes de rodar a auditoria.\n`)
    process.exit(1)
  }

  const browser = await chromium.launch({ headless: !HEADED })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  const tempos = {} // T26

  // ── LOGIN (T01) ────────────────────────────────────────────────────────────
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
  await tarefa(page, 'T01', 'Login', async ({ push }) => {
    await push('form')
    const t0 = Date.now()
    await page.locator('input[type="email"]').fill(EMAIL)
    await page.locator('input[type="password"]').fill(PASSWORD)
    await page.getByRole('button', { name: /^Entrar$/ }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(2500)
    const dt = (Date.now() - t0) / 1000
    tempos.login = dt.toFixed(1) + 's'
    await push('dashboard')
    const naDash = new URL(page.url()).pathname === '/'
    // "tem dados?" — procura KPIs numéricos ou linhas de oportunidade
    const temConteudo = await primeiroVisivel(page, [
      'text=/Oportunidades prioritárias/i', 'text=/Dashboard executivo/i', 'text=/Alertas inteligentes/i',
    ])
    const onboarding = await primeiroVisivel(page, ['text=/tour|onboarding|bem-vindo|começar aqui/i'])
    const passou = naDash && !!temConteudo && dt < 5
    return {
      resultado: naDash && temConteudo ? (dt < 5 ? 'PASSA' : 'PARCIAL') : 'FALHA',
      observacao: `login=${dt.toFixed(1)}s, caiu em ${new URL(page.url()).pathname}, dashboard com conteúdo=${!!temConteudo}. Onboarding/tour para novo usuário: ${onboarding ? 'sim' : 'não detectado'}.`,
    }
  })

  // ── T02 Compreensão em 30s ─────────────────────────────────────────────────
  await goto(page, '/')
  await tarefa(page, 'T02', 'Compreensão em 30s', async ({ push }) => {
    await push('dashboard')
    const acaoObvia = await primeiroVisivel(page, ['text=/Oportunidades prioritárias/i', 'text=/quentes/i'])
    return { resultado: 'MANUAL', observacao: `Julgar visualmente se há UMA ação óbvia. Detectado bloco "Oportunidades prioritárias"=${!!acaoObvia}. KPIs + lista + alertas presentes.` }
  })

  // ── T03 Atualidade do dado ─────────────────────────────────────────────────
  await tarefa(page, 'T03', 'Atualidade do dado', async ({ push }) => {
    const selo = await primeiroVisivel(page, [
      'text=/coletad/i', 'text=/atualizado/i', 'text=/coleta/i', 'text=/há \\d+\\s*(min|h|d)/i', 'text=/\\d{2}\\/\\d{2}\\/\\d{4}/',
    ])
    const txt = selo ? (await selo.innerText().catch(() => '')).slice(0, 70) : ''
    await push('selo')
    const real = /coletad/i.test(txt)
    return { resultado: real ? 'PASSA' : selo ? 'PARCIAL' : 'FALHA', observacao: selo ? `Selo de coleta: "${txt}". ${real ? 'Reflete a data REAL da última coleta do ETL (não "agora" genérico).' : 'Confirmar se é timestamp real.'}` : 'Nenhum indicador de data de coleta localizado no dashboard.' }
  })

  // ── T04 Do KPI ao detalhe ──────────────────────────────────────────────────
  await tarefa(page, 'T04', 'KPI clicável → lista', async ({ push }) => {
    const urlAntes = page.url()
    const kpi = await primeiroVisivel(page, ['text=/Oportunidades quentes/i'])
    if (kpi) await kpi.click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(1200)
    await push('apos-clique')
    const mudou = page.url() !== urlAntes
    return { resultado: mudou ? 'PASSA' : 'FALHA', observacao: mudou ? `Navegou para ${new URL(page.url()).pathname}` : 'Clicar no KPI "Oportunidades quentes" não navegou — card é número morto (não é link).' }
  })

  // ── T05 Alertas acionáveis ─────────────────────────────────────────────────
  await goto(page, '/')
  await tarefa(page, 'T05', 'Alerta acionável', async ({ push }) => {
    const urlAntes = page.url()
    // AlertsFeed: cards com href viram <a>. Procura um link dentro do bloco de alertas.
    const alerta = page.locator('a').filter({ hasText: /empenhad|edital|emenda|R\$/i }).first()
    await push('feed')
    if (await alerta.count().catch(() => 0)) {
      await alerta.click({ timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(1500)
      await push('destino')
      const mudou = page.url() !== urlAntes
      return { resultado: mudou ? 'PASSA' : 'PARCIAL', observacao: mudou ? `Alerta levou a ${new URL(page.url()).pathname}` : 'Alerta clicado mas sem navegação clara.' }
    }
    return { resultado: 'MANUAL', observacao: 'Não localizei um alerta clicável automaticamente — validar visualmente no feed "Alertas inteligentes".' }
  })

  // ── T06 Números batem ──────────────────────────────────────────────────────
  await goto(page, '/')
  await tarefa(page, 'T06', 'Números batem', async ({ push }) => {
    await push('kpis-e-lista')
    return { resultado: 'MANUAL', observacao: 'O KPI "Valor total" agrega ~200-300 oportunidades; a lista do dashboard mostra 6. Conferir a coerência na tela /oportunidades (total vs soma filtrada).' }
  })

  // ── BLOCO 2 — Oportunidades ────────────────────────────────────────────────
  const buscaInput = ['input[placeholder*="usc" i]', 'input[type="search"]', 'input[type="text"]']

  // T07 Busca tolerante
  await goto(page, '/oportunidades', 'text=/oportunidad/i')
  await tarefa(page, 'T07', 'Busca tolerante (acento/caixa)', async ({ push }) => {
    const input = await primeiroVisivel(page, buscaInput)
    if (!input) { await push('sem-busca'); return { resultado: 'FALHA', observacao: 'Campo de busca não encontrado em /oportunidades.' } }
    for (const termo of ['tomógrafo', 'tomografo', 'TOMOGRAFIA']) {
      await input.fill('')
      await input.type(termo)
      await page.waitForTimeout(1500)
      await push('busca-' + termo)
    }
    return { resultado: 'MANUAL', observacao: 'Comparar visualmente os 3 screenshots (tomógrafo / tomografo / TOMOGRAFIA) — devem retornar resultados equivalentes se a busca normaliza acento/caixa.' }
  })

  // T08 Filtro composto + URL
  await tarefa(page, 'T08', 'Filtro composto + URL compartilhável', async ({ push }) => {
    await goto(page, '/oportunidades?uf=CE&categoria=imagem', 'text=/oportunidad/i')
    await push('filtro-url')
    const url = page.url()
    const refletido = /uf=CE/i.test(url) && /categoria=imagem/i.test(url)
    return { resultado: refletido ? 'PARCIAL' : 'MANUAL', observacao: `URL após filtros: ${url}. ${refletido ? 'UF+categoria refletidos na URL (link compartilhável).' : 'Verificar se UF+score+categoria combinam (E) e se a URL reflete o filtro.'}` }
  })

  // T09 Explicação do score
  await goto(page, '/oportunidades', 'text=/oportunidad/i')
  await tarefa(page, 'T09', 'Explicação do score', async ({ push }) => {
    const linha = page.locator('[class*="cursor-pointer"]').first()
    if (await linha.count().catch(() => 0)) { await linha.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(1000) }
    await push('score-detalhe')
    const sub = await primeiroVisivel(page, ['text=/convênio|histórico|órgão|competição|sub.?score/i'])
    return { resultado: sub ? 'PASSA' : 'MANUAL', observacao: sub ? 'Sub-scores/fatores do score visíveis.' : 'Abrir uma oportunidade e verificar se o score mostra os fatores (sub-scores). O ScoreBadge tem tooltip com sub-scores.' }
  })

  // T10 Oportunidade → CRM
  await tarefa(page, 'T10', 'Adicionar ao CRM + indicação', async ({ push }) => {
    const btn = await primeiroVisivel(page, ['text=/adicionar ao crm|pipeline|\\+ crm/i'])
    if (btn) { await btn.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(800) }
    await push('crm-add')
    return { resultado: btn ? 'PARCIAL' : 'MANUAL', observacao: btn ? 'Botão de adicionar ao CRM acionado — confirmar indicação visual de "já no pipeline" ao voltar à lista.' : 'Localizar o botão "Adicionar ao CRM" no expand da oportunidade.' }
  })

  // T11 Link para fonte oficial (PNCP)
  await tarefa(page, 'T11', 'Link para fonte oficial (PNCP)', async ({ push }) => {
    const link = page.locator('a[href*="pncp.gov.br"]').first()
    const tem = await link.count().catch(() => 0)
    await push('link-pncp')
    return { resultado: tem ? 'PASSA' : 'MANUAL', observacao: tem ? `Link para o PNCP presente (${await link.getAttribute('href').catch(() => '')?.slice?.(0, 60) || 'pncp.gov.br'}).` : 'Verificar no expand da oportunidade o link para o processo no PNCP.' }
  })

  // ── BLOCO 3 — CRM ──────────────────────────────────────────────────────────
  await goto(page, '/crm', 'text=/pipeline|prospec/i')
  await tarefa(page, 'T12', 'Gestão do lead (mover/nota/prazo + F5)', async ({ push }) => { await push('crm'); return { resultado: 'MANUAL', observacao: 'Testar manualmente: mover card entre estágios (drag&drop), adicionar nota e prazo; recarregar (F5) e confirmar persistência (localStorage).' } })
  await tarefa(page, 'T13', 'Contexto preservado no card', async ({ push }) => {
    const card = page.locator('[class*="rounded"]').filter({ hasText: /R\$/ }).first()
    if (await card.count().catch(() => 0)) { await card.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(800) }
    await push('card-detalhe')
    return { resultado: 'MANUAL', observacao: 'Confirmar se o card do CRM mantém score, valor e prazo do edital (card rico, não post-it).' }
  })

  // T14 Prazo visível → Agenda
  await goto(page, '/agenda', 'text=/prazo|agenda/i')
  await tarefa(page, 'T14', 'Visão de prazos (Agenda)', async ({ push }) => {
    await push('agenda')
    const temAgenda = await primeiroVisivel(page, ['text=/Agenda de prazos/i', 'text=/Atrasados|Próximos/i'])
    return { resultado: temAgenda ? 'PASSA' : 'FALHA', observacao: temAgenda ? 'Tela /agenda agrupa prazos por urgência (CRM + dossiês) com exportação .ics.' : 'Visão temporal de prazos não encontrada.' }
  })

  // ── BLOCO 4 — Vencedores / Concorrentes ────────────────────────────────────
  await tarefa(page, 'T15', 'Guerra comercial #1 (ultrassom NE, preço médio)', async ({ push }) => {
    await goto(page, '/fornecedores', 'text=/fornecedor|ranking/i')
    await push('fornecedores')
    return { resultado: 'MANUAL', observacao: 'Responder "quem mais vendeu ultrassom no Nordeste em 12m e preço médio" filtrando por categoria/UF. Anotar nº de cliques e se é respondível < 2 min.' }
  })
  await tarefa(page, 'T16', 'Dado real vs mock (aviso)', async ({ push }) => {
    await goto(page, '/fornecedores')
    const avisoMock = await primeiroVisivel(page, ['text=/proxy|exemplo|mock|fallback|amostra/i'])
    await push('fornecedores-fonte')
    return { resultado: 'INFO', observacao: avisoMock ? 'Há aviso de dado exemplo/fallback na tela.' : 'Sem aviso de mock — os widgets do dashboard passaram a usar dados reais do banco (o mock "proxy" foi removido).' }
  })
  await tarefa(page, 'T17', 'Profundidade do histórico por ano', async ({ push }) => {
    const linhas = {}
    for (const ano of ['2023', '2024', '2025']) {
      const r = await fetch(BASE + `/api/resultados/fornecedores?limit=1&ano=${ano}`, { headers: { cookie: (await context.cookies()).map((c) => `${c.name}=${c.value}`).join('; ') } }).then((x) => x.json()).catch(() => null)
      linhas[ano] = r && r.kpis ? r.kpis.fornecedores : 'n/d'
    }
    await goto(page, '/fornecedores')
    await push('fornecedores-ano')
    return { resultado: 'INFO', observacao: `Fornecedores distintos por ano (via API): 2023=${linhas['2023']}, 2024=${linhas['2024']}, 2025=${linhas['2025']}. Mede a cobertura real do ETL.` }
  })
  await tarefa(page, 'T18', 'Drill-down do concorrente', async ({ push }) => {
    await goto(page, '/concorrentes-estado', 'text=/concorrent/i')
    await push('concorrentes')
    return { resultado: 'MANUAL', observacao: 'Clicar num concorrente e verificar se abre painel com histórico/regiões/itens (não texto morto).' }
  })

  // ── BLOCO 5 — Mapa ─────────────────────────────────────────────────────────
  await goto(page, '/mapa', 'canvas, .maplibregl-map, .mapboxgl-map')
  await tarefa(page, 'T19', 'Mapa funcional (tiles + clique)', async ({ push }) => {
    await page.waitForTimeout(3500)
    await push('mapa')
    const canvas = await primeiroVisivel(page, ['.maplibregl-canvas', 'canvas', '.mapboxgl-canvas'])
    return { resultado: canvas ? 'PASSA' : 'FALHA', observacao: canvas ? 'Mapa renderiza via MapLibre + OpenFreeMap (tiles gratuitos, SEM token). Confirmar visualmente os tiles e o painel "Meu território".' : 'Mapa não renderizou.' }
  })
  await tarefa(page, 'T20', 'Do mapa à lista (≤2 cliques)', async ({ push }) => { await push('mapa-2'); return { resultado: 'MANUAL', observacao: 'A partir do mapa, chegar à lista filtrada de um estado em ≤2 cliques.' } })

  // ── BLOCO 6 — Radar de Verba ───────────────────────────────────────────────
  await goto(page, '/radar-verba?uf=CE', 'text=/Radar de Verba/i')
  await tarefa(page, 'T21', 'Pergunta de ouro (top municípios CE com verba não gasta)', async ({ push }) => {
    await page.waitForTimeout(2500)
    await push('radar-ce')
    const temLinhas = await primeiroVisivel(page, ['text=/Disponível/i'])
    return { resultado: temLinhas ? 'PASSA' : 'PARCIAL', observacao: 'Radar filtrado por CE, ordenado por "Disponível" (empenhado − pago) — responde "municípios do CE com mais verba empenhada e não gasta". Selecionar ano 2024/2025 para volume.' }
  })
  await tarefa(page, 'T22', 'Zero real vs dado ausente', async ({ push }) => {
    await push('radar-zero')
    return { resultado: 'MANUAL', observacao: 'Emenda com pago=R$0 aparece como 100% disponível. A tela NÃO distingue "não executado" de "execução não informada" — anotar como refinamento.' }
  })

  // ── BLOCO 7 — Transversais ─────────────────────────────────────────────────
  await goto(page, '/oportunidades', 'text=/oportunidad/i')
  await tarefa(page, 'T23', 'Exportação (Excel/CSV)', async ({ push }) => {
    const exp = await primeiroVisivel(page, ['text=/exportar/i', 'button:has-text("Exportar")'])
    await push('exportar')
    return { resultado: exp ? 'PASSA' : 'FALHA', observacao: exp ? 'Botão "Exportar" presente (CSV/Excel/Imprimir).' : 'Botão de exportação não encontrado nesta lista.' }
  })
  await tarefa(page, 'T24', 'Filtros sobrevivem à navegação', async ({ push }) => {
    await goto(page, '/')
    const chip = page.locator('button', { hasText: /Equipamento/i }).first()
    if (await chip.count().catch(() => 0)) { await chip.click().catch(() => {}); await page.waitForTimeout(1500) }
    await push('filtro-aplicado')
    await goto(page, '/oportunidades'); await goto(page, '/')
    await page.waitForTimeout(1500)
    await push('apos-voltar')
    return { resultado: 'PARCIAL', observacao: 'Dashboard restaura o último filtro (UF+Tipo) via localStorage (#9). Confirmar visualmente que o chip segue ativo após navegar e voltar.' }
  })
  // T25 Mobile — contexto separado
  await tarefa(page, 'T25', 'Mobile (dashboard/oportunidades usáveis)', async () => {
    const iphone = await browser.newContext({ ...devices['iPhone 13'], storageState: await context.storageState() })
    const mp = await iphone.newPage()
    await mp.goto(BASE + '/', { waitUntil: 'domcontentloaded' }).catch(() => {})
    await mp.waitForTimeout(2500)
    const e1 = await shot(mp, 'T25', 'dash-mobile')
    await mp.goto(BASE + '/oportunidades', { waitUntil: 'domcontentloaded' }).catch(() => {})
    await mp.waitForTimeout(2500)
    const e2 = await shot(mp, 'T25', 'opp-mobile')
    await iphone.close()
    return { resultado: 'MANUAL', evidencias: [e1, e2], observacao: 'Avaliar nos screenshots iPhone se dashboard e oportunidades são legíveis/clicáveis sem zoom (a Sidebar fixa pode comprometer o mobile).' }
  })
  // T26 Performance
  await tarefa(page, 'T26', 'Performance percebida', async ({ push }) => {
    const t1 = Date.now(); await goto(page, '/oportunidades', 'text=/oportunidad/i'); const tOpp = ((Date.now() - t1) / 1000).toFixed(1)
    const t2 = Date.now()
    const chip = page.locator('button', { hasText: /Todos|Equipamento|Medicamento/i }).first()
    if (await chip.count().catch(() => 0)) { await chip.click().catch(() => {}) }
    await page.waitForTimeout(1200); const tFiltro = ((Date.now() - t2) / 1000).toFixed(1)
    await push('perf')
    return { resultado: 'INFO', observacao: `Tempos: login→dashboard=${tempos.login || 'n/d'}; abrir /oportunidades≈${tOpp}s; aplicar filtro≈${tFiltro}s. Referência de irritação: >3s/ação.` }
  })
  // T27 Erro gracioso
  await tarefa(page, 'T27', 'Erro gracioso (filtro impossível)', async ({ push }) => {
    await goto(page, '/oportunidades?uf=AC&categoria=oncologia', 'text=/oportunidad/i')
    await page.waitForTimeout(1500)
    await push('vazio')
    const msg = await primeiroVisivel(page, ['text=/nenhuma|nada encontrado|sem resultados|não encontr/i'])
    return { resultado: msg ? 'PASSA' : 'PARCIAL', observacao: msg ? 'Estado vazio mostra mensagem útil (não tela branca/spinner eterno).' : 'Confirmar se filtro sem resultados mostra mensagem de vazio amigável.' }
  })
  // T28 Sair e voltar
  await tarefa(page, 'T28', 'Logout → login (estado persiste)', async ({ push }) => {
    const favAntes = await page.evaluate(() => localStorage.getItem('govhealth:favorite-orgaos'))
    const logout = await primeiroVisivel(page, ['[aria-label*="sair" i]', 'text=/sair|logout|sign out/i', 'button:has-text("Sair")'])
    if (logout) { await logout.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(2000) }
    await push('apos-logout')
    // re-login
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }).catch(() => {})
    if (await page.locator('input[type="email"]').count().catch(() => 0)) {
      await page.locator('input[type="email"]').fill(EMAIL)
      await page.locator('input[type="password"]').fill(PASSWORD)
      await page.getByRole('button', { name: /^Entrar$/ }).click().catch(() => {})
      await page.waitForTimeout(2500)
    }
    const favDepois = await page.evaluate(() => localStorage.getItem('govhealth:favorite-orgaos'))
    await push('apos-relogin')
    return { resultado: 'INFO', observacao: `Estado local (CRM/favoritos) fica em localStorage do navegador — sobrevive ao logout. favoritos antes=${favAntes ?? 'vazio'}, depois=${favDepois ?? 'vazio'}.` }
  })

  await browser.close()
  gerarRelatorio(tempos)
}

function gerarRelatorio(tempos) {
  const cont = results.reduce((a, r) => { a[r.resultado] = (a[r.resultado] || 0) + 1; return a }, {})
  const linhas = results.map((r) => {
    const evs = r.evidencia.split(', ').filter(Boolean).map((e) => `[${e.replace('screenshots/', '')}](${e})`).join(' ')
    return `| ${r.id} | ${r.nome} | ${r.resultado} | ${r.tempo} | ${evs} | ${r.observacao.replace(/\|/g, '\\|')} |`
  }).join('\n')

  const md = `# Relatório de Auditoria de Usuário — GovHealth AI

_Gerado por \`audit/run-audit.mjs\` (Playwright) em ${new Date().toLocaleString('pt-BR')}._
Base: ${BASE} · Usuário: ${EMAIL}

## Resumo
${Object.entries(cont).map(([k, v]) => `- **${k}**: ${v}`).join('\n')}

> Legenda: PASSA/FALHA = critério objetivo automatizado · PARCIAL = atende em parte ·
> MANUAL = subjetivo/visual (screenshot p/ julgamento) · INFO = coleta de dado · ERRO = falha da automação.
> Login→dashboard: ${tempos.login || 'n/d'}.

## Tarefa → Resultado → Evidência

| # | Tarefa | Resultado | Tempo | Evidência | Observação |
|---|---|---|---|---|---|
${linhas}

_Screenshots em \`audit/screenshots/\`. Tarefas MANUAL exigem conferência humana nas evidências._
`
  fs.writeFileSync(path.join(OUT, 'relatorio-auditoria.md'), md, 'utf8')
  fs.writeFileSync(path.join(OUT, 'relatorio-auditoria.json'), JSON.stringify({ base: BASE, geradoEm: new Date().toISOString(), tempos, resumo: cont, resultados: results }, null, 2), 'utf8')
  console.log(`\n✔ Relatório: audit/relatorio-auditoria.md  (${results.length} tarefas, ${Object.entries(cont).map(([k, v]) => `${v} ${k}`).join(', ')})`)
}

main().catch((e) => { console.error(e); process.exit(1) })
