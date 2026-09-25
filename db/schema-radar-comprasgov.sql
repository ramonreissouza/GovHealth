-- Adicional e idempotente. Não converte automaticamente processos PNCP em SIASG.
BEGIN;
CREATE TABLE IF NOT EXISTS radar_comprasgov_canais (
  processo_id TEXT NOT NULL REFERENCES radar_processos(id) ON DELETE CASCADE,
  canal TEXT NOT NULL CHECK (canal IN ('chat', 'diligencias')),
  ambiente TEXT NOT NULL CHECK (ambiente IN ('producao', 'homologacao')),
  chave_compra TEXT NOT NULL CHECK (chave_compra ~ '^[0-9]{17}$'),
  desde TIMESTAMPTZ,
  maior_data TIMESTAMPTZ,
  proxima_pagina INTEGER NOT NULL DEFAULT 0 CHECK (proxima_pagina >= 0),
  inicializado BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'paginando', 'ok', 'falha', 'nao_encontrado')),
  detalhe TEXT,
  tentado_em TIMESTAMPTZ,
  verificado_em TIMESTAMPTZ,
  proxima_consulta TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_id TEXT,
  lease_ate TIMESTAMPTZ,
  PRIMARY KEY (processo_id, canal)
);
CREATE INDEX IF NOT EXISTS radar_comprasgov_fila ON radar_comprasgov_canais (ambiente, proxima_consulta);
COMMIT;
