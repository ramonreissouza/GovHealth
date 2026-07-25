// src/app/api/edital/analise/route.ts
// Copiloto de Edital — recebe o texto do edital/TR e devolve uma análise
// estruturada (specs, habilitação, prazos, cláusulas restritivas, recomendações)
// usando OpenAI em JSON mode. O PDF é extraído no cliente (lib/pdf.ts).

import { NextRequest, NextResponse } from 'next/server'
import type { AnaliseEdital } from '@/lib/types'
import { IA_HABILITADA } from '@/lib/features'
import { getLLM, LLM_MODEL, llmConfigurado } from '@/lib/llm'

export const runtime = 'nodejs'
export const maxDuration = 60

// Limita o texto enviado ao modelo (controle de custo/contexto). ~48k chars ≈ edital típico.
const MAX_CHARS = 48_000

const SYSTEM_PROMPT = `Você é um ADVOGADO especialista em licitações públicas (Lei 14.133/2021) e consultor de FORNECEDORES de saúde (equipamentos, medicamentos, OPME, serviços). Analise o EDITAL/Termo de Referência com o rigor de uma auditoria de Tribunal de Contas.

Siga esta metodologia:
1. FORMAL/LEGAL: conformidade com a Lei 14.133/2021; ilegalidades, cláusulas restritivas, omissões e ambiguidades; violações à isonomia, competitividade e julgamento objetivo — com FUNDAMENTO legal específico (cite o artigo).
2. OBJETO/TÉCNICO: objeto claro? excesso de especificação (direcionamento) ou imprecisão (risco)?
3. HABILITAÇÃO: exigências ilegais/excessivas/restritivas; risco de inabilitação indevida.
4. JULGAMENTO: critério adotado; subjetividade indevida.
5. PRAZOS/CONTRATO: prazos exequíveis; cláusulas abusivas; penalidades proporcionais.
6. RISCOS ao licitante (jurídico/financeiro/operacional), classificados por grau + mitigação.
7. IMPUGNAÇÃO: detecte TODOS os pontos impugnáveis (violação legal, restrição à competitividade, exigência desproporcional, omissão). Decida se vale impugnar (total/parcial), a melhor estratégia, e GERE uma MINUTA de impugnação pronta para protocolo.
8. CONCLUSÃO EXECUTIVA: vale a pena participar? principais riscos e vantagens.

Regras: seja rigoroso e detalhista; NÃO faça suposições sem base no edital; sempre fundamente juridicamente; cite trechos quando possível; linguagem técnica.

Atenção especial a DIRECIONAMENTO: marca específica sem "ou similar", specs que apontam um único fabricante, atestados desproporcionais, prazos inexequíveis, amostra/visita restritivas.

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
  "aderenciaPortfolio": "análise de aderência aos produtos do fornecedor, ou null se não houver portfólio",
  "analiseLegal": ["ilegalidade/vício/omissão com fundamento legal (art. da Lei 14.133) 1", "..."],
  "riscos": [{"descricao":"risco","grau":"alto|medio|baixo","mitigacao":"como mitigar"}],
  "impugnacao": {
    "recomendada": true,
    "tipo": "total|parcial|nao",
    "estrategia": "impugnação formal | pedido de esclarecimento | participar sem questionar | combinação",
    "pontos": [{"ponto":"a irregularidade","fundamento":"violação (art. da Lei 14.133)","relevancia":"critico|alto|medio|baixo","probabilidadeExito":"alta|media|baixa"}],
    "minuta": "PEÇA DE IMPUGNAÇÃO completa e pronta para protocolo (endereçamento ao órgão; identificação do processo; tempestividade; síntese; FUNDAMENTAÇÃO JURÍDICA com um tópico por irregularidade citando a Lei 14.133/2021; PEDIDO de correção/suspensão; fechamento). Use \\n para quebras de linha. Se não recomendada, use null."
  },
  "conclusao": {
    "participar": "veredito claro: vale a pena participar? por quê (1-3 frases)",
    "principaisRiscos": ["risco 1", "..."],
    "principaisVantagens": ["vantagem 1", "..."]
  }
}

Se alguma informação não constar no edital, use lista vazia, false ou null. Não invente dados. Responda em português brasileiro.`

interface RequestBody {
  texto: string
  portfolio?: string[]   // nomes dos produtos do fornecedor (opcional)
}

// Extrai o objeto JSON da resposta — remove cercas ```json e qualquer texto ao
// redor (defensivo: modelos de raciocínio às vezes prefixam/suffixam conteúdo).
function extrairJson(s: string): string {
  const t = s.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const i = t.indexOf('{')
  const j = t.lastIndexOf('}')
  return i >= 0 && j > i ? t.slice(i, j + 1) : t
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
        { error: 'Provedor de IA não configurado', instrucoes: 'Defina ZAI_API_KEY (chave da Z.ai) no ambiente.' },
        { status: 503 },
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

    // Instanciado aqui (não no topo) para o build não exigir a chave.
    const openai = getLLM()

    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 8000, // análise rigorosa + minuta de impugnação são longas
      temperature: 0.2,
    })

    const raw = completion.choices[0]?.message?.content ?? '{}'
    let analise: AnaliseEdital
    try {
      analise = JSON.parse(extrairJson(raw))
    } catch {
      return NextResponse.json({ error: 'Resposta do modelo não pôde ser interpretada.' }, { status: 502 })
    }

    return NextResponse.json({ analise, truncado: texto.length > MAX_CHARS })
  } catch (error) {
    console.error('[edital/analise]', error)
    return NextResponse.json({ error: 'Erro ao analisar o edital', detalhe: String(error) }, { status: 500 })
  }
}
