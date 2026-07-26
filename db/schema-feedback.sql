-- db/schema-feedback.sql — "Reporte um problema" / suporte ao usuário.
-- Backlog interno de issues reportados pelo widget de chat. É a fila que o agente de
-- triagem/resolução (Fases 2-3) consome. Idempotente.

CREATE TABLE IF NOT EXISTS feedback_issues (
  id            text PRIMARY KEY,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),

  -- quem reportou (snapshot — a conta pode mudar depois)
  user_id       text,
  user_email    text,
  user_nome     text,
  empresa       text,
  plano         text,

  -- o problema
  tipo          text NOT NULL DEFAULT 'bug',       -- bug | sugestao | duvida | melhoria
  severidade    text NOT NULL DEFAULT 'media',     -- baixa | media | alta | critica
  titulo        text NOT NULL,
  descricao     text NOT NULL DEFAULT '',
  contexto      jsonb NOT NULL DEFAULT '{}'::jsonb, -- url, userAgent, viewport, plano…

  -- ciclo de vida no backlog
  status        text NOT NULL DEFAULT 'novo',      -- novo|triado|em_analise|solucao_proposta|aprovado|rejeitado|integrado
  analise       jsonb,                             -- saída do agente de triagem (Fase 2)
  solucao       jsonb,                             -- solução/patch proposto (Fase 2-3)
  jira_key      text,                              -- espelho no Jira (Fase 4)
  resolvido_em  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback_issues (status);
CREATE INDEX IF NOT EXISTS idx_feedback_criado ON feedback_issues (criado_em DESC);
