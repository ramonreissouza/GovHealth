-- db/schema-pagometro.sql — PAGÔMETRO: em quantos dias o ente paga uma conta depois de
-- reconhecê-la (liquidação). Fonte: Matriz de Saldos Contábeis (MSC) do Siconfi, que
-- todo município e estado entrega todo mês. Cálculo em src/lib/pagometro-calculo.mjs.
-- Populada por scripts/ingest-pagometro.mjs (npm run pagometro:ingest), que também
-- aplica este arquivo. Idempotente.

-- Uma linha por ente e mês: só compra de fornecedor (ver ELEMENTOS_FORNECEDOR).
CREATE TABLE IF NOT EXISTS pagometro_mensal (
  codigo_ibge          text NOT NULL,
  ano                  int  NOT NULL,
  mes                  int  NOT NULL,
  ente_tipo            text NOT NULL,             -- 'municipio' | 'estado'
  uf                   text NOT NULL,
  municipio_key        text NOT NULL DEFAULT '',  -- normalizeKey(nome); '' para estado
  a_pagar              numeric NOT NULL,          -- 6.2.2.1.3.03, saldo no fim do mês
  pago_acumulado       numeric NOT NULL,          -- 6.2.2.1.3.04, acumulado no ano
  a_pagar_saude        numeric NOT NULL,          -- idem, função 10
  pago_acumulado_saude numeric NOT NULL,
  linhas_msc           int,                       -- linhas lidas da MSC (auditoria)
  coletado_em          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (codigo_ibge, ano, mes)
);

-- O resumo que o app lê: um por ente, mesma chave da tabela capag.
CREATE TABLE IF NOT EXISTS pagometro (
  ente_tipo          text NOT NULL,
  uf                 text NOT NULL,
  municipio_key      text NOT NULL DEFAULT '',
  municipio_nome     text,
  codigo_ibge        text NOT NULL,
  dias               numeric,                     -- NULL = dado insuficiente
  dias_saude         numeric,
  meses              int NOT NULL,
  mes_inicio         date,
  mes_fim            date,
  pago_periodo       numeric,
  pago_periodo_saude numeric,
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ente_tipo, uf, municipio_key)
);

-- ── NO PRODUTO (Fase 3): o prazo de quem paga, gravado em cada contratação ───────────
-- Preenchido por scripts/lib/pagometro-contratacoes.mjs (ao fim das cargas e em
-- npm run pagometro:contratacoes) com a MESMA decisão do selo (acharPagador). É o que o
-- score, o filtro "paga em até" e o e-mail de oportunidades leem: assim o SQL não
-- precisa reproduzir a regra de quem paga. NULL = sem prazo medido para esse pagador.
--
-- ALTER em contratacoes pede bloqueio exclusivo. Este arquivo roda a cada carga, e com
-- a coleta do PNCP no meio de uma transação longa o ALTER esperaria na fila e TRAVARIA
-- atrás dele as consultas da tela. Então: só quando a coluna falta, e desistindo em 5 s
-- (a carga falha e tenta de novo na próxima rodada, sem travar o app).
DO $$
BEGIN
  IF to_regclass('contratacoes') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'contratacoes' AND column_name = 'pagometro_fonte') THEN
    SET LOCAL lock_timeout = '5s';
    ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS pagometro_dias    numeric;
    ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS pagometro_pagador text;
    ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS pagometro_fonte   text;   -- 'siconfi' | 'portal'
  END IF;
END $$;

-- ── FEDERAL (Fase 2): por Unidade Gestora, dos arquivos diários de despesa do Portal da
-- Transparência (CGU). Cálculo em src/lib/pagometro-federal.mjs; carga em
-- scripts/ingest-pagometro-federal.mjs (npm run pagometro:federal), que aplica este arquivo.

-- Dias já processados. A ordem importa (o pagamento quita a liquidação mais antiga do
-- empenho), então a carga anda dia a dia e para no primeiro que falta.
CREATE TABLE IF NOT EXISTS pagometro_fed_dias (
  dia            date PRIMARY KEY,
  liquidacoes    int,               -- eventos de fornecedor lidos; NULL = dia pulado (sem arquivo)
  pagamentos     int,
  processado_em  timestamptz NOT NULL DEFAULT now()
);

-- Liquidações de fornecedor ainda não pagas: a fila de cada empenho, em ordem de chegada.
CREATE TABLE IF NOT EXISTS pagometro_fed_abertas (
  empenho  text    NOT NULL,
  ordem    int     NOT NULL,
  ug       text    NOT NULL,
  data     date    NOT NULL,
  saldo    numeric NOT NULL,
  PRIMARY KEY (empenho, ordem)
);
CREATE INDEX IF NOT EXISTS idx_pagometro_fed_abertas_data ON pagometro_fed_abertas (data);

-- Pago a fornecedor por UG e mês do pagamento: o casado com liquidação (e os dias), e o
-- que não achou liquidação conhecida.
CREATE TABLE IF NOT EXISTS pagometro_fed_mensal (
  ug              text    NOT NULL,
  ano             int     NOT NULL,
  mes             int     NOT NULL,
  pago            numeric NOT NULL DEFAULT 0,
  pago_x_dias     numeric NOT NULL DEFAULT 0,
  sem_liquidacao  numeric NOT NULL DEFAULT 0,
  pagamentos      int     NOT NULL DEFAULT 0,   -- só os que casaram com alguma liquidação
  PRIMARY KEY (ug, ano, mes)
);

-- Nome de cada UG como o Portal escreve (o último visto).
CREATE TABLE IF NOT EXISTS pagometro_fed_ugs (
  ug     text PRIMARY KEY,
  nome   text,
  orgao  text
);

-- O resumo que o app lê: um por UG (= UASG do PNCP na esfera federal).
CREATE TABLE IF NOT EXISTS pagometro_federal (
  ug             text PRIMARY KEY,
  nome           text,
  orgao          text,
  dias           numeric,           -- NULL = dado insuficiente
  pago_periodo   numeric,
  pagamentos     int,
  casado         numeric,           -- fração do pago que casou com liquidação conhecida
  meses          int,
  mes_inicio     date,
  mes_fim        date,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);
