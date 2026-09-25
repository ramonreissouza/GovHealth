-- Coordenação entre o coletor geral e o serviço público dedicado.
-- Lease em tabela: funciona também com PgBouncer em transaction pooling.
CREATE TABLE IF NOT EXISTS radar_coletor_leases (
  portal TEXT PRIMARY KEY,
  lease_id TEXT,
  lease_ate TIMESTAMPTZ,
  proxima_tentativa TIMESTAMPTZ NOT NULL DEFAULT now()
);
