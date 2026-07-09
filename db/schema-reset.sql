-- db/schema-reset.sql — colunas para "esqueci minha senha" (idempotente).
-- Aplicar com: node scripts/migrate-reset.mjs  (ou: npm run reset:migrate)
-- O token de redefinição nunca é armazenado em claro: guardamos só o hash bcrypt.

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS reset_hash   TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS reset_expira TIMESTAMPTZ;
