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

/** Metadados de um anexo (sem os bytes — o conteúdo é servido por /api/feedback/anexo/[id]). */
export interface FeedbackAnexo {
  id: string
  nome: string
  mime: string
  tamanho: number
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
  anexos?: FeedbackAnexo[]
}

// ── Anexos: limites e tipos aceitos (compartilhados entre widget, API e admin) ──
// Cap total conservador p/ caber no limite de corpo de request da Vercel (~4,5 MB).
export const ANEXO_MAX_ARQUIVOS = 3
export const ANEXO_MAX_BYTES = 4 * 1024 * 1024        // por arquivo
export const ANEXO_MAX_TOTAL_BYTES = 4 * 1024 * 1024  // somatório do envio
export const ANEXO_MIMES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'text/plain': 'txt',
  'application/pdf': 'pdf',
}
export const ANEXO_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.txt,.pdf'

export function isAnexoMimePermitido(mime: string): boolean {
  return Object.prototype.hasOwnProperty.call(ANEXO_MIMES, mime)
}

/** KB/MB legível para rótulos de UI. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
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
