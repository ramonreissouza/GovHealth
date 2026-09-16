# deploy/radar/Dockerfile — imagem do browser-service do Radar.
#
# Contexto de build = RAIZ do repositório (o serviço vive em scripts/radar):
#     docker build -f deploy/radar/Dockerfile -t govhealth/radar-browser-service:1 .
#
# ── POR QUE NÃO TEM CHROMIUM AQUI ────────────────────────────────────────────
# A tentação é partir de `mcr.microsoft.com/playwright` (~2GB) porque o serviço
# importa Playwright. Mas ele NUNCA abre um navegador: as duas únicas chamadas são
# `chromium.connectOverCDP(...)` — ele se conecta ao Chromium que já roda DENTRO do
# container do steel. Um segundo Chromium aqui não seria só peso morto: numa
# instância de 6GB ele disputaria a memória com o navegador que de fato importa, e
# em falta de memória o kernel mata o maior RSS. Por isso `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`.
#
# Resultado: imagem na casa de ~200MB em vez de ~2GB.

FROM node:24-alpine AS deps

WORKDIR /app

# Só o manifesto primeiro: a camada de dependências fica em cache enquanto as versões
# não mudarem, e trocar uma linha do serviço não reinstala nada.
COPY deploy/radar/package.json ./package.json

# 1 = não baixar navegador (ver acima).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force


FROM node:24-alpine AS runtime

# tini: o Node como PID 1 não repassa SIGTERM direito, e sem isso o `docker compose
# down` vira SIGKILL após o tempo de espera — no meio de uma captura de sessão, isso
# deixa a credencial travada em 'conectando' e a pista ocupada até o serviço voltar.
# curl: é o que o HEALTHCHECK usa.
RUN apk add --no-cache tini curl

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY deploy/radar/package.json ./package.json

# Os CINCO arquivos que o serviço realmente usa — conferido pelo grafo de imports:
# browser-service → steel, capture, pista-navegador, portais; capture → portais.
# Copiar `scripts/` inteiro traria o worker e o ETL, que não têm nada a fazer aqui.
COPY scripts/radar/browser-service.mjs   ./scripts/radar/
COPY scripts/radar/steel.mjs             ./scripts/radar/
COPY scripts/radar/capture.mjs           ./scripts/radar/
COPY scripts/radar/pista-navegador.mjs   ./scripts/radar/
COPY scripts/radar/portais.mjs           ./scripts/radar/

ENV NODE_ENV=production \
    RADAR_CONNECT_PORT=3200

# Usuário sem privilégio. A imagem `node` já traz o uid 1000 pronto; o serviço não
# escreve em disco (o estado vive no Postgres e na memória), então não precisa de nada
# gravável.
USER node

EXPOSE 3200

# O serviço não tem rota de saúde própria e recusa GET com 405 — que é, ele mesmo, a
# prova de que o processo está de pé e respondendo HTTP. 405 é sucesso aqui.
#
# SEM `-f`: essa opção faz o curl sair com erro em qualquer status >= 400, ou seja,
# transformaria justamente a resposta saudável em "unhealthy" — e o compose ficaria
# reiniciando um serviço que está perfeito.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3200/ | grep -q '^40[15]$'

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "scripts/radar/browser-service.mjs"]
