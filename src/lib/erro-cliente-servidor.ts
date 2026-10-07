// src/lib/erro-cliente-servidor.ts — o lado do servidor de /api/erro-cliente (TS-540):
// valida o que o navegador mandou e decide o que pode ir para o SigNoz.
//
// O endpoint é público, então o corpo é texto de qualquer um. Duas regras:
// - Tudo passa por `redigir` antes de virar telemetria: erro real costuma carregar
//   e-mail, URL com parâmetro, token.
// - Sem sessão, guarda só a mensagem normalizada (sem número nem texto entre aspas)
//   e nenhuma stack. Quem não está logado não consegue gravar texto arbitrário no
//   SigNoz, e os erros iguais da landing e do login continuam agrupáveis pelo
//   `erro.fingerprint`.

import { createHash } from 'node:crypto'
import type { Attributes } from '@opentelemetry/api'
import { redigir } from './redigir.mjs'
import type { ErroSerializado } from './rastreio'

export const TETO_CORPO = 16_000
const TIPOS = new Set(['render', 'global', 'janela', 'promessa'])

export type ErroClienteRecebido = {
  tipo: string
  nome: string
  mensagem: string
  stack?: string
  digest?: string
  rota: string
}

function texto(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v ? v.slice(0, max) : undefined
}

/** O corpo cru do POST, validado. `null` quando não serve (vira 400). */
export function lerErroCliente(corpo: string): ErroClienteRecebido | null {
  if (!corpo || corpo.length > TETO_CORPO) return null
  let dados: unknown
  try { dados = JSON.parse(corpo) } catch { return null }
  // `JSON.parse` aceita `null`, número, string e array sem lançar.
  if (dados === null || typeof dados !== 'object' || Array.isArray(dados)) return null
  const d = dados as Record<string, unknown>

  const tipo = texto(d.tipo, 20)
  const mensagem = texto(d.mensagem, 500)
  if (!tipo || !TIPOS.has(tipo) || !mensagem) return null

  const nome = texto(d.nome, 60)
  const digest = texto(d.digest, 20)
  return {
    tipo,
    // Nome de classe de erro (TypeError, ChunkLoadError). Qualquer outra coisa é texto livre.
    nome: nome && /^[A-Za-z_$][\w$]*$/.test(nome) ? nome : 'Error',
    mensagem,
    stack: texto(d.stack, 4000),
    digest: digest && /^[\w-]+$/.test(digest) ? digest : undefined,
    rota: (texto(d.rota, 200) ?? '').split(/[?#]/)[0],
  }
}

/** Sem número nem texto entre aspas: o que sobra é a "forma" do erro. */
export function normalizarMensagem(mensagem: string): string {
  return redigir(mensagem)
    .replace(/(["'`]).*?\1/g, '$1…$1')
    .replace(/\d+/g, '#')
    .slice(0, 200)
}

/** O que vai para `registrarErro`: a exceção e os atributos, já redigidos. */
export function prepararErroCliente(
  e: ErroClienteRecebido,
  comSessao: boolean,
): { excecao: ErroSerializado; atributos: Attributes } {
  const normalizada = normalizarMensagem(e.mensagem)
  const fingerprint = createHash('sha256').update(`${e.tipo}|${e.nome}|${normalizada}`).digest('hex').slice(0, 16)
  return {
    excecao: comSessao
      ? { name: e.nome, message: redigir(e.mensagem), stack: e.stack && redigir(e.stack) }
      : { name: e.nome, message: normalizada },
    atributos: {
      'erro.tipo': e.tipo,
      'erro.sessao': comSessao,
      'erro.fingerprint': fingerprint,
      'url.path': redigir(e.rota),
      ...(e.digest ? { 'erro.digest': e.digest } : {}),
    },
  }
}
