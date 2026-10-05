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

-- Eventos do webhook (revisão da #63). O Stripe entrega "pelo menos uma vez" e reenvia
-- quando a resposta não é 2xx. Sem registro do event.id, um reenvio repetia ativação e
-- e-mails; e, como o webhook devolvia 200 até em erro, uma falha no meio nunca era
-- retentada. Cada evento é reivindicado aqui antes de processar: `processando_ate` é a
-- trava (duas entregas simultâneas não processam juntas) e `processado_em` marca o fim.
CREATE TABLE IF NOT EXISTS stripe_eventos (
  id              TEXT PRIMARY KEY,          -- event.id do Stripe (evt_…)
  tipo            TEXT NOT NULL,
  recebido_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  processando_ate TIMESTAMPTZ,
  processado_em   TIMESTAMPTZ,
  tentativas      INTEGER NOT NULL DEFAULT 1,
  ultimo_erro     TEXT
);

-- Página de sucesso (revisão da #63): o session_id da URL não basta para ver o estado
-- da conta. O checkout cria um cookie HttpOnly aleatório e guarda aqui só o hash dele;
-- /api/assinaturas/status só detalha para o navegador que tem o cookie.
ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS checkout_nonce_hash TEXT;
