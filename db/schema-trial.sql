-- db/schema-trial.sql — controle do lembrete de fim do teste grátis (idempotente).
-- Aplicar com: node scripts/migrate-trial.mjs

-- Marca quando o e-mail "seu teste expira amanhã" foi enviado (evita reenvio).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS trial_lembrete_em TIMESTAMPTZ;
