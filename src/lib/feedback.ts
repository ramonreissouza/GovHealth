// src/lib/feedback.ts — tipos e rótulos do "Reporte um problema" (suporte ao usuário).
// Módulo PURO (sem DB) — importável pelo widget (cliente), pela tela de admin e pela
// rota de API. A persistência fica em /api/feedback (tabela feedback_issues).

export type FeedbackTipo = 'bug' | 'sugestao' | 'duvida' | 'melhoria'
export type FeedbackSeveridade = 'baixa' | 'media' | 'alta' | 'critica'
export type FeedbackStatus =
  | 'novo'            // acabou de entrar no backlog
  | 'triado'          // classificado (agente de triagem)
  | 'em_analise'      // agente analisando/gerando solução
  | 'solucao_proposta'// solução/patch pronto p/ validação humana
  | 'aprovado'        // humano aceitou integrar
  | 'rejeitado'       // humano recusou
  | 'integrado'       // solução aplicada/deployada

export interface FeedbackContexto {
  url?: string
  rota?: string
  userAgent?: string
  viewport?: string
  plano?: string
  [k: string]: unknown
}

/** Saída do agente de triagem (Fase 2, passo 1 — Z.ai/heurística). */
export interface FeedbackAnalise {
  categoria?: string                    // ex.: 'ui', 'dados', 'auth', 'performance'
  componentes?: string[]                // arquivos/áreas prováveis
  severidadeSugerida?: FeedbackSeveridade
  resumo?: string
  triadoEm?: string
  modelo?: string                       // 'zai-glm' | 'heuristica'
}

/** Solução proposta pelo agente (Fase 2, passo 2 — Claude Code headless). */
export interface FeedbackSolucao {
  resumo?: string                       // 1 linha p/ o card
  diagnostico?: string                  // causa-raiz
  plano?: string                        // o que muda
  arquivos?: string[]                   // arquivos tocados
  diff?: string                         // git diff (unified)
  branch?: string                       // branch com a mudança
  risco?: 'baixo' | 'medio' | 'alto'
  geradoEm?: string
  modelo?: string                       // 'claude-code-headless' | 'stub'
  erro?: string                         // se a geração falhou
}

export interface FeedbackIssue {
  id: string
  criadoEm: string
  atualizadoEm: string
  userId?: string | null
  userEmail?: string | null
  userNome?: string | null
  empresa?: string | null
  plano?: string | null
  tipo: FeedbackTipo
  severidade: FeedbackSeveridade
  titulo: string
  descricao: string
  contexto: FeedbackContexto
  status: FeedbackStatus
  analise?: FeedbackAnalise | null
  solucao?: FeedbackSolucao | null
  jiraKey?: string | null
  resolvidoEm?: string | null
}

export const TIPO_LABEL: Record<FeedbackTipo, string> = {
  bug: 'Problema / bug',
  sugestao: 'Sugestão',
  duvida: 'Dúvida',
  melhoria: 'Melhoria',
}

export const SEVERIDADE_LABEL: Record<FeedbackSeveridade, string> = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
  critica: 'Crítica',
}

export const STATUS_LABEL: Record<FeedbackStatus, string> = {
  novo: 'Novo',
  triado: 'Triado',
  em_analise: 'Em análise',
  solucao_proposta: 'Solução proposta',
  aprovado: 'Aprovado',
  rejeitado: 'Rejeitado',
  integrado: 'Integrado',
}

export const TIPOS: FeedbackTipo[] = ['bug', 'sugestao', 'duvida', 'melhoria']
export const SEVERIDADES: FeedbackSeveridade[] = ['baixa', 'media', 'alta', 'critica']
export const STATUSES: FeedbackStatus[] = [
  'novo', 'triado', 'em_analise', 'solucao_proposta', 'aprovado', 'rejeitado', 'integrado',
]

export function isFeedbackTipo(v: unknown): v is FeedbackTipo {
  return typeof v === 'string' && (TIPOS as string[]).includes(v)
}
export function isFeedbackSeveridade(v: unknown): v is FeedbackSeveridade {
  return typeof v === 'string' && (SEVERIDADES as string[]).includes(v)
}
export function isFeedbackStatus(v: unknown): v is FeedbackStatus {
  return typeof v === 'string' && (STATUSES as string[]).includes(v)
}
