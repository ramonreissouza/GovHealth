/** @type {import('next').NextConfig} */

// Content-Security-Policy (item 12 do checklist de segurança).
// Baseline pragmatico: bloqueia object/base/frame-ancestors e restringe conexoes,
// permitindo o que a app realmente usa — Next (styles/scripts inline na hidratacao),
// Tailwind (styles inline), imagens https (avatars/PNCP/Portal) e o mapa MapLibre
// + tiles OpenFreeMap (fetch de estilo/glyphs/tiles via connect-src; workers via blob).
//
// script-src: 'unsafe-inline' é EXIGIDO pelas paginas estaticas do App Router (scripts
// inline `self.__next_f` de hidratacao, sem nonce em build estatico). Ja 'unsafe-eval'
// foi REMOVIDO (endurecimento: elimina a primitiva string→codigo, principal alavanca de
// XSS); 'wasm-unsafe-eval' cobre o WASM do MapLibre sem reabrir eval de JS. Protecao XSS
// de inline permanece limitada — nonce pleno exigiria renderizacao dinamica app-wide
// (custo de perf); tratado como follow-up.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self' https://tiles.openfreemap.org",
  "upgrade-insecure-requests",
].join('; ')

const nextConfig = {
  serverExternalPackages: ['maplibre-gl'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'api.portaldatransparencia.gov.br' },
      { protocol: 'https', hostname: 'pncp.gov.br' },
    ],
  },
  // Não expõe o header "X-Powered-By: Next.js" (reduz fingerprinting).
  poweredByHeader: false,
  async headers() {
    // Headers de segurança aplicados a todas as respostas (production-grade).
    const securityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-DNS-Prefetch-Control', value: 'on' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
      // HSTS — força HTTPS. Só tem efeito sob HTTPS (ignorado em http://localhost).
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      { key: 'Content-Security-Policy', value: csp },
    ]
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        // CORS restrito à própria origem da app (antes era "*", permissivo demais).
        // As rotas já são protegidas por auth (middleware); isto reforça a fronteira.
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
          { key: 'Vary', value: 'Origin' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
