// src/app/manifest.ts — torna o GovHealth instalável (PWA), servido em
// /manifest.webmanifest. É o que permite o aviso por push no iPhone: a Apple só entrega
// push a site adicionado à Tela de Início (iOS 16.4+). No Android e no desktop, instalar
// é opcional.

import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'GovHealth AI',
    short_name: 'GovHealth',
    description: 'Inteligência comercial para vendas à saúde pública.',
    start_url: '/radar',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#2f80ed',
    lang: 'pt-BR',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
