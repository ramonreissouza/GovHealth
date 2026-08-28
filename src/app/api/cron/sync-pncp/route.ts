// src/app/api/cron/sync-pncp/route.ts — SINCRONIZAÇÃO DIÁRIA (Vercel Cron, 3h).
//
// Objetivo: manter a base 100% representativa do que está acontecendo AGORA, sem
// depender de máquina local. Antes esta rota só CONTAVA (buscava e descartava) — a
// base só era atualizada pelo ETL local a cada dias. Agora ela GRAVA:
//
//   1) ABERTAS (prioridade): /contratacoes/proposta — licitações recebendo proposta
//      neste momento. São as oportunidades vivas que o usuário não pode perder.
//   2) PUBLICAÇÕES RECENTES: /contratacoes/publicacao, UMA JANELA POR DIA nos últimos
//      três dias, do mais novo para o mais velho (o porquê está no corpo da função) —
//      pega o que entrou (aberta ou já encerrada), com folga para o atraso de
//      publicação do próprio PNCP.
//
// Só grava o CABEÇALHO (a oportunidade). O enriquecimento caro (itens + resultados
// homologados → status encerrada) continua no refresh periódico, que roda sem o
// limite de tempo de uma função serverless. Uma contratação nova sem resultado
// aparece naturalmente como "Em aberto" nas telas — exatamente o que se quer.

import { NextRequest, NextResponse } from 'next/server'
import { buscarComprasSaude, buscarLicitacoesAbertas, toPncpDate } from '@/lib/pncp'
import { upsertContratacoes, marcarColeta } from '@/lib/pncp-ingest'

export const runtime = 'nodejs'
// Fetches de LISTAGEM apenas (sem chamadas por item). O /proposta do PNCP é lento nas
// modalidades grandes; damos folga e a busca de abertas se auto-limita por orçamento
// de tempo (budgetMs) para nunca estourar.
//
// 120s → 300s (teto atual da Vercel em todos os planos) porque os 120s eram o que
// segurava o TETO DE COLETA descrito abaixo. Não é folga de segurança: é volume.
export const maxDuration = 300

