-- db/schema-estados.sql — Dados de portais de transparência ESTADUAIS (piloto: Bahia).
-- Fonte: CKAN dados.<uf>.gov.br. Tabelas UF-keyed (extensíveis a outros estados sem
-- mudança de schema). Idempotente. Uso: npm run estados:migrate
--
-- Item 2 — Emendas parlamentares ESTADUAIS (novo lead no Radar de Verba; o federal já
-- vem do Portal da Transparência). Uma linha por código orçamentário da emenda/ação.

CREATE TABLE IF NOT EXISTS emendas_estaduais (
  uf              text NOT NULL,
  num_codigo      text NOT NULL,        -- código orçamentário (chave da linha)
  ano             integer,
  orgao           text,
  sgl_orgao       text,
  unidade         text,
  acao            text,                 -- ação/objeto (o "o quê" da emenda)
  autor           text,                 -- deputado(a)
  empenhado       numeric,
  liquidado       numeric,
  pago            numeric,
  categoria_saude boolean DEFAULT false,
  coletado_em     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (uf, num_codigo)
);
CREATE INDEX IF NOT EXISTS idx_emendas_est_uf_saude ON emendas_estaduais (uf, categoria_saude);

-- Item 1 — Comportamento de PAGAMENTO por órgão (agregado da ordem cronológica /
-- pagamentos). Enriquece a capacidade de pagamento (CAPAG + prazo/atraso real).
CREATE TABLE IF NOT EXISTS pagamento_comportamento (
  uf                 text NOT NULL,
  orgao_key          text NOT NULL,     -- órgão normalizado (chave)
  orgao_nome         text,
  prazo_medio_dias   numeric,           -- média de dias entre empenho/liquidação e pagamento
  valor_pago_12m     numeric,           -- total pago nos últimos 12 meses
  valor_em_atraso    numeric,           -- soma na fila ainda não paga (ordem cronológica)
  qtd_fila           integer,           -- itens na fila de pagamento
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (uf, orgao_key)
);

-- Item 3 — DESPESAS de saúde agregadas (demanda) e por FORNECEDOR (concorrência).
CREATE TABLE IF NOT EXISTS despesa_saude_agg (
  uf              text NOT NULL,
  ano             integer NOT NULL,
  orgao_key       text NOT NULL,
  orgao_nome      text,
  favorecido_key  text NOT NULL DEFAULT '', -- '' = agregado do órgão; senão fornecedor
  favorecido_nome text,
  favorecido_doc  text,
  empenhado       numeric,
  liquidado       numeric,
  pago            numeric,
  qtd             integer,
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (uf, ano, orgao_key, favorecido_key)
);

-- Item 3 — CONTRATOS de saúde (vigência → oportunidade de renovação).
CREATE TABLE IF NOT EXISTS contrato_estadual (
  uf              text NOT NULL,
  numero          text NOT NULL,
  orgao           text,
  fornecedor_nome text,
  fornecedor_doc  text,
  objeto          text,
  valor           numeric,
  data_inicio     date,
  data_fim        date,                 -- vencimento → sinal de renovação
  categoria_saude boolean DEFAULT false,
  coletado_em     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (uf, numero)
);
CREATE INDEX IF NOT EXISTS idx_contrato_est_uf_fim ON contrato_estadual (uf, data_fim);
