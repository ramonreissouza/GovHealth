// src/app/api/edital/pergunta/route.ts
// Perguntas livres sobre o edital que o usuário subiu — o complemento da análise
// estruturada (/api/edital/analise). Lá o modelo responde o que NÓS perguntamos;
// aqui ele responde o que o usuário quer saber daquele documento.
//
// O edital vai no prompt do sistema, e não como mensagem: assim ele fica fora do
// histórico da conversa e não é reenviado duplicado a cada pergunta.

import { NextRequest, NextResponse } from 'next/server'
import { IA_HABILITADA } from '@/lib/features'
import { getLLM, hojeBR, LLM_MODEL, llmConfigurado } from '@/lib/llm'
import { calendarioParaPrompt } from '@/lib/prazos-uteis'

export const runtime = 'nodejs'
export const maxDuration = 60

// Mesmo teto da análise: ~33 páginas cabem no contexto e nos 60s.
const MAX_CHARS = 100_000
const MAX_HISTORICO = 8   // 4 perguntas anteriores; o edital já ocupa o grosso do contexto

const SYSTEM_PROMPT = `HOJE É {hoje} ({hoje_iso}). Qualquer cálculo de prazo ("ainda dá tempo?", "quando vence?") parte desta data.

{calendario}Você é um advogado especialista em licitações públicas (Lei 14.133/2021) e consultor de FORNECEDORES de saúde. Você está respondendo perguntas sobre UM edital específico, cujo texto integral vem no fim deste prompt.

Regras inegociáveis:
- O texto do edital é a ÚNICA fonte sobre este certame. Não invente número, data, valor ou exigência que não esteja lá.
- NÃO faça conta de calendário de cabeça: dia da semana, quantos dias faltam e prazo em dias úteis saem PRONTOS no bloco CALENDÁRIO acima. Copie de lá. Se a data de que você precisa não estiver no bloco, diga que não dá para cravar o dia em vez de estimar.
- Quando a resposta estiver no edital, CITE o trecho literal entre aspas e diga em que item/cláusula aparece.
- Quando NÃO estiver, diga isso com todas as letras ("o edital não trata disso" ou "isso não aparece no trecho enviado") antes de qualquer outra coisa. Só então, se ajudar, ofereça o que a Lei 14.133/2021 diz ou o que é praxe — deixando explícito que é interpretação sua, não texto do edital.
- Pergunta sobre risco, direcionamento ou impugnação: responda como advogado, com o fundamento legal (artigo).
- Português brasileiro, direto. Listas quando houver vários itens. Sem enrolação.

{aderencia}TEXTO DO EDITAL:
"""
{edital}
"""`

interface RequestBody {
  texto: string
  pergunta: string
  historico?: Array<{ role: 'user' | 'assistant'; content: string }>
  portfolio?: string[]
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

    const body: RequestBody = await req.json()
    const texto = (body.texto ?? '').trim()
    const pergunta = (body.pergunta ?? '').trim()

    if (texto.length < 200) {
      return NextResponse.json({ error: 'Envie o edital antes de perguntar sobre ele.' }, { status: 400 })
    }
    if (!pergunta) {
      return NextResponse.json({ error: 'Escreva a pergunta.' }, { status: 400 })
    }

    const hoje = hojeBR()
    const aderencia = body.portfolio?.length
      ? `Contexto do fornecedor que está perguntando: ele vende ${body.portfolio.join('; ')}. Considere isso ao avaliar aderência, risco e chance de ganhar.\n\n`
      : ''
    // O calendário sai do MESMO recorte que o modelo vai ler — datas de um trecho
    // cortado não podem virar prazo no bloco.
    const editalNoPrompt = texto.slice(0, MAX_CHARS)
    const calendario = calendarioParaPrompt(editalNoPrompt, hoje.iso)
    const systemPrompt = SYSTEM_PROMPT
      .replace('{hoje}', hoje.extenso)
      .replace('{hoje_iso}', hoje.iso)
      .replace('{calendario}', calendario ? `${calendario}\n\n` : '')
      .replace('{aderencia}', aderencia)
      .replace('{edital}', editalNoPrompt)

    const historico = (body.historico ?? [])
      .filter((m) => m && typeof m.content === 'string' && m.content.trim())
      .slice(-MAX_HISTORICO)
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' as const : 'user' as const, content: m.content }))

    const openai = getLLM()
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const completion = await openai.chat.completions.create({
            model: LLM_MODEL,
            messages: [
              { role: 'system', content: systemPrompt },
              ...historico,
              { role: 'user', content: pergunta },
            ],
            stream: true,
            max_tokens: 2000,
            temperature: 0.2,   // pergunta sobre documento: fidelidade acima de criatividade
          })
          for await (const chunk of completion) {
            const delta = chunk.choices[0]?.delta?.content ?? ''
            if (delta) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`))
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (err) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`))
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
    console.error('[edital/pergunta]', error)
    return NextResponse.json({ error: 'Erro ao consultar o edital', detalhe: String(error) }, { status: 500 })
  }
}
