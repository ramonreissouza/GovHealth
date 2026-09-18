// src/lib/chart-tooltip.ts — o tooltip do recharts, no tema do produto.
//
// POR QUE ISTO EXISTE (2026-09-16)
//
// O tooltip do recharts não herda nada do tema. Os padrões dele são:
//   contentStyle → fundo BRANCO, borda #ccc
//   itemStyle    → color '#000', trocado pela cor da série quando ela existe
//   labelStyle   → {} — nenhuma cor, nenhuma
//
// O `labelStyle` vazio é a armadilha: sem cor própria, o rótulo herda a cor de
// texto da PÁGINA (--text, #0f172a). Enquanto o contentStyle do dashboard ainda
// era o do tema escuro (#1a1a2e, de antes da virada para o tema claro), o
// resultado era caixa escura + rótulo quase preto: o nome da categoria
// desaparecia dentro da própria caixa que deveria mostrá-lo.
//
// Dá para errar isso de novo facilmente — os dois gráficos do dashboard
// dividiam o mesmo `contentStyle`, mas só UM tinha `labelStyle`. Por isso os
// três estilos saem daqui juntos, como um pacote espalhável:
//
//   <Tooltip {...TOOLTIP_TEMA} formatter={…} />
//
// Quem espalhar leva o rótulo legível junto, sem ter de lembrar.

export const TOOLTIP_TEMA = {
  contentStyle: {
    background: 'var(--bg2)',
    border: '1px solid var(--border2)',
    borderRadius: 8,
    padding: '6px 9px',
    fontSize: 11,
    color: 'var(--text)',
    boxShadow: '0 4px 16px -4px rgba(15, 23, 42, 0.18)',
  },
  // O rótulo é a identidade da fatia (o nome da categoria, o mês). É o que o
  // usuário foi buscar ao passar o mouse, então é ele que recebe o peso.
  labelStyle: {
    color: 'var(--text)',
    fontWeight: 600,
    marginBottom: 2,
  },
  // Sem isto o item sai na cor da série — que, num tema claro, pode ser um
  // slate #94a3b8 sobre branco. Legibilidade antes de decoração: a cor da
  // série já está no gráfico, a três centímetros do cursor.
  itemStyle: {
    color: 'var(--text2)',
    paddingTop: 1,
    paddingBottom: 1,
  },
} as const
