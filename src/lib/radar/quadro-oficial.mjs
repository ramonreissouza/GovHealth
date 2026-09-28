/**
 * O QUE O QUADRO DO CHAT OFICIAL MOSTRA, EM CADA FASE.
 *
 * O `load` do iframe NÃO prova que a página do Compras.gov.br abriu: o navegador o dispara
 * também quando a navegação falha, quando o portal recusa ser embutido (X-Frame-Options /
 * frame-ancestors) ou quando termina numa página de erro, e a origem é outra, então o Radar
 * não pode olhar dentro (revisão da #48). Por isso `load` só tira a CAMADA de carregamento;
 * a saída ("Abrir em outra aba") fica à vista depois dele, para sempre, porque o Radar não
 * tem como saber se o quadro ficou em branco.
 *
 * Enquanto a camada está visível ela CAPTURA os cliques: com `pointer-events: none` o
 * clique passava para o iframe escondido por baixo, e a pessoa acionaria algo que não vê.
 *
 * @param {{ carregou: boolean, passouDoTempo: boolean }} estado
 * @returns {{ camada: boolean, avisoDemora: boolean, rodapeSaida: boolean }}
 */
export function fasesDoQuadro({ carregou, passouDoTempo }) {
  return {
    camada: !carregou,
    avisoDemora: !carregou && passouDoTempo,
    rodapeSaida: carregou,
  }
}
