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

-- Tipo de fornecimento MATERIALIZADO como coluna GERADA (STORED) — troca o regex
-- full-scan por igualdade indexada (dashboard "cold" cai de ~5,5s para <1s).
-- Preenchida automaticamente para linhas existentes e novas (sem mudar o ETL).
-- Espelha lib/tipo-sql.ts / score-engine.classificarTipo — manter em sincronia.
-- (O mesmo CASE roda em scripts/migrate-tipo-fornecimento.mjs para bancos ja criados.)
ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS tipo_fornecimento TEXT
  GENERATED ALWAYS AS (CASE
    WHEN coalesce(objeto_compra, '') ~* '(manuten[çc]|reparo|conserto|instala[çc]|reforma|loca[çc][ãa]o|aluguel|presta[çc][ãa]o de servi|servi[çc]os? de|m[ãa]o de obra|limpeza|higieniz|esteriliza[çc]|lavanderia|dedetiz|res[íi]duo|transporte de pacient|remo[çc][ãa]o de pacient|servi[çc]o.*ambul[âa]nc|calibra[çc]|gases medicinais|oxig[êe]nio medicinal)' THEN 'servico'
    WHEN coalesce(objeto_compra, '') ~* '([óo]rtese|pr[óo]tese|opme|implante|stent|marca-?passo|osteoss[íi]ntese|haste (femoral|intramedular)|placa (de )?tit[âa]nio|parafuso (ortop|pedicular)|lente intraocular|enxerto [óo]sseo|fio de kirschner)' THEN 'opme'
    WHEN coalesce(objeto_compra, '') ~* '(medicament|f[áa]rmaco|farmac[êe]ut|antibi[óo]tic|insumo farmac|princ[íi]pio ativo|vacina|soro fisiol|injet[áa]vel|comprimido|ampola|quimioter[áa]pico)' THEN 'medicamento'
    WHEN coalesce(objeto_compra, '') ~* '(tom[óo]grafo|resson[âa]ncia|ultrassom|ultrassonograf|raio-?x|mam[óo]grafo|ventilador|respirador|monitor (multi|card|de )|desfibrilador|eletrocardi[óo]grafo|ox[íi]metro|autoclave|equipamento m[ée]dic|equipamento hospitalar|equipamento odontol|mesa cir[úu]rg|foco cir[úu]rg|maca|cama hospitalar|incubadora|bomba de infus|aparelho de|cadeira odontol)' THEN 'equipamento'
    WHEN coalesce(objeto_compra, '') ~* '(acess[óo]rio|insumo|descart[áa]vel|seringa|agulha|luva|gaze|atadura|cateter|sonda|equipo|eletrodo|m[áa]scara|avental|compressa|curativo|fralda|material m[ée]dic|material hospitalar|material de consumo|reagente|kit (para|de) (teste|diagn))' THEN 'acessorio'
    ELSE 'outros'
  END) STORED;
CREATE INDEX IF NOT EXISTS idx_contr_tipo    ON contratacoes (tipo_fornecimento);
CREATE INDEX IF NOT EXISTS idx_contr_uf_tipo ON contratacoes (uf, tipo_fornecimento);

ALTER TABLE resultados ADD COLUMN IF NOT EXISTS tipo_fornecimento TEXT
  GENERATED ALWAYS AS (CASE
    WHEN coalesce(nome_catmat, '') ~* '(manuten[çc]|reparo|conserto|instala[çc]|reforma|loca[çc][ãa]o|aluguel|presta[çc][ãa]o de servi|servi[çc]os? de|m[ãa]o de obra|limpeza|higieniz|esteriliza[çc]|lavanderia|dedetiz|res[íi]duo|transporte de pacient|remo[çc][ãa]o de pacient|servi[çc]o.*ambul[âa]nc|calibra[çc]|gases medicinais|oxig[êe]nio medicinal)' THEN 'servico'
    WHEN coalesce(nome_catmat, '') ~* '([óo]rtese|pr[óo]tese|opme|implante|stent|marca-?passo|osteoss[íi]ntese|haste (femoral|intramedular)|placa (de )?tit[âa]nio|parafuso (ortop|pedicular)|lente intraocular|enxerto [óo]sseo|fio de kirschner)' THEN 'opme'
    WHEN coalesce(nome_catmat, '') ~* '(medicament|f[áa]rmaco|farmac[êe]ut|antibi[óo]tic|insumo farmac|princ[íi]pio ativo|vacina|soro fisiol|injet[áa]vel|comprimido|ampola|quimioter[áa]pico)' THEN 'medicamento'
    WHEN coalesce(nome_catmat, '') ~* '(tom[óo]grafo|resson[âa]ncia|ultrassom|ultrassonograf|raio-?x|mam[óo]grafo|ventilador|respirador|monitor (multi|card|de )|desfibrilador|eletrocardi[óo]grafo|ox[íi]metro|autoclave|equipamento m[ée]dic|equipamento hospitalar|equipamento odontol|mesa cir[úu]rg|foco cir[úu]rg|maca|cama hospitalar|incubadora|bomba de infus|aparelho de|cadeira odontol)' THEN 'equipamento'
    WHEN coalesce(nome_catmat, '') ~* '(acess[óo]rio|insumo|descart[áa]vel|seringa|agulha|luva|gaze|atadura|cateter|sonda|equipo|eletrodo|m[áa]scara|avental|compressa|curativo|fralda|material m[ée]dic|material hospitalar|material de consumo|reagente|kit (para|de) (teste|diagn))' THEN 'acessorio'
    ELSE 'outros'
  END) STORED;
CREATE INDEX IF NOT EXISTS idx_res_tipo ON resultados (tipo_fornecimento);
