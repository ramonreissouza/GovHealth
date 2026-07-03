-- db/schema-stripe.sql — colunas para a integração Stripe (idempotente).
-- Aplicar com: node scripts/migrate-stripe.mjs
-- NENHUM dado de cartão é armazenado (o cartão fica tokenizado no Stripe).

-- Assinaturas: referências do Stripe + status expandido.
ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS stripe_session_id      TEXT;
ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT;
ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS atualizado_em          TIMESTAMPTZ NOT NULL DEFAULT now();
-- status: pendente | checkout | ativa | inadimplente | cancelada
CREATE INDEX IF NOT EXISTS idx_assin_stripe_sub ON assinaturas (stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_assin_stripe_sess ON assinaturas (stripe_session_id);

-- Usuários: vincula ao customer do Stripe (para portal de cobrança futuro).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
