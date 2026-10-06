// src/lib/rastreio.ts — erros e trechos medidos que vão para o SigNoz (TS-540).
//
// Só usa a API do OpenTelemetry, nunca o SDK. Sem o SDK ligado (src/lib/otel.mjs:
// dev, Vercel, testes), cada chamada aqui é no-op e custa quase nada.
//
// Um erro vira um span com status ERROR e um evento `exception`. É desse evento que
// o SigNoz monta a aba Exceptions, e dele que saem os alertas de taxa de erro.

import { SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api'

const tracer = trace.getTracer('govhealth')

export type ErroSerializado = { name?: string; message: string; stack?: string }

function marcarErro(span: Span, erro: unknown): void {
  const excecao: ErroSerializado = erro instanceof Error
    ? erro
    : erro && typeof erro === 'object' && typeof (erro as ErroSerializado).message === 'string'
      ? (erro as ErroSerializado)
      : { name: 'Error', message: String(erro) }
  span.recordException(excecao)
  span.setStatus({ code: SpanStatusCode.ERROR, message: excecao.message })
}

/** Registra um erro como span próprio, filho do span ativo quando houver um. */
export function registrarErro(nome: string, erro: unknown, atributos: Attributes = {}): void {
  tracer.startActiveSpan(nome, { attributes: atributos }, (span) => {
    marcarErro(span, erro)
    span.end()
  })
}

/**
 * Roda `fn` dentro de um span. O que acontecer lá dentro (queries, fetch) fica
 * pendurado nele, e um erro lançado marca o span e segue adiante.
 */
export async function comSpan<T>(nome: string, fn: () => Promise<T>, atributos: Attributes = {}): Promise<T> {
  return tracer.startActiveSpan(nome, { attributes: atributos }, async (span) => {
    try {
      return await fn()
    } catch (erro) {
      marcarErro(span, erro)
      throw erro
    } finally {
      span.end()
    }
  })
}
