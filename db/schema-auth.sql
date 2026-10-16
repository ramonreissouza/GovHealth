-- db/schema-auth.sql — revogação de sessão e cooldown do código 2FA (idempotente).
-- Aplicar com: node scripts/migrate-auth.mjs  (ou: npm run auth:migrate)
-- Tudo aditivo e anulável: o código anterior ignora as duas colunas.

-- Quando a senha mudou (troca em /conta ou redefinição pelo e-mail). Sessão iniciada
-- ANTES disso é derrubada no próximo refresh do JWT / heartbeat (src/lib/users.ts
-- sessaoRevogada). NULL = nunca mudou desde esta migration: ninguém cai no deploy.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_alterada_em TIMESTAMPTZ;

-- Último envio do código de acesso: impõe intervalo mínimo entre reenvios
-- (src/lib/seguranca.ts enviarOtp).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS otp_enviado_em TIMESTAMPTZ;
