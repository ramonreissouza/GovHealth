// src/lib/pagometro-texto.ts — tipos e frases do Pagômetro, sem nada de servidor: o selo
// (componente de cliente) importa daqui. A carga do índice fica em src/lib/pagometro.ts.

export type FaixaPagometro = 'rapido' | 'medio' | 'lento'

/** O que vai para a tela (serializável). */
export interface PagometroInfo {
  dias: number
  /** true quando o número é só das compras da Saúde (função 10) desse ente. */
  saude: boolean
  faixa: FaixaPagometro
  /** "Salvador/BA" ou "Governo do estado (BA)": quem paga, dito com todas as letras. */
  pagador: string
  meses: number
  inicio: string | null
  fim: string | null
  /** De onde vem o número: a contabilidade do ente (Siconfi/MSC, municípios e estados) ou
   *  os pagamentos do Portal da Transparência (Unidades Gestoras federais). */
  fonte?: 'siconfi' | 'portal'
}

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesAno = (d: string | null) => (d ? `${MES[Number(d.slice(5, 7)) - 1]}/${d.slice(0, 4)}` : '')

/** "~9 dias" ou "<1 dia". */
export function diasCurto(dias: number): string {
  if (dias < 1) return '<1 dia'
  const n = Math.round(dias)
  return `~${n} ${n === 1 ? 'dia' : 'dias'}`
}

/** O que cabe no selo: "~9d" ou "<1d". */
export function diasSelo(dias: number): string {
  return dias < 1 ? '<1d' : `~${Math.round(dias)}d`
}

/**
 * A frase completa do selo. Diz o que é medido e o que NÃO é — a ressalva faz parte
 * do número, não é nota de rodapé.
 */
export function textoPagometro(p: PagometroInfo): string {
  const oQue = p.saude ? 'fornecedores da Saúde' : 'fornecedores'
  const fonte = p.fonte === 'portal'
    ? 'pelos pagamentos registrados no Portal da Transparência (CGU)'
    : 'pela contabilidade que o ente entrega ao Tesouro (Siconfi/MSC)'
  const base = p.inicio && p.fim
    ? `Média de ${mesAno(p.inicio)} a ${mesAno(p.fim)}, ${fonte}.`
    : `Calculado ${fonte}.`
  return `${p.pagador}: depois de reconhecer a nota (liquidação), paga ${oQue} em ${diasCurto(p.dias)}. `
    + `${base} Não inclui o tempo até o órgão atestar a entrega.`
}
