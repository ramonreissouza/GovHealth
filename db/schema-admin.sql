-- db/schema-admin.sql — tabelas da área ADMIN (PRD-admin). Postgres (Neon).
-- Idempotente. Aplicar com: node scripts/seed-admin.mjs (aplica + semeia contas).
-- Não havia tabela de usuários (auth era hardcoded) — aqui ela é CRIADA.

-- Usuários da plataforma. id = e-mail (minúsculo), compatível com o id de sessão
-- atual do NextAuth (que usava o e-mail como id).
CREATE TABLE IF NOT EXISTS usuarios (
  id                TEXT PRIMARY KEY,              -- e-mail em minúsculo
  email             TEXT UNIQUE NOT NULL,
  nome              TEXT,
  senha_hash        TEXT NOT NULL,                 -- bcrypt
  role              TEXT NOT NULL DEFAULT 'user',  -- 'master' | 'user'
  empresa           TEXT,
  telefone          TEXT,
  plano             TEXT DEFAULT 'trial',          -- Starter | Growth | Enterprise | trial
  status_assinatura TEXT DEFAULT 'trial',          -- ativa | expirada | trial
  expira_em         DATE,
  suspenso          BOOLEAN NOT NULL DEFAULT false,
  deleted_at        TIMESTAMPTZ,                   -- soft delete
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Log de acessos (login e, se viável, page_view). Dado pessoal (LGPD) — expurgo > 90d.
CREATE TABLE IF NOT EXISTS acessos (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT,
  nome        TEXT,
  email       TEXT,
  evento      TEXT NOT NULL,             -- 'login' | 'page_view'
  rota        TEXT,
  ip          TEXT,
  cidade      TEXT,
  regiao      TEXT,
  pais        TEXT,
  latitude    NUMERIC,
  longitude   NUMERIC,
  user_agent  TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_acessos_user ON acessos (user_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_acessos_data ON acessos (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_acessos_geo  ON acessos (latitude, longitude);

-- Trilha de auditoria das ações do admin.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  admin_id    TEXT NOT NULL,
  acao        TEXT NOT NULL,             -- 'criar_conta' | 'editar_conta' | 'suspender' | 'excluir_conta' ...
  alvo        TEXT,                      -- id/e-mail afetado
  detalhes    JSONB,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_data ON admin_audit_log (criado_em DESC);
