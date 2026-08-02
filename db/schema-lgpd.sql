-- db/schema-lgpd.sql — suporte à anonimização LGPD (direito à eliminação, Art. 18).
-- Idempotente. Aplicar com: node scripts/migrate-lgpd.mjs (ou npm run lgpd:migrate)
-- Marca quando o titular foi anonimizado (ver anonimizarUsuario em src/lib/users.ts).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS anonimizado_em TIMESTAMPTZ;
