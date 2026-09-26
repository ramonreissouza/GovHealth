import { compraPublica } from './comprasgov-publico.mjs'

/**
 * PORTAL QUE O RADAR SÓ MOSTRA, NÃO LÊ.
 *
 * Hoje é o Compras.gov.br, e só ele. Medido em 25/09/2026: a consulta pública abre o
 * painel de mensagens atrás de um hCaptcha e, com o desafio resolvido por uma pessoa,
 * recusa o navegador automatizado ("Não foi possível realizar a validação do Captcha
 * para retornar as compras"). No Chrome e no Norton Private Browser da mesma pessoa, na
 * mesma conexão, as mensagens abrem. O login do gov.br recusa do mesmo jeito
 * (ERL0000900). Disfarçar a automação seria contornar a proteção do portal, então o
 * Radar não lê esse chat: ele abre a PÁGINA OFICIAL dentro do pregão, no navegador da
 * própria pessoa, e diz com todas as letras que dali não sai alerta (requisito 4.2).
 *
 * Se um dia a integração oficial (API do Serpro) estiver lendo, a saúde do conector
 * `comprasgov` fica `ok` e tudo isto se desliga sozinho.
 *
 * @param {string} conectorId
 * @param {{ conectorId: string, status: string }[]} saude
 */
export function portalSoVisualizacao(conectorId, saude) {
  if (conectorId !== 'comprasgov') return false
  return !saude.some((s) => s.conectorId === 'comprasgov' && s.status === 'ok')
}

/**
 * O Radar LÊ o chat deste pregão? Decidido POR PREGÃO, e não por portal.
 *
 *   'lido'         → um coletor cobre este pregão
 *   'so_no_portal' → Compras.gov.br: o chat oficial abre embutido, sem leitura nem alerta
 *   'sem_leitor'   → nenhum coletor lê o portal deste pregão
 *
 * Por pregão porque a saúde do `comprasgov` não fala por todos os pregões dele: mesmo com
 * ela `ok` (integração oficial do Serpro, ou o modo assistido), só são lidos os cadastros
 * do próprio coletor, com `licitacao_id` = `comprasgov:<modo>:<chave>`. A seleção
 * automática grava o nº do PNCP, e nenhum coletor lê esses. Decidir pelo portal fazia o
 * aviso sumir de centenas de pregões não lidos no dia em que alguma compra desse `ok`
 * (segunda revisão, 25/09/2026).
 *
 * `conectorId` é quem CAPTURA; `portal` é onde a sessão roda (derivado do PNCP). A seleção
 * antiga pôs no `comprasgov` pregões que correm em outros portais: esses não são lidos
 * por ninguém e não viram quadro do Compras.gov.br.
 *
 * @param {{ conectorId?: string, portal: string, licitacaoId?: string | null }} processo
 * @param {{ conectorId: string, status: string }[]} saude
 * @param {Iterable<string>} leitores ids de conector que algum coletor lê (catálogo
 *   `CONECTORES` disponível, sem o `comprasgov`); vem de fora para este módulo continuar
 *   testável em Node puro, sem importar TypeScript.
 * @param {string} prefixoLido o `licitacao_id` que o coletor do modo em uso lê. Era
 *   `comprasgov:`, largo demais: as linhas do modo API (`comprasgov:producao:`) contariam
 *   como lidas pela saúde do modo público. O padrão é o modo público; quem liga o modo
 *   API passa `'comprasgov:producao:'`.
 * @returns {'lido' | 'so_no_portal' | 'sem_leitor'}
 */
export function situacaoLeitura(processo, saude, leitores = [], prefixoLido = 'comprasgov:publico:') {
  const naoLido = processo.portal === 'comprasgov' ? 'so_no_portal' : 'sem_leitor'
  if (processo.conectorId === 'comprasgov') {
    const doColetor = (processo.licitacaoId ?? '').startsWith(prefixoLido)
    return doColetor && !portalSoVisualizacao('comprasgov', saude) ? 'lido' : naoLido
  }
  return new Set(leitores).has(processo.conectorId ?? '') ? 'lido' : naoLido
}

/**
 * O chat deste pregão só pode ser visto na página oficial do Compras.gov.br? Se sim,
 * com que link.
 *
 * O link devolvido é SEMPRE o endereço oficial remontado por `compraPublica` a partir
 * da chave de 17 dígitos, nunca o texto que veio do banco. É ele que vai no `src` do
 * quadro, e a CSP (`frame-src` em next.config.js) só libera essa origem; um link de
 * outro domínio com `?compra=` no meio não vira nem quadro nem botão.
 *
 * @param {{ conectorId?: string, portal: string, licitacaoId?: string | null, linkOrigem?: string | null, linkPortal?: string | null }} processo
 * @param {{ conectorId: string, status: string }[]} saude
 * @param {Iterable<string>} leitores ver `situacaoLeitura`
 * @returns {{ link: string | null } | null} null quando não é caso de "só no portal"
 */
export function chatSoNoPortal(processo, saude, leitores = []) {
  if (situacaoLeitura(processo, saude, leitores) !== 'so_no_portal') return null
  const compra = compraPublica(processo.linkOrigem ?? '') ?? compraPublica(processo.linkPortal ?? '')
  return { link: compra?.url ?? null }
}
