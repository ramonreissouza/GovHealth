// src/lib/site.ts — URL canônica do site (OG, e-mails, retorno do Stripe).
//
// O site oficial é a VPS (govhealth.techealth.com.br), desde 02/10/2026. A Vercel
// só redireciona para cá (vercel.json).
//
// Por que não usar NEXT_PUBLIC_APP_URL direto: ela entra no BUILD, e na Vercel já
// apontou para um alias que respondia 404 (govhealth.vercel.app), o que quebrava
// imagem de OG, logo de e-mail e o success_url do Stripe. SITE_URL é lida em
// runtime e vence tudo; sem ela, produção cai no domínio oficial.

export const SITE_OFICIAL = 'https://govhealth.techealth.com.br'

export function siteUrl(): string {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '')
  // Desenvolvimento: checkout e e-mail apontam para a máquina local. Antes a
  // conta era "fora da Vercel = local", o que mandava a VPS para localhost.
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:3000'
  return SITE_OFICIAL
}
