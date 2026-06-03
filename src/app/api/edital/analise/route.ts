// src/app/api/edital/analise/route.ts
// Copiloto de Edital — recebe o texto do edital/TR e devolve uma análise
// estruturada (specs, habilitação, prazos, cláusulas restritivas, recomendações)
// usando OpenAI em JSON mode. O PDF é extraído no cliente (lib/pdf.ts).

import { OpenAI } from 'openai'
import { NextRequest, NextResponse } from 'next/server'
import type { AnaliseEdital } from '@/lib/types'
import { IA_HABILITADA } from '@/lib/features'

export const runtime = 'nodejs'
export const maxDuration = 60

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// Limita o texto enviado ao modelo (controle de custo/contexto). ~48k chars ≈ edital típico.
const MAX_CHARS = 48_000

const SYSTEM_PROMPT = `Você é um especialista em licitações públicas de saúde no Brasil (Lei 14.133/2021) que assessora FORNECEDORES de equipamentos, medicamentos, OPME e serviços de saúde.

Analise o EDITAL/Termo de Referência fornecido e extraia informações acionáveis para o time comercial decidir se e como participar. Seja específico e cite trechos quando possível.

Atenção especial a CLÁUSULAS RESTRITIVAS / possível DIRECIONAMENTO: exigências de marca específica sem "ou similar", especificações que apontam para um único fabricante, atestados de capacidade técnica desproporcionais, prazos de entrega inexequíveis, exigências de amostra/visita técnica restritivas. Classifique a severidade (alta/media/baixa).

Responda SOMENTE com um objeto JSON válido, sem markdown, neste formato exato:
{
  "resumo": "2-3 frases do que é a licitação",
  "objeto": "objeto da contratação",
  "orgao": "órgão comprador ou null",
  "modalidade": "pregão eletrônico/dispensa/concorrência ou null",
  "valorEstimado": "valor como texto ou 'não informado'",
  "especificacoes": ["spec técnica exigida 1", "..."],
  "habilitacao": ["documento de habilitação exigido 1", "..."],
  "prazos": [{"rotulo":"ex: Sessão de disputa","data":"texto/data","observacao":"opcional"}],
  "penalidades": ["penalidade 1", "..."],
  "clausulasRestritivas": [{"trecho":"trecho do edital","motivo":"por que é restritivo","severidade":"alta|media|baixa"}],
  "recomendacoes": ["ponto de atenção/recomendação p/ a proposta 1", "..."],
  "aderenciaPortfolio": "análise de aderência aos produtos do fornecedor, ou null se não houver portfólio"
}

Se alguma informação não constar no edital, use lista vazia ou null. Não invente dados. Responda em português brasileiro.`

interface RequestBody {
  texto: string
  portfolio?: string[]   // nomes dos produtos do fornecedor (opcional)
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
        { error: 'OPENAI_API_KEY não configurada', instrucoes: 'Adicione OPENAI_API_KEY no .env.local' },
        { status: 401 },
      )
    }

    const body: RequestBody = await req.json()
    const texto = (body.texto ?? '').trim()

    if (texto.length < 200) {
      return NextResponse.json(
        { error: 'Texto do edital muito curto. Cole o conteúdo do edital ou envie o PDF.' },
        { status: 400 },
      )
    }

    const portfolioStr = body.portfolio && body.portfolio.length > 0
      ? `\n\nO fornecedor vende os seguintes produtos (avalie a aderência em "aderenciaPortfolio"): ${body.portfolio.join('; ')}.`
      : ''

    const userContent = `EDITAL:\n${texto.slice(0, MAX_CHARS)}${portfolioStr}`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 2000,
      temperature: 0.2,
    })

    const raw = completion.choices[0]?.message?.content ?? '{}'
    let analise: AnaliseEdital
    try {
      analise = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: 'Resposta do modelo não pôde ser interpretada.' }, { status: 502 })
    }

    return NextResponse.json({ analise, truncado: texto.length > MAX_CHARS })
  } catch (error) {
    console.error('[edital/analise]', error)
    return NextResponse.json({ error: 'Erro ao analisar o edital', detalhe: String(error) }, { status: 500 })
  }
}
