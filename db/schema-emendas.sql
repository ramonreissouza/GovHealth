-- db/schema-emendas.sql — Radar de Verba: cache local das emendas parlamentares de
-- Saúde (Portal da Transparência). Existe porque puxar as ~1.200+ emendas/ano ao vivo
-- estoura o timeout de 30s da rota serverless + o rate-limit do Portal. Um cron
-- (/api/cron/sync-emendas) varre TODAS as páginas com codigoFuncao=10 e grava aqui;
-- a rota /api/radar-verba passa a ler do banco (instantâneo e completo).
--
-- Guardamos os valores CRUS exatamente como o Portal devolve (strings BR "1.234,56").
-- O score/temperatura NÃO é persistido: é calculado na leitura por src/lib/radar-verba.ts
-- (fonte única da regra), então dá pra recalibrar o score sem reprocessar o banco.
-- Idempotente. Uso: node scripts/migrate-emendas.mjs (ou npm run emendas:migrate)

CREATE TABLE IF NOT EXISTS emendas_saude (
  codigo_emenda    text PRIMARY KEY,
  numero_emenda    text,
  ano              integer,
  autor            text,
  tipo_emenda      text,
  funcao           text,
  subfuncao        text,
  localidade_gasto text,
  -- valores mantidos como TEXT (string BR do Portal). String vazia/NULL = "não
  -- informado" (≠ "pago 0"); src/lib/radar-verba.ts distingue os dois na leitura.
  valor_empenhado  text,
  valor_liquidado  text,
  valor_pago       text,
  coletado_em      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emendas_saude_ano ON emendas_saude (ano);
CREATE INDEX IF NOT EXISTS idx_emendas_saude_coletado ON emendas_saude (coletado_em);