export async function GET(req: NextRequest) {
  // Vercel Cron autentica via CRON_SECRET
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const inicio = Date.now()
  try {
    // Publicações recentes: UMA JANELA POR DIA, do mais novo para o mais velho.
    //
    // Medido em 20/08/2026: com a janela única de 3 dias, esta perna trouxe 105
    // registros e TODOS do dia mais antigo — o /publicacao pagina em ordem
    // crescente de data e o teto de páginas por modalidade se esgotava antes de
    // chegar no dia de hoje. Ou seja: a perna que existe para pegar o que acabou de
    // ser publicado era estruturalmente incapaz de pegar o dia mais novo.
    // Uma janela por dia (dataInicial = dataFinal) gasta o mesmo número de pedidos e
    // garante que o dia de hoje seja o primeiro a ser servido. O rabo antigo (e as
    // publicações atrasadas do PNCP) continua sendo trabalho do refresh periódico,
    // que roda horas e não tem limite de função serverless.
    const dias = [0, 1, 2].map((d) => {
      const dt = new Date()
      dt.setDate(dt.getDate() - d)
      return toPncpDate(dt)
    })

    // CONCORRÊNCIA BAIXA, de propósito. Medido em 20/08: o PNCP responde uma página de
    // /publicacao em ~6s e uma de /proposta em ~17s, e limita por cliente — com as quatro
    // janelas disparadas de uma vez (8 requisições simultâneas) TODAS estouram o timeout
    // e a rodada volta vazia, que foi o que aconteceu nas duas primeiras execuções em
    // produção. Aqui ficam só DUAS correntes: as abertas em voo e os dias em série, do
    // mais novo para o mais velho.
    const abertasEmVoo = buscarLicitacoesAbertas({
      maxPaginasPorModalidade: 12, budgetMs: 55_000, semCache: true,
    })

    // TETO DE COLETA — por que estes números subiram (medido em 28/08/2026).
    //
    // Com 5 páginas × 4 modalidades × 50 por página, esta rota lia no MÁXIMO 1.000
    // registros brutos por dia. Com ~12% de saúde, ~120 contratações. E o PNCP publica
    // de 750 a 880 por dia útil. As novas por dia no banco batiam com a conta com uma
    // fidelidade constrangedora — 106, 124, 127, 109 — porque o limite nunca era a
    // oferta, era o teto. Sondando o PNCP no mesmo dia: só a modalidade 8, só em
    // 27/08, tinha 3.046 contratações em 305 páginas. Líamos 5 dessas 305.
    //
    // O governador de verdade é o budgetMs (o maxPaginas só existe para não paginar
    // ao infinito num dia atípico), então o que abre volume é o tempo. A CONCORRÊNCIA
    // NÃO MUDA: continuam duas correntes, e as páginas seguem em série dentro de cada
    // modalidade. Isso importa — foram 8 requisições simultâneas que derrubaram as
    // duas primeiras execuções em produção, e subir profundidade não é subir paralelismo.
    const prazoRecentes = Date.now() + 210_000
    const recentesPorDia: Awaited<ReturnType<typeof buscarComprasSaude>>[] = []
    for (const [i, dia] of dias.entries()) {
      const resta = prazoRecentes - Date.now()
      if (resta < 6_000) {
        // Sem tempo para uma página inteira: registra e sai. O dia mais novo já foi.
        recentesPorDia.push({ data: [], totalRegistros: 0, erros: ['pulado: sem tempo na janela'] })
        continue
      }
      // COTA POR DIA, e não "todo o tempo que sobrou".
      //
      // Enquanto o teto era de 5 páginas, cada dia parava sozinho e os três eram
      // servidos. Com 60 páginas, dar `resta` inteiro ao primeiro dia faria ele comer
      // o orçamento e deixar ontem e anteontem em ZERO — trocaria um teto por uma fome.
      // Dividir pelo número de dias que ainda faltam mantém a prioridade do dia mais
      // novo (ele escolhe primeiro) sem deixar os outros sem nada, e devolve a sobra:
      // se hoje esgotar as páginas antes da cota, ontem herda o que não foi usado.
      const cota = Math.floor(resta / (dias.length - i))
      recentesPorDia.push(await buscarComprasSaude({
        dataInicial: dia, dataFinal: dia, maxPaginasPorModalidade: 60, budgetMs: cota, semCache: true,
      }))
    }
    const abertas = await abertasEmVoo

    const recentes = recentesPorDia.flatMap((r) => r.data)
    const candidatas = [...abertas, ...recentes]
    const resumo = await upsertContratacoes(candidatas)
    // Deixa rastro em etl_checkpoint: alimenta o selo de "coletado há Xh" e serve de
    // teste de vida deste cron (`novas` no lugar de "gravadas" — ver marcarColeta).
    await marcarColeta(resumo.novas)

    // Erros do PNCP viajam junto: sem eles, "não há licitação nova" e "o PNCP nos
    // recusou" chegam como a mesma resposta vazia — e foi essa ambiguidade que deixou
    // o sync quebrado por um mês sem ninguém ver.
    const erros = [...new Set(recentesPorDia.flatMap((r) => r.erros ?? []))]
    const porDia = dias.map((d, i) => `${d}:${recentesPorDia[i].data.length}`).join(' ')
    const msg = `[cron:sync-pncp] abertas=${abertas.length} recentes=${recentes.length} (${porDia}) `
      + `→ ${resumo.novas} novas + ${resumo.atualizadas} atualizadas de ${resumo.recebidas} `
      + `(${resumo.falhas} falhas) em ${Date.now() - inicio}ms`
    console.log(msg)
    if (erros.length) console.warn('[cron:sync-pncp] PNCP recusou:', erros.join(' | '))

    return NextResponse.json({
      ok: true,
      abertas: abertas.length,
      recentes: recentes.length,
      recentesPorDia: Object.fromEntries(dias.map((d, i) => [d, recentesPorDia[i].data.length])),
      recebidas: resumo.recebidas,
      novas: resumo.novas,
      atualizadas: resumo.atualizadas,
      gravadas: resumo.gravadas,
      falhas: resumo.falhas,
      erros: erros.length ? erros : undefined,
      duracaoMs: Date.now() - inicio,
      rodarEm: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[cron:sync-pncp]', error)
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 })
  }
}
