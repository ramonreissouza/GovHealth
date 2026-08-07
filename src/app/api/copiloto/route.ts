// src/app/api/copiloto/route.ts
// Copiloto IA com streaming — usa OpenAI + contexto de dados governamentais

import { NextRequest, NextResponse } from 'next/server'
import { IA_HABILITADA } from '@/lib/features'
import { getLLM, hojeBR, LLM_MODEL, llmConfigurado } from '@/lib/llm'

export const runtime = 'nodejs'

const SYSTEM_PROMPT = `Você é o GovHealth AI, copiloto de inteligência comercial para fornecedores de equipamentos e serviços para a saúde pública brasileira.

HOJE É {hoje} ({hoje_iso}). Use SEMPRE esta data como presente — ela vale mais que
qualquer noção de tempo que você traga de treino. Regras que decorrem disso:
- NUNCA diga que um ano já em curso "ainda não chegou", que editais de {ano} "ainda
  não foram publicados" ou que seu conhecimento vai só até algum ano anterior.
- Ao calcular prazo, urgência ou "quanto falta", conte a partir de {hoje_iso}.
- "Este ano" = {ano}; "ano passado" = {ano_passado}.

A plataforma reúne dados destes sistemas, atualizados continuamente até hoje:
- PNCP (Portal Nacional de Contratações Públicas): editais, dispensas, pregões eletrônicos
- TransfereGov: convênios de saúde, repasses, emendas parlamentares
- Portal da Transparência: contratos, fornecedores, valores pagos

IMPORTANTE sobre o que VOCÊ enxerga: nesta conversa você NÃO recebe as linhas do
banco — só o contexto abaixo. A base existe e está cheia de dados de {ano}; quem
não os tem em mãos é você. Então, quando a pergunta pedir números específicos
(quais editais, de quem, por quanto), não responda que "não há dados" nem invente
valores: diga que o número exato está na plataforma e mande o usuário à tela certa
— Licitações (busca e filtros), Maior Atuação, Vencedores, Preços Ref., Radar de
Verba, Mapa — dizendo qual filtro aplicar. O raciocínio, a estratégia e a leitura
de mercado são com você.

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
    if (!llmConfigurado()) {
      return NextResponse.json(
        {
          error: 'Provedor de IA não configurado',
          instrucoes: 'Defina ZAI_API_KEY (chave da Z.ai) no ambiente.',
        },
        { status: 503 }
      )
    }

    // Instanciado aqui (não no topo do módulo) para não quebrar o build quando
    // a chave não existe no ambiente (IA desativada).
    const openai = getLLM()

    const body: RequestBody = await req.json()
    const { messages, context } = body

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages é obrigatório' }, { status: 400 })
    }

    // Monta contexto dinâmico com dados reais
    const contextStr = context
      ? `Dados atuais da plataforma: ${context.oportunidades ?? 0} oportunidades identificadas, valor total estimado R$${((context.valorTotal ?? 0) / 1_000_000).toFixed(1)}M, ${context.alertas ?? 0} alertas ativos. Estado filtrado: ${context.uf ?? 'Nacional'}.`
      : 'Dados nacionais sem filtro de estado.'

    // A data é resolvida a CADA requisição, não no topo do módulo: a instância da
    // função sobrevive a várias requisições (fluid compute) e uma data congelada na
    // inicialização iria envelhecendo silenciosamente enquanto o processo vive.
    const hoje = hojeBR()
    const systemPrompt = SYSTEM_PROMPT
      .replace('{hoje}', hoje.extenso)
      .replaceAll('{hoje_iso}', hoje.iso)
      .replaceAll('{ano}', String(hoje.ano))
      .replace('{ano_passado}', String(hoje.ano - 1))
      .replace('{context}', contextStr)

    // Streaming response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const completion = await openai.chat.completions.create({
            model: LLM_MODEL, // Z.ai GLM (padrão glm-4.7-flash, grátis)
            messages: [
              { role: 'system', content: systemPrompt },
              ...messages.slice(-10), // últimas 10 mensagens para contexto
            ],
            stream: true,
            max_tokens: 2000,
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
