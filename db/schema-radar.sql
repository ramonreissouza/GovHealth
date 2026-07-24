-- db/schema-radar.sql — Módulo Radar (monitoramento de chat de licitações).
-- Inspirado no "Monitoramento de Chat" da Effecti (item 3/4 do benchmark): acompanhar
-- mensagens/convocações/diligências de processos em portais (começando por Compras.gov.br)
-- durante a execução do pregão, para que nada crítico passe despercebido.
-- Postgres (Neon). Idempotente: pode rodar várias vezes.
-- Aplicar: node scripts/migrate-radar.mjs  (ou: npm run radar:migrate)
--
-- Isolamento multi-tenant por `titular_id` (a empresa/conta que assinou) + `user_id`
-- (quem cadastrou). Credenciais de portal ficam CIFRADAS (AES-256-GCM, ver lib/radar/crypto).

-- Conectores (portais suportados)
CREATE TABLE IF NOT EXISTS radar_conectores (
  id         TEXT PRIMARY KEY,            -- 'comprasgov'
  nome       TEXT NOT NULL,               -- 'Compras.gov.br'
  ativo      BOOLEAN NOT NULL DEFAULT true,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Credenciais/conexão do fornecedor ao portal (COFRE).
-- Modelo padrão = CAPTURA DE SESSÃO ASSISTIDA (metodo='sessao'): o fornecedor loga
-- na página REAL do gov.br e guardamos só os cookies de sessão (`storage_state`),
-- CIFRADOS — sem armazenar senha. `cred_cipher` (senha cifrada) fica opcional, para
-- o modo legado 'senha' (fallback). Nada em claro.
CREATE TABLE IF NOT EXISTS radar_credenciais (
  id            TEXT PRIMARY KEY,          -- uuid
  titular_id    TEXT NOT NULL,             -- empresa dona (isolamento)
  user_id       TEXT NOT NULL,             -- usuarios.id de quem cadastrou
  conector_id   TEXT NOT NULL REFERENCES radar_conectores(id),
  cnpj          TEXT NOT NULL,             -- fornecedor cujo chat será lido
  login         TEXT NOT NULL,             -- CPF/identificação (rótulo; não é segredo)
  metodo        TEXT NOT NULL DEFAULT 'sessao',  -- sessao | senha
  cred_cipher   TEXT,                      -- (legado) senha cifrada iv:tag:ct — NULL no modo sessão
  storage_state TEXT,                      -- storageState do Playwright, CIFRADO (a sessão do gov.br)
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (titular_id, conector_id, cnpj)
);
CREATE INDEX IF NOT EXISTS idx_radar_cred_titular ON radar_credenciais (titular_id);
-- Migração para bancos já criados (idempotente): senha deixa de ser obrigatória.
ALTER TABLE radar_credenciais ADD COLUMN IF NOT EXISTS metodo TEXT NOT NULL DEFAULT 'sessao';
ALTER TABLE radar_credenciais ALTER COLUMN cred_cipher DROP NOT NULL;
-- Fila de conexão assistida: a UI enfileira ('pendente'); o serviço de conexão
-- (scripts/radar/connect-service.mjs) abre o gov.br, captura a sessão e conclui
-- ('conectado'/'erro'). Assim a tela do cliente NÃO pede comando nenhum.
ALTER TABLE radar_credenciais ADD COLUMN IF NOT EXISTS conexao_status TEXT NOT NULL DEFAULT 'idle';
  -- idle | pendente | conectando | conectado | erro
ALTER TABLE radar_credenciais ADD COLUMN IF NOT EXISTS conexao_pedido_em TIMESTAMPTZ;
ALTER TABLE radar_credenciais ADD COLUMN IF NOT EXISTS conexao_detalhe TEXT;
-- Navegador hospedado (steel): id da sessão remota e URL de live view p/ embutir no iframe.
ALTER TABLE radar_credenciais ADD COLUMN IF NOT EXISTS conexao_session_id TEXT;
ALTER TABLE radar_credenciais ADD COLUMN IF NOT EXISTS conexao_embed_url TEXT;
CREATE INDEX IF NOT EXISTS idx_radar_cred_conexao ON radar_credenciais (conexao_status) WHERE conexao_status = 'pendente';

-- Processos monitorados. Populado AUTOMATICAMENTE pela seleção (lib/radar/selecao),
-- que casa o perfil do usuário (UFs/categorias/termos/portfólio) com licitações
-- abertas. `origem='manual'` fica para exceções (fixar/adicionar à mão).
CREATE TABLE IF NOT EXISTS radar_processos (
  id            TEXT PRIMARY KEY,          -- uuid
  titular_id    TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  conector_id   TEXT NOT NULL REFERENCES radar_conectores(id),
  cnpj          TEXT NOT NULL,             -- CNPJ do fornecedor (conta que acompanha)
  licitacao_id  TEXT NOT NULL,             -- numero_controle_pncp (ou id do portal)
  titulo        TEXT,
  uf            TEXT,
  valor         NUMERIC,
  responsavel   TEXT,                      -- usuarios.id atribuído
  prioridade    TEXT NOT NULL DEFAULT 'normal',  -- alta|normal|baixa
  status        TEXT NOT NULL DEFAULT 'ativo',   -- ativo|encerrado|pausado
  origem        TEXT NOT NULL DEFAULT 'auto',    -- auto|manual
  mutado        BOOLEAN NOT NULL DEFAULT false,  -- silenciado (não captura/alerta)
  motivo_match  JSONB NOT NULL DEFAULT '{}'::jsonb, -- por que casou (termos/categorias/produtos)
  link_portal   TEXT,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (titular_id, conector_id, cnpj, licitacao_id)
);
CREATE INDEX IF NOT EXISTS idx_radar_proc_titular ON radar_processos (titular_id);
CREATE INDEX IF NOT EXISTS idx_radar_proc_cnpj    ON radar_processos (cnpj);
CREATE INDEX IF NOT EXISTS idx_radar_proc_ativo   ON radar_processos (status) WHERE status = 'ativo';

-- Mensagens normalizadas (modelo único) + dedup por hash + conteúdo bruto (raw).
CREATE TABLE IF NOT EXISTS radar_mensagens (
  id             BIGSERIAL PRIMARY KEY,
  msg_hash       TEXT NOT NULL,            -- sha256(conector|licitacao|autor|texto|horario)
  titular_id     TEXT NOT NULL,
  processo_id    TEXT NOT NULL REFERENCES radar_processos(id),
  conector_id    TEXT NOT NULL,
  cnpj           TEXT NOT NULL,
  licitacao_id   TEXT NOT NULL,
  autor          TEXT,
  texto          TEXT NOT NULL,
  anexos         JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{nome,url}]
  horario_origem TIMESTAMPTZ,             -- horário da mensagem no portal (se informado)
  capturado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw            JSONB,                    -- conteúdo bruto de origem (auditoria)
  categorias     TEXT[] NOT NULL DEFAULT '{}',
  prioridade     TEXT NOT NULL DEFAULT 'normal',
  lida           BOOLEAN NOT NULL DEFAULT false,
  lida_por       TEXT,
  lida_em        TIMESTAMPTZ,
  UNIQUE (msg_hash)
);
CREATE INDEX IF NOT EXISTS idx_radar_msg_titular  ON radar_mensagens (titular_id);
CREATE INDEX IF NOT EXISTS idx_radar_msg_processo ON radar_mensagens (processo_id);
CREATE INDEX IF NOT EXISTS idx_radar_msg_lida     ON radar_mensagens (titular_id, lida);
CREATE INDEX IF NOT EXISTS idx_radar_msg_capt     ON radar_mensagens (capturado_em DESC);

