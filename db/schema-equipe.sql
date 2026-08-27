-- db/schema-equipe.sql — Equipe (assentos por CNPJ) + 2FA por e-mail + sessão única
-- + dados por conta (user_data). Idempotente. Aplicar com: node scripts/migrate-equipe.mjs
-- (ou: npm run equipe:migrate). Tudo aditivo — não altera o login existente.

-- ── Equipe / assentos ────────────────────────────────────────────────────────
-- titular_id NULL = titular (a conta que assinou e detém os assentos). Os membros
-- têm titular_id = id do titular.
--
-- `assentos` = o número NEGOCIADO daquela conta. NULO = "use o que o plano inclui"
-- (ASSENTOS_DO_PLANO em src/lib/users.ts). O DEFAULT é NULL de propósito: era 1, e
-- conta Empresa nova nascia mostrando "1 assento · 0 vagas", contradizendo o plano que
-- vende vários. Preenchido, o número manda nos DOIS sentidos — um contrato pode incluir
-- menos que o plano-padrão (Prime Medical em 27/08/2026: 1) tanto quanto mais.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS titular_id TEXT;                    -- NULL = titular
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS assentos   INTEGER;
-- Bancos que já tinham a coluna como NOT NULL DEFAULT 1 (é o caso do primeiro deploy):
-- alinhar sem tocar em valor nenhum. A conversão dos que estão no default antigo é
-- feita por scripts/assentos-conta.mjs --converter-default, de propósito FORA daqui:
-- este arquivo roda várias vezes, e um UPDATE ... WHERE assentos = 1 apagaria numa
-- segunda passada justamente a conta negociada para 1.
ALTER TABLE usuarios ALTER COLUMN assentos DROP NOT NULL;
ALTER TABLE usuarios ALTER COLUMN assentos SET DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_usuarios_titular ON usuarios (titular_id);

-- ── 2FA por e-mail (código de acesso de 6 dígitos, hash bcrypt) ───────────────
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS otp_hash       TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS otp_expira     TIMESTAMPTZ;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS otp_tentativas INTEGER NOT NULL DEFAULT 0;

-- ── Sessão única (um assento ativo por conta) ─────────────────────────────────
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sessao_id           TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sessao_expira       TIMESTAMPTZ;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sessao_ultimo_visto TIMESTAMPTZ;

-- ── Convites de equipe ────────────────────────────────────────────────────────
-- Um convite por (titular, e-mail). O convidado cria a própria senha pelo link.
CREATE TABLE IF NOT EXISTS convites (
  id          TEXT PRIMARY KEY,
  titular_id  TEXT NOT NULL,               -- usuarios.id do titular
  cnpj        TEXT,                         -- herdado do titular (no aceite)
  email       TEXT NOT NULL,                -- e-mail convidado (minúsculo)
  token       TEXT UNIQUE NOT NULL,         -- token do link de aceite
  plano       TEXT,                         -- herdado do titular
  expira_em   TIMESTAMPTZ NOT NULL,         -- validade do convite (7 dias)
  aceito_em   TIMESTAMPTZ,                  -- NULL enquanto pendente
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_convites_titular ON convites (titular_id);
CREATE INDEX IF NOT EXISTS idx_convites_email   ON convites (lower(email));

-- ── Dados por conta (substitui o localStorage): portfólio, CRM, alertas, agenda ─
-- Também consta em db/schema.sql; recriado aqui (IF NOT EXISTS) para a migração de
-- equipe ser autossuficiente em bancos que ainda não rodaram o schema principal.
CREATE TABLE IF NOT EXISTS user_data (
  user_id       TEXT NOT NULL,
  chave         TEXT NOT NULL,             -- 'portfolio' | 'crm' | 'alertas-config' | 'alertas-notif' | 'agenda'
  valor         JSONB NOT NULL DEFAULT '[]'::jsonb,
  atualizado_em TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, chave)
);
