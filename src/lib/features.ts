// src/lib/features.ts
// Feature flags centrais. Reversível: flipar a constante reativa a feature em
// toda a app (sidebar, páginas e rotas de API).

// IA (Copiloto e Copiloto de Edital) está DESATIVADA enquanto não há provedor
// de LLM definido — nenhuma chamada à OpenAI deve ser feita. Para reativar,
// defina o provedor/chave e troque para `true`.
export const IA_HABILITADA = false
