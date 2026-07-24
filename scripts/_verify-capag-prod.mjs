const BASE = 'https://gov-health.vercel.app', EMAIL = 'teste@govhealth.ai', PASS = 'Teste@2026'
const jar = new Map()
const setC = (r) => { const raw = r.headers.getSetCookie ? r.headers.getSetCookie() : []; for (const c of raw) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i).trim(), kv.slice(i + 1)) } }
const ch = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
async function login() {
  const c = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: ch() } }); setC(c); const { csrfToken } = await c.json()
  const body = new URLSearchParams({ csrfToken, email: EMAIL, password: PASS, callbackUrl: BASE, json: 'true' })
  const r = await fetch(`${BASE}/api/auth/callback/credentials`, { method: 'POST', redirect: 'manual', headers: { cookie: ch(), 'content-type': 'application/x-www-form-urlencoded' }, body }); setC(r)
}
for (let i = 1; i <= 12; i++) {
  try {
    await login()
    const op = await (await fetch(`${BASE}/api/opportunities?uf=SP&limit=40`, { headers: { cookie: ch() }, redirect: 'manual' })).json()
    const arr = op.oportunidades || []
    const comCap = arr.filter((o) => o.capacidadePagamento && o.capacidadePagamento.fonte !== 'na').length
    const temCampo = arr.some((o) => 'capacidadePagamento' in o)
    console.log(`tentativa ${i}: total=${op.kpis?.total} campoCapacidade=${temCampo} c/nota=${comCap}`)
    if (comCap > 0) {
      console.log('✓ CAPAG ATIVO em produção. Ex.:', arr.filter((o) => o.capacidadePagamento?.nota).slice(0, 4).map((o) => `${o.municipio}/${o.uf}=${o.capacidadePagamento.label}(score ${o.score})`))
      process.exit(0)
    }
    console.log('  (deploy antigo ainda — aguardando 20s…)')
  } catch (e) { console.log(`tentativa ${i}: erro ${e.message}`) }
  await new Promise((r) => setTimeout(r, 20000))
}
console.log('✗ não confirmou em ~4min — checar deploy na Vercel.')
