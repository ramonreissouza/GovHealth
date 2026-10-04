// src/lib/radar/entrega.ts — decide COMO cada alerta de e-mail do Radar sai: na hora,
// sozinho, ou dentro do resumo do dia. Módulo puro (sem banco), testado em
// scripts/radar/entrega.teste.ts.
//
// POR QUE EXISTE (medido em 02/10/2026, banco da VM Oracle, 14 dias)
//
// A captura enfileira um e-mail por mensagem de chat. Ninguém entregava a fila (o
// radar-notify nunca foi agendado), e ela juntou 25.049 pendentes. Ligar a entrega como
// estava daria 81 e-mails por dia a cada destinatário, com pico de 275 num dia só.
//
// Filtrar por categoria não salva: "convocação + prazo + diligência" ainda dava 35 por dia,
// e as convocações lidas eram quase todas de OUTRAS empresas ("convoco a empresa D. GOMES
// DA SILVA…"). O Radar segue pregões escolhidos pelo perfil, não pregões em que o cliente
// dá lance. Convocação de terceiro é informação; só a do próprio cliente tem prazo dele.
//
// Então: sai NA HORA só o que fala da empresa do cliente (CNPJ ou razão social no texto),
// ou o que é urgente num pregão em que ele está: marcado como "Estou participando" ou
// adicionado à mão ao Radar (origem 'manual'). Todo o resto vai num resumo único por dia.

import { normalizeKey } from '../text'

/** Mais velho que isto na fila não sai mais: chegaria como notícia velha. */
export const JANELA_FILA_H = 48

/**
 * Aviso IMEDIATO só enquanto é notícia. Depois de um tempo parado na fila (worker fora,
 * chave de e-mail ausente), a convocação vai para o resumo: chegar dois dias depois
 * com cara de "nova mensagem" faria o cliente correr atrás de um prazo que já passou.
 */
export const IMEDIATO_MAX_H = 6

export type Entrega = 'agora' | 'resumo'

/** Quem é o cliente, para reconhecer quando o chat fala dele. */
export interface AlvoEmpresa {
  cnpj?: string | null
  /** Razão social (do PNCP) e nome cadastrado na conta. Vazios são ignorados. */
  nomes: (string | null | undefined)[]
}

/** normalizeKey (sem acento, maiúsculas) + só letras e dígitos separados por um espaço, com bordas. */
function normalizar(s: string | null | undefined): string {
  return ` ${normalizeKey(String(s ?? '')).replace(/[^A-Z0-9]+/g, ' ').trim()} `
}

// Um CNPJ escrito como CNPJ: 14 dígitos seguidos, ou com a pontuação de sempre, sem
// dígito colado antes nem depois. Juntar TODOS os dígitos da mensagem (como fazia a
// primeira versão) deixava "processo 12345678, item 0001-90" virar um CNPJ.
const CNPJ_NO_TEXTO = /(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/g

// Sufixo societário no FIM do nome: "REMORA PRODUTOS PARA SAUDE EIRELI" e "REMORA
// PRODUTOS PARA SAUDE LTDA" são a mesma empresa no chat.
const SUFIXO = /( (LTDA|LIMITADA|EIRELI|ME|EPP|MEI|SA|S A|SS|CIA))+ $/

// Palavras que não identificam ninguém. Um nome feito só delas ("COMERCIO DE PRODUTOS
// HOSPITALARES") casaria com metade dos chats de saúde.
const GENERICAS = new Set([
  'DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'EM', 'PARA', 'A', 'O',
  'COMERCIO', 'COMERCIAL', 'SERVICOS', 'SERVICO', 'PRODUTOS', 'PRODUTO', 'INDUSTRIA',
  'DISTRIBUIDORA', 'DISTRIBUICAO', 'IMPORTACAO', 'EXPORTACAO', 'IMPORTADORA',
  'HOSPITALAR', 'HOSPITALARES', 'MEDICO', 'MEDICOS', 'MEDICA', 'MEDICAS', 'SAUDE',
  'EQUIPAMENTOS', 'MATERIAIS', 'MATERIAL', 'ASSESSORIA', 'ADMINISTRATIVA', 'GRUPO', 'BRASIL',
])

/**
 * O pedaço do nome que dá para procurar no texto, ou null quando o nome não serve
 * (curto ou genérico demais). Exige duas palavras e ao menos uma que não seja genérica:
 * "SIEMENS" sozinho fica de fora, "SIEMENS HEALTHCARE DIAGNOSTICOS" entra.
 */
export function nucleoNome(nome: string | null | undefined): string | null {
  const n = normalizar(nome).replace(SUFIXO, ' ').trim()
  const toks = n.split(' ').filter(Boolean)
  if (toks.length < 2) return null
  if (!toks.some((t) => t.length >= 4 && !GENERICAS.has(t) && !/^\d+$/.test(t))) return null
  return ` ${toks.join(' ')} `
}

/** O texto cita o cliente: o CNPJ dele escrito como CNPJ, ou o núcleo de um dos nomes. */
export function mencionaEmpresa(texto: string | null | undefined, alvo: AlvoEmpresa): boolean {
  if (!texto) return false
  const cnpj = String(alvo.cnpj ?? '').replace(/\D+/g, '')
  if (cnpj.length === 14 && [...texto.matchAll(CNPJ_NO_TEXTO)].some((m) => m[0].replace(/\D+/g, '') === cnpj)) return true
  const t = normalizar(texto)
  return alvo.nomes.some((nome) => {
    const nuc = nucleoNome(nome)
    return nuc != null && t.includes(nuc)
  })
}

/** Uma notificação de e-mail como a fila a entrega (evento + mensagem + processo). */
export interface NotificacaoParaEntrega {
  evento: string
  texto: string | null
  prioridade: string | null
  /** radar_processos.origem: 'manual' quando o próprio cliente adicionou o pregão. */
  origem: string | null
  /** radar_processos.participando: o cliente marcou que entrou neste pregão. */
  participando?: boolean | null
  /** Horas desde que entrou na fila. Ausente = recém-chegada. */
  idadeHoras?: number | null
}

export function entregaDe(n: NotificacaoParaEntrega, alvo: AlvoEmpresa): Entrega {
  // Licitação nova para o perfil nunca tem prazo de horas: o resumo basta.
  if (n.evento !== 'nova_mensagem') return 'resumo'
  if ((n.idadeHoras ?? 0) > IMEDIATO_MAX_H) return 'resumo'
  if (mencionaEmpresa(n.texto, alvo)) return 'agora'
  const dele = n.participando === true || n.origem === 'manual'
  if (dele && n.prioridade === 'alta') return 'agora'
  return 'resumo'
}
