// src/app/api/copiloto/route.ts
// Copiloto IA com streaming — usa OpenAI + contexto de dados governamentais

import { OpenAI } from 'openai'
import { NextRequest, NextResponse } from 'next/server'
import { IA_HABILITADA } from '@/lib/features'

export const runtime = 'nodejs'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const SYSTEM_PROMPT = `Você é o GovHealth AI, copiloto de inteligência comercial para fornecedores de equipamentos e serviços para a saúde pública brasileira.

Você tem acesso em tempo real a dados dos seguintes sistemas governamentais:
- TransfereGov: convênios de saúde, repasses, emendas parlamentares
- PNCP (Portal Nacional de Contratações Públicas): editais, dispensas, pregões eletrônicos
- Portal da Transparência: contratos, fornecedores, valores pagos

Seu objetivo é ajudar a equipe comercial a:
1. Identificar oportunidades de venda antes da publicação do edital
2. Analisar concorrentes e suas estratégias de preço
3. Priorizar municípios e hospitais com maior probabilidade de compra
4. Entender o ciclo convênio → empenho → licitação → contrato

Diretrizes de resposta:
- Seja direto e acionável — dê recomendações concretas
- Use dados e números sempre que possível
- Destaque urgências e janelas temporais
- Mencione concorrentes quando relevante
- Formate listas como bullet points quando há múltiplos itens
- Responda sempre em português brasileiro
- Quando não tiver dados específicos, diga explicitamente e oriente como obter

Contexto adicional recebido: {context}`

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface RequestBody {
  messages: ChatMessage[]
  context?: {
    oportunidades?: number
    valorTotal?: number
    alertas?: number
    uf?: string
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!IA_HABILITADA) {
      return NextResponse.json(
        { error: 'Recurso de IA temporariamente desativado.' },
        { status: 503 },
      )
    }
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          error: 'OPENAI_API_KEY não configurada',
          instrucoes: 'Adicione OPENAI_API_KEY no .env.local',
        },
        { status: 401 }
      )
    }

    const body: RequestBody = await req.json()
    const { messages, context } = body

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages é obrigatório' }, { status: 400 })
    }

    // Monta contexto dinâmico com dados reais
    const contextStr = context
      ? `Dados atuais da plataforma: ${context.oportunidades ?? 0} oportunidades identificadas, valor total estimado R$${((context.valorTotal ?? 0) / 1_000_000).toFixed(1)}M, ${context.alertas ?? 0} alertas ativos. Estado filtrado: ${context.uf ?? 'Nacional'}.`
      : 'Dados nacionais sem filtro de estado.'

    const systemPrompt = SYSTEM_PROMPT.replace('{context}', contextStr)

    // Streaming response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini', // mais barato; trocar para gpt-4o para qualidade máxima
            messages: [
              { role: 'system', content: systemPrompt },
              ...messages.slice(-10), // últimas 10 mensagens para contexto
            ],
            stream: true,
            max_tokens: 800,
            temperature: 0.7,
          })

          for await (const chunk of completion) {
            const delta = chunk.choices[0]?.delta?.content ?? ''
            if (delta) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`))
            }
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (err) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: String(err) })}\n\n`
            )
          )
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    console.error('[copiloto]', error)
    return NextResponse.json(
      { error: 'Erro no copiloto', detalhe: String(error) },
      { status: 500 }
    )
  }
}
