# GovHealth AI — Plataforma de Sales Intelligence para Saúde Pública

Plataforma SaaS de inteligência comercial para fornecedores de equipamentos e serviços à saúde pública brasileira. Integra dados reais do PNCP, TransfereGov e Portal da Transparência com IA preditiva para identificar oportunidades de licitação antes da publicação do edital.

---

## Stack

- **Frontend**: Next.js 14 (App Router) · React 18 · TypeScript · Tailwind CSS
- **APIs Governamentais**: PNCP (público) · Portal da Transparência (chave gratuita)
- **IA**: OpenAI GPT-4o-mini (streaming) · Copiloto em linguagem natural
- **Deploy**: Vercel (região `gru1` — São Paulo)

---

## Setup local em 5 minutos

### 1. Clone e instale

```bash
git clone https://github.com/seu-usuario/govhealth-ai.git
cd govhealth-ai
npm install
```

### 2. Configure as variáveis de ambiente

```bash
cp .env.local.example .env.local
```

Edite `.env.local` com suas chaves:

| Variável | Como obter | Obrigatória? |
|---|---|---|
| `PORTAL_TRANSPARENCIA_API_KEY` | [portaldatransparencia.gov.br/api-de-dados](https://portaldatransparencia.gov.br/api-de-dados) — cadastro gratuito | Sim (TransfereGov) |
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | Sim (Copiloto IA) |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | [account.mapbox.com](https://account.mapbox.com/access-tokens) — tier gratuito | Não (Mapa) |
| `PNCP_BASE_URL` | Pré-configurado | Não |

> A API do PNCP é **pública e sem autenticação** — funciona imediatamente.

### 3. Rode localmente

```bash
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000)

---

## Deploy na Vercel

### Opção A — Vercel CLI (mais rápido)

```bash
npm i -g vercel
vercel login
vercel --prod
```

Durante o deploy, a CLI vai pedir para configurar as variáveis de ambiente.

### Opção B — GitHub + Vercel Dashboard

1. Faça push do repositório para o GitHub
2. Acesse [vercel.com/new](https://vercel.com/new)
3. Importe o repositório
4. Configure as variáveis de ambiente no painel da Vercel
5. Clique em **Deploy**

### Variáveis obrigatórias na Vercel

No dashboard da Vercel, vá em **Settings → Environment Variables** e adicione:

```
PORTAL_TRANSPARENCIA_API_KEY = sua_chave
OPENAI_API_KEY               = sk-...
NEXT_PUBLIC_MAPBOX_TOKEN     = pk.eyJ1...    (opcional)
NEXTAUTH_SECRET              = string_aleatoria_forte
CRON_SECRET                  = string_aleatoria_para_crons
```

> Para gerar secrets: `openssl rand -base64 32`

---

## Arquitetura das APIs

### PNCP (Portal Nacional de Contratações Públicas)
- **Base**: `https://pncp.gov.br/api/consulta/v1`
- **Autenticação**: Nenhuma — API pública
- **Endpoints usados**:
  - `GET /contratacoes/publicacao` — editais publicados
  - `GET /contratacoes/proposta` — resultados/homologações

### TransfereGov (Portal da Transparência)
- **Base**: `https://api.portaldatransparencia.gov.br/api-de-dados`
- **Autenticação**: Header `chave-api-dados: {API_KEY}`
- **Endpoints usados**:
  - `GET /convenios` — convênios por situação, UF, município
  - `GET /emendas` — emendas parlamentares por função (10 = Saúde)
  - `GET /transferencias-voluntarias` — repasses diretos

### APIs internas (Next.js Route Handlers)

| Endpoint | Descrição | Cache |
|---|---|---|
| `GET /api/opportunities` | Oportunidades rankeadas com score | 30min |
| `GET /api/pncp/licitacoes` | Licitações do PNCP | 15min |
| `GET /api/transferegov/convenios` | Convênios do TransfereGov | 1h |
| `GET /api/alerts` | Feed de alertas inteligentes | 10min |
| `POST /api/copiloto` | Chat IA com streaming (SSE) | — |
| `GET /api/cron/sync-pncp` | Sincronização agendada (Vercel Cron) | — |

---

## Opportunity Score Engine

O score (0-100) é calculado por 4 grupos de variáveis:

| Grupo | Peso | Variáveis-chave |
|---|---|---|
| Convênio | 30% | % executado, valor total, dias até vencimento, verba liberada |
| Histórico | 28% | Idade do equipamento, última compra, ciclo médio da categoria |
| Órgão | 22% | Emenda parlamentar, leitos CNES, tipo de gestão |
| Competição | 20% | Share do líder regional, nº concorrentes, resultado último pregão |

**Score ≥ 75**: Oportunidade quente — acionar equipe comercial
**Score 50-74**: Morno — monitorar ativamente
**Score < 50**: Frio — aguardar maturação

---

## Crons (sincronização automática)

Configurados no `vercel.json`:

- **`/api/cron/sync-pncp`** — a cada 4 horas: novas licitações de saúde
- **`/api/cron/sync-transferegov`** — diariamente às 6h: convênios ativos

Protegidos por `CRON_SECRET` via header `Authorization: Bearer {secret}`.

---

## Estrutura do projeto

```
src/
├── app/
│   ├── page.tsx                    # Dashboard
│   ├── oportunidades/page.tsx      # Lista de oportunidades
│   ├── mapa/page.tsx               # Mapa interativo
│   ├── copiloto/page.tsx           # Chat IA
│   ├── concorrentes/page.tsx       # Radar competitivo
│   ├── timeline/page.tsx           # Timeline convênio→contrato
│   └── api/
│       ├── opportunities/          # Score engine
│       ├── pncp/licitacoes/        # PNCP proxy
│       ├── transferegov/convenios/ # TransfereGov proxy
│       ├── alerts/                 # Feed de alertas
│       ├── copiloto/               # IA streaming
│       └── cron/                   # Sincronização agendada
├── components/
│   ├── layout/     # Sidebar, Topbar
│   ├── dashboard/  # KPICards, OpportunityList, AlertsFeed
│   ├── copiloto/   # ChatInterface
│   └── ui/         # ScoreBadge, Tag
└── lib/
    ├── types.ts         # TypeScript types
    ├── pncp.ts          # PNCP API client
    ├── transferegov.ts  # TransfereGov API client
    └── score-engine.ts  # Opportunity Score Engine (ML)
```

---

## Próximos passos (Roadmap V2)

- [ ] **Mapbox GL** — mapa interativo de oportunidades geolocalizadas
- [ ] **ClickHouse** — analytics de séries históricas de preços
- [ ] **XGBoost** — substituir regras por modelo ML treinado com dados reais
- [ ] **CRM integrado** — pipeline comercial vinculado às oportunidades
- [ ] **Portais estaduais** — crawlers para SP, RJ, MG, BA
- [ ] **App mobile** — alertas push para equipe comercial
- [ ] **Auth** — NextAuth com Google / email (multitenancy)

---

## Licença

Proprietária — uso interno. Dados governamentais são públicos (acesso via API oficial).