-- Regras: built-in globais (titular_id NULL) + palavras configuradas pelo usuário.
CREATE TABLE IF NOT EXISTS radar_regras (
  id         TEXT PRIMARY KEY,
  titular_id TEXT,                          -- NULL = built-in global
  user_id    TEXT,
  tipo       TEXT NOT NULL,                 -- convocacao|negociacao|proposta_ajustada|habilitacao|diligencia|recurso|prazo|cnpj|keyword|qualquer
  padrao     TEXT,                          -- regex/keyword (para 'keyword')
  prioridade TEXT NOT NULL DEFAULT 'normal',
  ativo      BOOLEAN NOT NULL DEFAULT true,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_radar_regras_titular ON radar_regras (titular_id);

-- Notificações (log de entrega/leitura/escalonamento). Dois eventos:
--   nova_mensagem  → alerta de chat de um processo monitorado (mensagem_id preenchido)
--   nova_licitacao → seleção automática achou licitação nova p/ o perfil (mensagem_id NULL)
CREATE TABLE IF NOT EXISTS radar_notificacoes (
  id              TEXT PRIMARY KEY,         -- uuid
  titular_id      TEXT NOT NULL,
  evento          TEXT NOT NULL DEFAULT 'nova_mensagem', -- nova_mensagem|nova_licitacao|escalonamento
  mensagem_id     BIGINT REFERENCES radar_mensagens(id), -- NULL em nova_licitacao
  processo_id     TEXT,
  destinatario    TEXT NOT NULL,            -- usuarios.id / e-mail
  canal           TEXT NOT NULL,            -- in_app|email|push
  assunto         TEXT,
  corpo           TEXT,
  link            TEXT,
  status          TEXT NOT NULL DEFAULT 'pendente',  -- pendente|enviado|entregue|falha
  tentativas      INT NOT NULL DEFAULT 0,
  enviado_em      TIMESTAMPTZ,
  confirmado_em   TIMESTAMPTZ,              -- leitura confirmada
  escalonado_em   TIMESTAMPTZ,             -- se não lida dentro do SLA
  escalonado_para TEXT,
  erro            TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_radar_notif_pendente ON radar_notificacoes (status) WHERE status = 'pendente';
CREATE INDEX IF NOT EXISTS idx_radar_notif_dest     ON radar_notificacoes (destinatario, status);

-- Saúde do conector (requisito 4.2): distingue "verificado OK" de "não deu p/ verificar".
-- `verificado_em` só avança em sync bem-sucedido; `tentado_em` marca toda tentativa.
CREATE TABLE IF NOT EXISTS radar_saude (
  credencial_id TEXT PRIMARY KEY REFERENCES radar_credenciais(id),
  titular_id    TEXT NOT NULL,
  conector_id   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'nunca_verificado',
    -- ok | sessao_expirada | portal_indisponivel | falha | captcha_2fa | nunca_verificado
  verificado_em TIMESTAMPTZ,               -- última verificação OK (sync bem-sucedido)
  tentado_em    TIMESTAMPTZ,              -- última tentativa (mesmo com falha)
  detalhe       TEXT,
  duracao_ms    INT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_radar_saude_titular ON radar_saude (titular_id);

-- Auditoria (append-only): captura, matches de regra, notificações, leituras, credenciais.
CREATE TABLE IF NOT EXISTS radar_auditoria (
  id          BIGSERIAL PRIMARY KEY,
  titular_id  TEXT,
  user_id     TEXT,
  acao        TEXT NOT NULL,               -- captura|regra_match|notificacao|leitura|escalonamento|cred_criada|cred_removida|selecao
  entidade    TEXT,
  entidade_id TEXT,
  detalhe     JSONB,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_radar_audit_titular ON radar_auditoria (titular_id, criado_em DESC);

-- Seed idempotente do primeiro conector.
INSERT INTO radar_conectores (id, nome) VALUES ('comprasgov', 'Compras.gov.br')
ON CONFLICT (id) DO NOTHING;
