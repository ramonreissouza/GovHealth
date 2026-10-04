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
