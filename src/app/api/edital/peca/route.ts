// src/app/api/edital/peca/route.ts
// Peças jurídicas além da impugnação (que sai junto da análise, em /api/edital/analise):
// pedido de esclarecimento, recurso e contrarrazões. O prazo e a lista de artigos saem
// prontos de lib/pecas-juridicas.ts; o modelo só redige.

import { NextRequest, NextResponse } from 'next/server'
import { IA_HABILITADA } from '@/lib/features'
import { getLLM, hojeBR, LLM_MODEL, llmConfigurado } from '@/lib/llm'
import {
  normalizarPeca, prazoDaPeca, promptDaPeca, sanearEntrada, validarEntrada,
  type EntradaPeca, type PrazoPeca,
} from '@/lib/pecas-juridicas'

export const runtime = 'nodejs'
// Medido com o GLM gratuito: 47 s (esclarecimento) a 100 s (recurso). A peça é longa
// e o modelo escreve devagar; 60 s cortaria o recurso no meio.
export const maxDuration = 300

// Mesma defesa da análise: modelos às vezes cercam o JSON com ```json ou texto.
function extrairJson(s: string): string {
  const t = s.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const i = t.indexOf('{')
  const j = t.lastIndexOf('}')
  return i >= 0 && j > i ? t.slice(i, j + 1) : t
}

export async function POST(req: NextRequest) {
  try {
    if (!IA_HABILITADA) {
      return NextResponse.json({ error: 'Recurso de IA temporariamente desativado.' }, { status: 503 })
    }
    if (!llmConfigurado()) {
      return NextResponse.json(
        { error: 'Provedor de IA não configurado', instrucoes: 'Defina ZAI_API_KEY (chave da Z.ai) no ambiente.' },
        { status: 503 },
      )
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 })
    const parcial = sanearEntrada(body as Record<string, unknown>)
    const invalido = validarEntrada(parcial)
    if (invalido) return NextResponse.json({ error: invalido }, { status: 400 })
    const entrada = parcial as EntradaPeca
    // AAAA-MM-DD: abertura (esclarecimento), ata/intimação (recurso) ou divulgação do recurso (contrarrazões).
    const dataBase = typeof (body as { dataBase?: unknown }).dataBase === 'string' ? (body as { dataBase: string }).dataBase : ''

    // Resolvida por requisição: a instância da função vive além de um dia.
    const hoje = hojeBR()
    let prazo: PrazoPeca | null = null
    if (dataBase) {
      const p = prazoDaPeca(entrada.tipo, dataBase, hoje.iso)
      if ('erro' in p) return NextResponse.json({ error: p.erro }, { status: 400 })
      prazo = p
    }

    const { system, user } = promptDaPeca(entrada, prazo, hoje)
    const completion = await getLLM().chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 6000,
      temperature: 0.2,
    })

    const raw = completion.choices[0]?.message?.content ?? '{}'
    let bruto: unknown
    try {
      bruto = JSON.parse(extrairJson(raw))
    } catch {
      return NextResponse.json({ error: 'A resposta da IA não pôde ser lida. Tente gerar de novo.' }, { status: 502 })
    }
    const peca = normalizarPeca(entrada.tipo, bruto, prazo)
    if (!peca) {
      return NextResponse.json({ error: 'A IA devolveu uma peça incompleta. Tente gerar de novo.' }, { status: 502 })
    }
    return NextResponse.json({ peca })
  } catch (error) {
    console.error('[edital/peca]', error)
    return NextResponse.json({ error: 'Erro ao gerar a peça', detalhe: String(error) }, { status: 500 })
  }
}
