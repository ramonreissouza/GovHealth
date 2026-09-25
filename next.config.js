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
const scriptSrc = process.env.NODE_ENV === 'production'
  ? "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'"

// frame-src: o Radar embute o live view do navegador hospedado (steel-browser) num
// iframe para o fornecedor fazer o login do gov.br DENTRO da tela. Sem esta diretiva a
// CSP cai em `default-src 'self'` e o iframe é bloqueado — silenciosamente, do ponto de
// vista de quem está olhando: a tela fica em branco e o console diz "Refused to frame".
// Era o terceiro furo do caminho hospedado, achado em 10/09/2026 antes de subir a infra.
//
// A origem entra por env porque muda por ambiente (local, VPS, produção) e porque
// deixá-la fixa no código convidaria a alargar a CSP "só para testar". Precisa ser
// HTTPS: o `upgrade-insecure-requests` logo abaixo reescreve http:// para https://, então
// um steel em http puro não carrega nem com a CSP aberta.
//
// ATENÇÃO: isto é lido em tempo de BUILD. Mudar a variável na Vercel exige REDEPLOY —
// não basta salvar a env e reiniciar.
const embedOrigem = (process.env.RADAR_EMBED_ORIGIN || '').trim()
// A consulta PÚBLICA do Compras.gov.br, aberta dentro do pregão no Radar (25/09/2026).
// O Radar não consegue ler esse chat (captcha que recusa navegador automatizado; ver
// src/lib/radar/chat-externo.mjs), então quem abre é o navegador da própria pessoa,
// num quadro da tela. Origem FIXA, e não por env como a do steel: é um endereço do
// governo que não muda por ambiente, e só esta origem entra — nunca `*.gov.br`.
const comprasgovPublico = 'https://cnetmobile.estaleiro.serpro.gov.br'
const frameSrc = ['frame-src', "'self'", comprasgovPublico, embedOrigem].filter(Boolean).join(' ')

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  frameSrc,
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  scriptSrc,
  "worker-src 'self' blob:",
  "connect-src 'self' https://tiles.openfreemap.org",
  "upgrade-insecure-requests",
].join('; ')

const nextConfig = {
  // `standalone` faz o build emitir `.next/standalone` com um server.js e SÓ as
  // dependências que o runtime usa. É o que permite a imagem Docker rodar sem
  // `node_modules` inteiro — aqui isso é a diferença entre ~1,4 GB e ~250 MB, e a
  // Vercel ignora a opção, então não muda nada no deploy atual.
  output: 'standalone',
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
