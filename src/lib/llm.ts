// src/lib/llm.ts — provedor de LLM (Z.ai / GLM, compatível com a API da OpenAI).
// Server-only. Reaproveita o SDK `openai` apontando o baseURL para a Z.ai.
//
// Env:
//   ZAI_API_KEY   (obrigatória p/ a IA funcionar) — chave da conta Z.ai
//   ZAI_MODEL     (opcional) — modelo GLM; padrão glm-4.7-flash (grátis)
//   ZAI_BASE_URL  (opcional) — endpoint OpenAI-compatível da Z.ai

import { OpenAI } from 'openai'

// Endpoint OpenAI-compatível da Z.ai. É o /api/paas/v4 (o SDK anexa /chat/completions).
const ZAI_BASE_URL = process.env.ZAI_BASE_URL ?? 'https://api.z.ai/api/paas/v4'

/** Modelo GLM usado nas chamadas. glm-4.5-flash é do plano gratuito. */
export const LLM_MODEL = process.env.ZAI_MODEL ?? 'glm-4.5-flash'

/** Há provedor de LLM configurado (chave da Z.ai presente)? */
export function llmConfigurado(): boolean {
  return !!process.env.ZAI_API_KEY
}

/**
 * Cliente OpenAI-compatível apontando para a Z.ai. Instancie sob demanda (não no
 * topo do módulo) para o build não exigir a chave. Lança se a chave faltar.
 */
export function getLLM(): OpenAI {
  const apiKey = process.env.ZAI_API_KEY
  if (!apiKey) throw new Error('ZAI_API_KEY não configurada')
  return new OpenAI({ apiKey, baseURL: ZAI_BASE_URL })
}
