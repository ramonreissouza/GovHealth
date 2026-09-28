/**
 * O QUE O FEED DE NOTIFICAÇÕES MOSTRA.
 *
 * "Nenhuma notificação ainda" só pode aparecer depois que a busca RESPONDEU. Antes da
 * primeira resposta a lista vazia é carregamento, não ausência (revisão da #49: com
 * `loadingFeed` começando em false, o vazio piscava num render entre a montagem e o fetch).
 *
 * @param {{ respondeu: boolean, carregando: boolean, total: number }} estado
 * @returns {'lista' | 'carregando' | 'vazio'}
 */
export function faseDoFeed({ respondeu, carregando, total }) {
  if (total > 0) return 'lista'
  if (!respondeu || carregando) return 'carregando'
  return 'vazio'
}
