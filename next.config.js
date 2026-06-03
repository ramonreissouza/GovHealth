/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['mapbox-gl'],
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
