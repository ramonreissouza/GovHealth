# PRD — Subpágina ADMIN (área do administrador master)
## Para execução pelo Claude Code

> **PASSO 0 — OBRIGATÓRIO ANTES DE QUALQUER CÓDIGO:**
> Quem escreveu este PRD não tem acesso ao estado atual do código. Verifique e
> reporte antes de implementar:
> 1. Qual banco de dados existe hoje no projeto (Supabase? Neon? outro? nenhum?)
>    — contas, assinaturas e logs EXIGEM persistência; se não houver banco,
>    provisionar primeiro (preferência: Postgres gerenciado com free tier).
> 2. Como o NextAuth está configurado (providers, onde ficam os usuários hoje,
>    existe tabela de usuários ou é hardcoded?).
> 3. Se já existe qualquer conceito de "role"/permissão no modelo de usuário.
>
> **Princípio de segurança:** esta é a página mais sensível da plataforma.
> Proteção deve ser SERVER-SIDE em toda rota e toda API — nunca apenas esconder
> o link no menu.

---

## 1. AUTENTICAÇÃO E CONTROLE DE ACESSO

### 1.1 Modelo de permissão
- Adicionar campo `role` ao usuário: `'master' | 'user'` (extensível depois).
- O acesso a `/admin/**` e `/api/admin/**` exige `role = 'master'`, verificado
  NO SERVIDOR em cada requisição (não confiar em estado do cliente).
- ⚠️ Verificar na documentação vigente do Next.js (o projeto está no Next 16)
  a forma atual de proteger rotas via middleware — a API de middleware pode ter
  mudado entre versões; não usar sintaxe de memória.

### 1.2 Conta master
- Criar via script/seed (nunca via interface pública de cadastro).
- Senha com hash forte — bcrypt ou argon2 (bibliotecas reais do npm; escolher
  uma e usar as funções conforme a documentação dela, sem inventar assinatura).
- E-mail do master também em variável de ambiente (`ADMIN_EMAIL`) como checagem
  redundante.

### 1.3 Endurecimento específico do admin
- Rate limiting no login (proteção a força bruta).
- Re-confirmação de senha para ações destrutivas (deletar conta).
- Sessão do admin com expiração mais curta que a de usuário comum.
- 2FA/TOTP: recomendado como FASE FUTURA — ⚠️ não é nativo do NextAuth;
  exigiria implementação custom; não incluir agora para não inflar escopo.
- TODA ação do admin gera registro em `admin_audit_log` (quem, o quê, quando).

---

## 2. ESTRUTURA DA PÁGINA — `/admin` com 4 tabs

Layout: mesma identidade visual do app (tema escuro, accent verde — confirmar
tokens no `globals.css` atual). Sidebar do app NÃO aparece; o admin tem header
próprio minimalista com as 4 tabs e botão sair.

---

### TAB 1 — Contas

**Tabela de contas (colunas):**
| Coluna | Observação |
|---|---|
| Nome | |
| E-mail | |
| Empresa | |
| Telefone | |
| Plano | ver 2.1 abaixo |
| Status | ativa / suspensa / excluída |
| Criada em | |
| Último acesso | derivado do log de acessos |
| Ações | editar · suspender · excluir |

**Ações:**
- **Adicionar conta:** formulário (nome, e-mail, empresa, telefone, plano).
  Gerar senha temporária exibida UMA vez ao admin (ou link de convite — escolher
  o mais simples de implementar com o NextAuth atual e reportar a escolha).
- **Editar:** dados de contato e plano.
- **Excluir:** SOFT DELETE (marcar `deleted_at`, nunca apagar a linha) + modal de
  confirmação digitando o e-mail da conta + registro no audit log.
  Motivo: histórico de acessos e auditoria não podem ser órfãos.
- **Suspender/reativar:** bloqueio de login sem exclusão.

**2.1 Sobre "assinatura" — limite honesto do escopo:**
Até onde este PRD sabe, NÃO existe integração de pagamento no projeto (Stripe
etc.). Portanto "assinatura" nesta fase = campos gerenciados manualmente pelo
admin: `plano` (ex: Starter/Growth/Enterprise), `status_assinatura`
(ativa/expirada/trial), `expira_em` (data). Integração de cobrança real é fase
futura e fica FORA deste PRD.

---

### TAB 2 — Dashboard gerencial

KPIs em cards (dados reais do banco, nunca placeholder):
- Total de contas · contas ativas (login nos últimos 30 dias) · novas no mês
- Acessos hoje / últimos 7 dias
- Distribuição por plano (gráfico simples)
- Contas próximas de expirar (lista curta, `expira_em` < 30 dias)

⚠️ "Funcionalidades mais usadas" só é possível se houver rastreamento de eventos
por tela — se não existir ainda, NÃO exibir esse card nesta fase (não simular).
Anotar como melhoria futura dependente do item de telemetria.

---

### TAB 3 — Acessos (log)

**O que registrar (evento mínimo: login; ideal: login + visita de página):**

| Campo | Fonte |
|---|---|
| timestamp | servidor |
| user_id / nome / e-mail | sessão |
| evento | `login` (mínimo) · `page_view` (se viável via middleware) |
| rota | se page_view |
| IP | requisição |
| cidade / região / país | ver geolocalização abaixo |
| latitude / longitude | idem |
| user-agent (dispositivo/navegador) | requisição |

**Como capturar o login:** o NextAuth possui mecanismo de callbacks/events para
o momento do sign-in — ⚠️ verificar na documentação da versão INSTALADA o nome e
a assinatura exatos antes de usar (não confiar em memória de versão antiga).

