# Radar — Navegador hospedado (conectar ao gov.br sem terminal)

Fluxo de conexão do fornecedor **dentro da tela**: clicar → o gov.br abre **embutido** (iframe/live view) → login na página oficial → "Já concluí o login" → sessão capturada (cifrada). Nenhuma senha passa pela GovHealth; a sessão fica na **sua infra** (steel-browser self-hosted).

## Peças
- **steel-browser** (Docker): navegador hospedado com live view. `docker-compose.radar.yml`.
- **browser-service** (`scripts/radar/browser-service.mjs`): serviço HTTP no host/VPS. Cria a sessão no steel, abre o gov.br, devolve a URL de embed e, no fim, extrai os cookies via CDP (Playwright `connectOverCDP`) e grava cifrado. Adaptador do steel isolado em `scripts/radar/steel.mjs`.
- **Proxy Next** `POST /api/radar/conexao` (`iniciar|capturar|cancelar`): a tela chama aqui (autenticada, isolada por titular); o Next repassa ao browser-service com o token interno. O token nunca vai ao cliente.
- **Modal** (`src/app/radar/page.tsx`): mostra o iframe do gov.br + botão "Já concluí o login". Se o hospedado não estiver configurado (503), cai no fluxo local (`connect-service.mjs` + fila).

## Subir (local)
```
docker compose -f docker-compose.radar.yml up -d      # steel em :3100 (UI /ui) e CDP :9223
# .env.local:
#   RADAR_STEEL_URL=http://localhost:3100
#   RADAR_STEEL_CDP=http://localhost:9223
#   RADAR_CONNECT_URL=http://localhost:3200
#   RADAR_CONNECT_TOKEN=<gere um aleatório>
npm run radar:browser-service                          # serviço em :3200
```
Depois, em `/radar` → "Conectar com gov.br" → o gov.br abre no iframe.

## Deploy (VPS/container)
1. steel-browser atrás de HTTPS/reverse-proxy; **restrinja o acesso à porta 9223 (CDP)** à rede interna (é controle total do navegador).
2. `browser-service` no mesmo host do steel (precisa de Playwright: `npx playwright install chromium`), exposto só ao app via `RADAR_CONNECT_URL` (idealmente rede privada) + `RADAR_CONNECT_TOKEN` forte.
3. No app (Vercel): definir `RADAR_CONNECT_URL` (URL pública/privada do browser-service) e `RADAR_CONNECT_TOKEN`.
4. `RADAR_STEEL_EMBED_TEMPLATE` se a URL de live view do steel diferir do padrão (ver `steel.mjs`).

## A confirmar no 1º container (isolado em `scripts/radar/steel.mjs`)
- Campo da **URL de embed/live view** no retorno de `POST /v1/sessions` (`sessionViewerUrl`/`debugUrl`/…); ajustar `embedUrlDe()` ou usar `RADAR_STEEL_EMBED_TEMPLATE`.
- **CDP** por sessão (`connectOverCDP`): usa `RADAR_STEEL_CDP` (http://host:9223) por padrão; se o steel expuser ws por sessão, ajustar `cdpUrlDe()`.
- Cabeçalhos anti-iframe: garantir que o steel permita ser embutido na origem do app (CSP/X-Frame-Options).
