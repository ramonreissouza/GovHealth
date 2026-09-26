// src/lib/radar/adicionar-pregao.ts — o "Adicionar pregão fora do perfil" do /radar.
//
// A leitura do link é de lib/radar/link-processo.mjs, que é JS puro para ser testável
// em Node contra os validadores do coletor. Aqui ela ganha o catálogo (quem o Radar lê)
// e o nome do portal que não temos, e é isto que a janela e a rota usam: a pessoa vê,
// enquanto cola, exatamente a resposta que o servidor vai dar.

import { lerLink } from './link-processo.mjs'
import { CONECTORES, LEITORES, nomeConector } from './conectores'
import { resolverPortal, nomePortal } from '@/lib/portais'

/** Nomes dos portais que algum coletor lê, na ordem do catálogo, sem o complemento
 *  ("BLL", não "BLL — Bolsa de Licitações e Leilões"): a lista tem de caber numa linha. */
export const PORTAIS_LIDOS: string[] = CONECTORES.filter((c) => LEITORES.includes(c.id)).map((c) => c.nome.split(' — ')[0])

export type LinkLido = ReturnType<typeof lerLink>

/** Nome do conector sem o complemento ("BLL", não "BLL — Bolsa de Licitações e Leilões"). */
export function nomeCurto(conectorId: string): string {
  return nomeConector(conectorId).split(' — ')[0]
}

// O catálogo de portais (lib/portais) e o de conectores nem sempre usam o mesmo id.
const CONECTOR_DO_PORTAL: Record<string, string> = { 'celic-rs': 'egovrs' }

/** O conector que LÊ o portal deste id do catálogo, ou null se nenhum lê. */
export function conectorDoPortal(portal: string): string | null {
  const id = CONECTOR_DO_PORTAL[portal] ?? portal
  return LEITORES.includes(id) || id === 'comprasgov' ? id : null
}

export function lerLinkDoRadar(texto: string): LinkLido {
  const lido = lerLink(texto, LEITORES)
  if (lido.tipo !== 'erro' || lido.motivo !== 'desconhecido') return lido
  // O host não é de nenhuma regra do Radar. Se o catálogo de portais reconhece o
  // endereço, dizer o nome ajuda mais que "não reconhecemos". Mas o catálogo conhece
  // domínios antigos de portais que lemos (bll.org.br, celic.rs.gov.br): para esses a
  // frase é "não é a página que lemos", nunca "não lemos o BLL".
  const portal = resolverPortal({ linkExterno: String(texto ?? '').trim() })
  if (portal === 'desconhecido') return lido
  const conector = conectorDoPortal(portal)
  return {
    ...lido,
    mensagem: conector
      ? `Este link do ${nomeCurto(conector)} não é a página de pregão que o Radar lê. Abra o pregão no portal e copie o endereço da página dele.`
      : `O Radar não lê o ${nomePortal(portal)}.`,
  }
}

/** O que acontece com o pregão depois de adicionado, dito antes do clique (requisito 4.2). */
export function oQueOAcompanhamentoFaz(conectorId: string): string {
  if (conectorId === 'comprasgov') {
    return 'O chat oficial abre dentro do pregão, aqui no Radar. O Radar não lê essas mensagens nem avisa sobre elas: o portal exige captcha e recusa navegador automatizado.'
  }
  // "Avisa você" dependia da saúde do portal e das notificações ligadas, e a janela não
  // sabe nenhuma das duas. A frase diz o que é certo e aponta onde ver o resto.
  const c = CONECTORES.find((x) => x.id === conectorId)
  const oQue = c?.leitura === 'chat' ? 'o chat' : 'o andamento publicado (avisos, documentos, prazos)'
  return `O Radar passa a ler ${oQue} deste pregão no ${nomeCurto(conectorId)}, sem login, a cada passada do coletor. Os avisos seguem as suas configurações, e a saúde do portal, no topo da tela, diz se a leitura está em dia.`
}
