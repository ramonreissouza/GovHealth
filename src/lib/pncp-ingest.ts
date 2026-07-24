// src/lib/pncp-ingest.ts — GRAVAÇÃO de contratações do PNCP no banco (Neon), do lado
// do app. É o que faltava para o cron diário da Vercel atualizar a base de verdade:
// buscar já existia (lib/pncp.ts), mas nada persistia — o cron só contava.
//
// UPSERT idempotente espelhando scripts/etl-pncp.mjs (upsertContratacao): mesma
// tabela, mesma chave (numero_controle_pncp), mesmos campos atualizados em conflito.
// NÃO grava tipo_fornecimento — é coluna GENERATED STORED (o Postgres calcula).
// Grava categoria_saude (mesma lógica do ETL) e bumpa coletado_em, para o selo de
// "última coleta" refletir o cron diário mesmo quando só reencontra abertas.
//
// Este módulo cuida só do CABEÇALHO da contratação (a "oportunidade" em si) — que é
// o essencial para o usuário não perder demanda nova. O enriquecimento caro (itens
// + resultados homologados, que definem aberto→encerrada) segue no refresh periódico.

import { query } from '@/lib/db'
import type { PNCPContratacao } from '@/lib/types'

// Espelha categoria() de scripts/saude-filter.mjs — as telas leem categoria_saude e
// validam contra {imagem,uti,laboratorio,cirurgia,oncologia,medicamento,outros}.
export function categoriaSaude(objeto: string | null | undefined): string {
  const l = (objeto ?? '').toLowerCase()
  if (/tom[óo]graf|tomografia|resson|ultrassom|mam[óo]graf|radiolog|raio-?x|raios x/.test(l)) return 'imagem'
  if (/leito de uti|ventilador pulmonar|respirador|monitor multipar|desfibrilador|ox[íi]metr/.test(l)) return 'uti'
  if (/laborat[óo]ri|analisador|hematolog|reagente|an[áa]lises cl[íi]nic/.test(l)) return 'laboratorio'
  if (/cir[úu]rg|bisturi|mesa cir/.test(l)) return 'cirurgia'
  if (/oncol[óo]g|quimioter|radioter/.test(l)) return 'oncologia'
  if (/medicament|f[áa]rmac|vacina|soro fisiol|medicinal/.test(l)) return 'medicamento'
  return 'outros'
}

export interface IngestResumo {
  recebidas: number // contratações candidatas (após dedup) enviadas ao banco
  gravadas: number  // upserts concluídos com sucesso
  falhas: number
}

// Grava um lote de contratações. Concorrência limitada (o Pool do Neon tem max=5),
// então processa em blocos para não saturar a conexão nem estourar o tempo da função.
export async function upsertContratacoes(rows: PNCPContratacao[]): Promise<IngestResumo> {
  // Dedup por número de controle (a mesma compra pode vir de proposta e de publicação).
  const unicas = new Map<string, PNCPContratacao>()
  for (const c of rows) {
    if (c?.numeroControlePNCP) unicas.set(c.numeroControlePNCP, c)
  }
  const lista = [...unicas.values()]

  let gravadas = 0
  let falhas = 0
  const CONCORRENCIA = 4
  for (let i = 0; i < lista.length; i += CONCORRENCIA) {
    const bloco = lista.slice(i, i + CONCORRENCIA)
    const res = await Promise.allSettled(bloco.map((c) => upsertUma(c)))
    for (const r of res) r.status === 'fulfilled' ? gravadas++ : falhas++
  }
  return { recebidas: lista.length, gravadas, falhas }
}

async function upsertUma(c: PNCPContratacao): Promise<void> {
  await query(
    `INSERT INTO contratacoes (numero_controle_pncp, cnpj_orgao, razao_social_orgao, municipio, uf,
       modalidade_nome, objeto_compra, ano_compra, sequencial_compra, valor_total_estimado,
       data_publicacao, situacao_id, categoria_saude, coletado_em)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
     ON CONFLICT (numero_controle_pncp) DO UPDATE SET
       valor_total_estimado = EXCLUDED.valor_total_estimado,
       situacao_id          = EXCLUDED.situacao_id,
       categoria_saude      = EXCLUDED.categoria_saude,
       coletado_em          = now()`,
    [
      c.numeroControlePNCP,
      c.orgaoEntidade?.cnpj ?? '',
      c.orgaoEntidade?.razaoSocial ?? null,
      c.unidadeOrgao?.municipioNome ?? null,
      c.unidadeOrgao?.ufSigla ?? null,
      c.modalidadeNome ?? null,
      c.objetoCompra ?? null,
      c.anoCompra ?? null,
      c.sequencialCompra ?? null,
      c.valorTotalEstimado ?? null,
      (c.dataPublicacaoPncp ?? '').slice(0, 10) || null,
      c.situacaoCompraId ?? null,
      categoriaSaude(c.objetoCompra),
    ],
  )
}
