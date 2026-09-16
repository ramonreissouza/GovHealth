# deploy/app/Dockerfile — a aplicação Next.js na VPS.
#
# Construa a partir da RAIZ do repositório, apontando o -f para cá:
#
#   docker build -f deploy/app/Dockerfile -t govhealth-app .
#
# O contexto é a raiz porque o build precisa de src/, public/, db/ e scripts/.
# Repare que existe um `Dockerfile.dockerignore` ao lado deste arquivo: o
# `.dockerignore` da raiz foi escrito para a imagem do NAVEGADOR do Radar e exclui
# `src`, `public`, `db` e `scripts/*.mjs` — com ele valendo, este build falha com
# "src not found". O BuildKit procura `<caminho-do-Dockerfile>.dockerignore` antes
# do da raiz, e é assim que as duas imagens convivem no mesmo repositório.
#
# ENV DE BUILD × ENV DE RUNTIME — a pegadinha que custa um deploy:
# tudo que é `NEXT_PUBLIC_*` e a `RADAR_EMBED_ORIGIN` são lidos em tempo de BUILD e
# ficam gravados no bundle. Mudá-los depois, no compose, NÃO tem efeito: é preciso
# reconstruir a imagem. Por isso eles entram como ARG aqui e como `args:` no compose.
# O `DATABASE_URL` é o contrário — só runtime, e nunca deve entrar na imagem.

# ── 1. dependências ──────────────────────────────────────────────────────────
FROM node:24-alpine AS deps
# libc6-compat: o Next usa binários nativos (SWC) compilados contra glibc.
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
# `npm ci` respeita o lock. Sem lock, cai para install — e avisa, em vez de
# construir silenciosamente com versões diferentes das testadas.
RUN if [ -f package-lock.json ]; then npm ci; else echo ">> sem package-lock.json: usando npm install"; npm install; fi

# ── 2. build ─────────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_CONTATO_EMAIL
ARG NEXT_PUBLIC_IA_HABILITADA
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG RADAR_EMBED_ORIGIN
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_CONTATO_EMAIL=$NEXT_PUBLIC_CONTATO_EMAIL \
    NEXT_PUBLIC_IA_HABILITADA=$NEXT_PUBLIC_IA_HABILITADA \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY \
    RADAR_EMBED_ORIGIN=$RADAR_EMBED_ORIGIN \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

RUN npm run build

# ── 3. runtime ───────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0

# Usuário sem privilégio. O root do container é root do host se a imagem escapar;
# não há motivo para o servidor web ser root.
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

# O `standalone` já traz o server.js e as dependências que o runtime usa. `static`
# e `public` ficam FORA dele por design do Next e precisam ser copiados à mão — sem
# isso a página sobe sem CSS nenhum e o erro não aparece em log algum.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# O healthcheck bate numa rota PÚBLICA. `/` redireciona para o login conforme a
# sessão, e o middleware responde 200 ou 3xx — os dois contam como vivo aqui; o que
# não pode é 5xx ou recusa de conexão.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/inicio').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