**Geolocalização (decisão técnica):**
- OPÇÃO PREFERIDA (gratuita, embutida): a Vercel injeta headers de geolocalização
  nas requisições em produção (país, cidade, região, latitude, longitude).
  ⚠️ INCERTEZA SINALIZADA: os nomes exatos dos headers (padrão
  `x-vercel-ip-...`) e/ou o helper oficial do pacote da Vercel devem ser
  CONFIRMADOS na documentação vigente da Vercel antes de implementar. Não
  escrever os nomes de cabeçalho de memória.
- Em `localhost` esses headers não existem — o log deve gravar "local/dev" sem
  quebrar.
- Alternativas por API externa (ip-api, ipapi etc.): ⚠️ têm limites e restrições
  de uso comercial nas camadas gratuitas — evitar nesta fase; os headers da
  Vercel bastam.

**UI da tab:** tabela paginada, filtros por usuário/período/evento, busca.
Ordenação padrão: mais recente primeiro.

**⚠️ LGPD (sinalização obrigatória — não é aconselhamento jurídico):**
IP + localização + horário de pessoa identificada é dado pessoal. Mínimos a
implementar já: (a) política de retenção — sugerir expurgo automático de logs
com mais de 90 dias (job simples); (b) mencionar a coleta na política de
privacidade; (c) acesso ao log restrito ao master. Validação jurídica formal
recomendada antes do go-to-market.

---

### TAB 4 — Mapa de acessos

- Usar MapLibre GL + OpenFreeMap (decisão já tomada no projeto — gratuito, sem
  chave). NÃO reintroduzir Mapbox aqui.
- Plotar pontos a partir de latitude/longitude do log de acessos.
- Agrupamento por proximidade quando houver muitos pontos (clusters), com
  contagem.
- Filtro por período (hoje / 7 dias / 30 dias) e por usuário.
- Clique no ponto → mini-card: usuário, cidade, horário do último acesso dali.
- Estado vazio honesto: se ainda não há dados de geolocalização (ex: só acessos
  locais/dev), mostrar mensagem clara — nunca pontos fictícios.

---

## 3. SCHEMA SUGERIDO (ajustar ao banco existente)

```sql
-- estender a tabela de usuários existente (ou criar se não houver)
-- ⚠️ PASSO 0 define se é ALTER ou CREATE
ALTER TABLE usuarios ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE usuarios ADD COLUMN empresa TEXT;
ALTER TABLE usuarios ADD COLUMN telefone TEXT;
ALTER TABLE usuarios ADD COLUMN plano TEXT DEFAULT 'trial';
ALTER TABLE usuarios ADD COLUMN status_assinatura TEXT DEFAULT 'trial';
ALTER TABLE usuarios ADD COLUMN expira_em DATE;
ALTER TABLE usuarios ADD COLUMN deleted_at TIMESTAMPTZ;      -- soft delete
ALTER TABLE usuarios ADD COLUMN suspenso BOOLEAN DEFAULT false;

CREATE TABLE acessos (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT,
  evento      TEXT NOT NULL,           -- 'login' | 'page_view'
  rota        TEXT,
  ip          TEXT,
  cidade      TEXT,
  regiao      TEXT,
  pais        TEXT,
  latitude    NUMERIC,
  longitude   NUMERIC,
  user_agent  TEXT,
  criado_em   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_acessos_user ON acessos (user_id, criado_em DESC);
CREATE INDEX idx_acessos_data ON acessos (criado_em DESC);

CREATE TABLE admin_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  admin_id    TEXT NOT NULL,
  acao        TEXT NOT NULL,           -- 'criar_conta' | 'excluir_conta' | ...
  alvo        TEXT,                    -- id/e-mail afetado
  detalhes    JSONB,
  criado_em   TIMESTAMPTZ DEFAULT now()
);
```

---

## 4. ROTAS DE API (todas sob checagem server-side de role master)

| Rota | Função |
|---|---|
| `GET /api/admin/contas` | listar (com filtros e paginação) |
| `POST /api/admin/contas` | criar conta |
| `PATCH /api/admin/contas/[id]` | editar / suspender / plano |
| `DELETE /api/admin/contas/[id]` | soft delete + audit |
| `GET /api/admin/dashboard` | KPIs agregados |
| `GET /api/admin/acessos` | log paginado/filtrado |
| `GET /api/admin/acessos/mapa` | pontos lat/lng agregados p/ o mapa |

Validação de entrada em todas (schema validation — usar a biblioteca que JÁ
estiver no projeto; verificar `package.json` antes de adicionar nova).

---

## 5. ORDEM DE IMPLEMENTAÇÃO

1. PASSO 0 (auditoria do que existe) → reportar
2. Banco: tabelas/colunas da seção 3
3. Role master + proteção server-side de `/admin/**` e `/api/admin/**`
4. Registro de acessos no login (com geolocalização confirmada na doc da Vercel)
5. Tab 1 (Contas) — CRUD completo com soft delete e audit log
6. Tab 3 (Acessos) — tabela do log
7. Tab 2 (Dashboard) — agregações
8. Tab 4 (Mapa) — MapLibre com clusters
9. Job de expurgo de logs > 90 dias
10. Teste de segurança: tentar acessar `/admin` e cada `/api/admin/*` logado
    como usuário comum e deslogado — TODOS devem negar (teste obrigatório
    antes de dar como pronto)

---

## 6. FORA DO ESCOPO (explícito, para não inflar)

- Integração de pagamento (Stripe etc.) — "assinatura" é manual nesta fase
- 2FA/TOTP — fase futura
- Telemetria de uso por funcionalidade — fase futura (pré-requisito do card
  "features mais usadas" do dashboard)
- Múltiplos níveis de admin (só existe `master` por ora)
