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

-- Boas-vindas do cartão: o que o webhook conseguiu fazer depois de ativar. Sem isto a
-- página de sucesso afirmava "enviamos os dados de acesso" mesmo quando o e-mail não
-- saía — e para conta NOVA a senha temporária só existe dentro desse e-mail. Achado no
-- primeiro teste com chave, em 05/10/2026: RESEND_API_KEY ausente, nenhum log, tela dizendo
-- que enviou. NULL em boas_vindas_em = o webhook ainda não terminou (ou é anterior a isto).
ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS conta_nova          BOOLEAN;
ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS boas_vindas_em      TIMESTAMPTZ;
ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS boas_vindas_enviado BOOLEAN;
ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS boas_vindas_erro    TEXT;

-- Usuários: vincula ao customer do Stripe (para portal de cobrança futuro).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
