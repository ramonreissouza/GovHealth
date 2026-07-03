// src/lib/site.ts — URL canônica do site (OG, e-mails, retorno do Stripe).
//
// Por que não usar NEXT_PUBLIC_APP_URL: o ambiente de produção tem essa variável
// apontando para um alias que responde 404 (govhealth.vercel.app). Para não
// quebrar imagens de OG / logo de e-mail / success_url do Stripe, usamos o
// domínio canônico que funciona, com override LIMPO via SITE_URL (ex.: quando
// houver domínio próprio, basta definir SITE_URL nas envs).

const CANONICO = 'https://gov-health.vercel.app'

export function siteUrl(): string {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '')
  // Local (fora da Vercel): usa localhost para checkout/e-mail em dev.
  if (!process.env.VERCEL && !process.env.VERCEL_URL) return 'http://localhost:3000'
  return CANONICO
}
