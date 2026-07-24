-- db/schema-capag.sql — CAPAG (Capacidade de Pagamento) do Tesouro Nacional.
-- Nota A/B/C/D de saúde fiscal de estados e municípios; alimenta o sub-score de
-- "capacidade de pagamento da instituição" no Opportunity Score e no Radar de Verba.
-- Fonte: dados abertos do Tesouro (CKAN) — estados via CSV, municípios via XLSX.
-- Populada por scripts/ingest-capag.mjs (npm run capag:ingest). Idempotente.
--
-- Uso: node scripts/migrate-capag.mjs (ou npm run capag:migrate)

CREATE TABLE IF NOT EXISTS capag (
  ente_tipo      text NOT NULL,            -- 'estado' | 'municipio'
  uf             text NOT NULL,
  municipio_key  text NOT NULL DEFAULT '', -- nome normalizado (sem acento/minúsculo); '' para estado
  municipio_nome text,
  codigo_ibge    text,
  nota           text,                     -- A / B / C / D (Classificação da CAPAG)
  ind1_nota      text,                     -- nota do indicador 1 (endividamento)
  ind2_nota      text,                     -- nota do indicador 2 (poupança corrente)
  ind3_nota      text,                     -- nota do indicador 3 (liquidez)
  ano            int,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ente_tipo, uf, municipio_key)
);

CREATE INDEX IF NOT EXISTS idx_capag_lookup ON capag (uf, municipio_key);
