// src/lib/features.ts
// Feature flags centrais. Reversível: flipar a constante reativa a feature em
// toda a app (sidebar, páginas e rotas de API).

// IA (Copiloto e Copiloto de Edital). O provedor é a Z.ai (GLM) — ver src/lib/llm.ts.
// Controlada por env (client-safe) para reversibilidade sem deploy de código:
//   NEXT_PUBLIC_IA_HABILITADA=on  → mostra as telas de IA e habilita as rotas.
// Além disso, as rotas só respondem se houver ZAI_API_KEY (senão retornam 503).
export const IA_HABILITADA = process.env.NEXT_PUBLIC_IA_HABILITADA === 'on'
