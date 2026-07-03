// scripts/stripe-setup.mjs — cria os Produtos + Preços recorrentes no Stripe a
// partir de src/lib/planos.ts e imprime os STRIPE_PRICE_* para colar no ambiente.
// Opcional: sem isso, o checkout cria o preço inline. Use para catálogo limpo/relatórios.
//
// Uso: STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs

import fs from 'node:fs'
import Stripe from 'stripe'

function loadEnv() {
  if (process.env.STRIPE_SECRET_KEY) return
  try {
    const env = fs.readFileSync('.env.local', 'utf8')
    const m = env.match(/^STRIPE_SECRET_KEY=(.*)$/m)
    if (m) process.env.STRIPE_SECRET_KEY = m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* sem .env.local */ }
}
loadEnv()
if (!process.env.STRIPE_SECRET_KEY) { console.error('ERRO: STRIPE_SECRET_KEY não configurada.'); process.exit(1) }

// Planos (espelho de src/lib/planos.ts — mantido simples para o script .mjs).
const PLANOS = [
  { id: 'essencial', nome: 'Essencial', preco: 490 },
  { id: 'pro', nome: 'Pro', preco: 990 },
]

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const linhas = []
try {
  for (const p of PLANOS) {
    // idempotência leve: procura produto por metadata plano_id
    const existentes = await stripe.products.search({ query: `metadata['plano_id']:'${p.id}'` }).catch(() => ({ data: [] }))
    let produto = existentes.data?.[0]
    if (!produto) {
      produto = await stripe.products.create({ name: `GovHealth.ai — Plano ${p.nome}`, metadata: { plano_id: p.id } })
      console.log(`✓ produto criado: ${produto.id} (${p.nome})`)
    } else {
      console.log(`· produto já existia: ${produto.id} (${p.nome})`)
    }
    const preco = await stripe.prices.create({
      product: produto.id,
      currency: 'brl',
      unit_amount: Math.round(p.preco * 100),
      recurring: { interval: 'month' },
      metadata: { plano_id: p.id },
    })
    console.log(`✓ preço criado: ${preco.id}  (R$ ${p.preco}/mês)`)
    linhas.push(`STRIPE_PRICE_${p.id.toUpperCase()}=${preco.id}`)
  }
  console.log('\n— Cole no seu ambiente (Vercel / .env.local): —')
  console.log(linhas.join('\n'))
} catch (e) {
  console.error('Falha no setup:', e.message)
  process.exitCode = 1
}
