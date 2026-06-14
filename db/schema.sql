-- db/schema.sql — Módulo de Inteligência de Resultados (PRD telas vencedores)
-- Postgres (Neon). Idempotente: pode rodar várias vezes.

-- Contratações de saúde (cabeçalho)
CREATE TABLE IF NOT EXISTS contratacoes (
  numero_controle_pncp TEXT PRIMARY KEY,
  cnpj_orgao           TEXT NOT NULL,
  razao_social_orgao   TEXT,
  municipio            TEXT,
  uf                   TEXT,
  modalidade_nome      TEXT,
  objeto_compra        TEXT,
  ano_compra           INT,
  sequencial_compra    INT,
  valor_total_estimado NUMERIC,
  data_publicacao      DATE,
  situacao_id          INT,
  categoria_saude      TEXT,           -- imagem, uti, laboratorio, etc.
  coletado_em          TIMESTAMPTZ DEFAULT now()
);

-- Itens de cada contratação
CREATE TABLE IF NOT EXISTS itens (
  id                       BIGSERIAL PRIMARY KEY,
  numero_controle_pncp     TEXT REFERENCES contratacoes,
  numero_item              INT,
  descricao                TEXT,
  codigo_catmat            TEXT,        -- catalogoCodigoItem
  nome_catmat              TEXT,        -- nome do item de catálogo (ou descrição)
  quantidade               NUMERIC,
  valor_unitario_estimado  NUMERIC,
  situacao_item_id         INT,         -- 2 = homologado
  UNIQUE (numero_controle_pncp, numero_item)
);

-- Resultados homologados (vencedores) — o coração das 4 telas
CREATE TABLE IF NOT EXISTS resultados (
  id                        BIGSERIAL PRIMARY KEY,
  numero_controle_pncp      TEXT,
  numero_item               INT,
  ni_fornecedor             TEXT,       -- CNPJ vencedor
  nome_fornecedor           TEXT,
  quantidade_homologada     NUMERIC,
  valor_unitario_homologado NUMERIC,
  valor_total_homologado    NUMERIC,
  data_resultado            DATE,
  ordem_classificacao_srp   INT,
  porte_fornecedor          TEXT,
  uf                        TEXT,       -- desnormalizado p/ performance
  codigo_catmat             TEXT,       -- desnormalizado
  nome_catmat               TEXT,       -- desnormalizado
  ano                       INT,        -- desnormalizado p/ filtro por ano
  -- idempotência do ETL (UPSERT)
  UNIQUE (numero_controle_pncp, numero_item, ni_fornecedor),
  FOREIGN KEY (numero_controle_pncp, numero_item)
    REFERENCES itens (numero_controle_pncp, numero_item)
);

-- Checkpoint do ETL (retomar de onde parou)
CREATE TABLE IF NOT EXISTS etl_checkpoint (
  chave         TEXT PRIMARY KEY,       -- ex: "uf:CE"
  ultima_pagina INT,
  atualizado_em TIMESTAMPTZ DEFAULT now()
);

-- Índices essenciais para as agregações das telas
CREATE INDEX IF NOT EXISTS idx_res_uf        ON resultados (uf);
CREATE INDEX IF NOT EXISTS idx_res_fornec    ON resultados (ni_fornecedor);
CREATE INDEX IF NOT EXISTS idx_res_catmat    ON resultados (codigo_catmat);
CREATE INDEX IF NOT EXISTS idx_res_ano       ON resultados (ano);
CREATE INDEX IF NOT EXISTS idx_res_valor     ON resultados (valor_total_homologado DESC);
