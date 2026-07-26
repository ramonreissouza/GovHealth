-- db/schema-documentos.sql — Cofre de Documentos / Certidões (habilitação).
-- Rastreia certidões e documentos de habilitação do fornecedor com DATA DE VALIDADE,
-- para avisar antes de vencer (o que trava participação em pregão). Isolado por
-- `titular_id` (empresa). v1 HÍBRIDA: metadados + link externo; `arquivo_url` já
-- comporta o upload real (Vercel Blob) numa etapa seguinte, sem migração de schema.
-- Postgres (Neon). Idempotente. Aplicar: node scripts/migrate-documentos.mjs (npm run documentos:migrate)

CREATE TABLE IF NOT EXISTS documentos (
  id            TEXT PRIMARY KEY,          -- uuid
  titular_id    TEXT NOT NULL,             -- empresa dona (isolamento)
  user_id       TEXT NOT NULL,             -- usuarios.id de quem cadastrou
  tipo          TEXT NOT NULL,             -- certidao_federal | fgts | trabalhista | estadual | municipal | falencia | contrato_social | balanco | atestado | alvara | outro
  nome          TEXT NOT NULL,             -- rótulo livre ("CND Federal", "CRF FGTS"…)
  numero        TEXT,                      -- nº do documento (opcional)
  orgao_emissor TEXT,                      -- quem emitiu (Receita, Caixa, TST…)
  emissao       DATE,                      -- data de emissão (opcional)
  validade      DATE,                      -- vencimento — núcleo do alerta
  sem_validade  BOOLEAN NOT NULL DEFAULT false, -- doc sem vencimento (ex.: contrato social)
  arquivo_url   TEXT,                      -- link externo (v1); URL do blob depois
  observacao    TEXT,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documentos_titular  ON documentos (titular_id);
CREATE INDEX IF NOT EXISTS idx_documentos_validade ON documentos (validade) WHERE sem_validade = false;
