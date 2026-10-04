// src/lib/pagometro.ts — PAGÔMETRO no app: em quantos dias o ente que vai pagar a compra
// costuma pagar uma conta depois de reconhecê-la. Lê a tabela `pagometro`, carregada por
// scripts/ingest-pagometro.mjs; o cálculo e o porquê estão em src/lib/pagometro-calculo.mjs.
//
// Não entra no score nesta fase: é informação ao lado do selo CAPAG. Sem dado, o selo
// some — nunca um número inventado.

import { query } from '@/lib/db'
import { normalizeKey } from '@/lib/text'
import { getCached, setCached, TTL } from '@/lib/server-cache'
import { classificarPagador, faixaDias } from '@/lib/pagometro-calculo.mjs'
import type { FaixaPagometro, PagometroInfo } from '@/lib/pagometro-texto'

export type { FaixaPagometro, PagometroInfo }

interface Linha {
  ente_tipo: string; uf: string; municipio_key: string; municipio_nome: string | null
  dias: number | null; dias_saude: number | null; meses: number
  mes_inicio: string | null; mes_fim: string | null
}

function info(l: Linha, pagador: string): PagometroInfo | null {
  // A Saúde primeiro: é o que o cliente vende. Sem volume suficiente na Saúde, o geral.
  const saude = l.dias_saude != null
  const dias = saude ? Number(l.dias_saude) : l.dias != null ? Number(l.dias) : null
  const faixa = faixaDias(dias) as FaixaPagometro | null
  if (dias == null || !faixa) return null
  return { dias, saude, faixa, pagador, meses: l.meses, inicio: l.mes_inicio, fim: l.mes_fim }
}

export class IndicePagometro {
  private estados = new Map<string, Linha>()
  private municipios = new Map<string, Linha>()

  add(l: Linha) {
    if (l.ente_tipo === 'estado') this.estados.set(l.uf, l)
    else this.municipios.set(`${l.uf}:${l.municipio_key}`, l)
  }

  /**
   * Resolve pelo órgão comprador. Diferente do CAPAG, NÃO cai para o estado quando o
   * município não tem dado: quem paga a compra da prefeitura é a prefeitura, e o prazo
   * do estado diria outra coisa.
   */
  resolver(uf: string | null | undefined, municipio: string | null | undefined, orgao?: string | null): PagometroInfo | null {
    const UF = (uf ?? '').trim().toUpperCase()
    if (!UF) return null
    const pagador = classificarPagador(orgao)
    if (pagador === 'estado') {
      const l = this.estados.get(UF)
      return l ? info(l, UF === 'DF' ? 'Governo do Distrito Federal' : `Governo do estado (${UF})`) : null
    }
    if (pagador !== 'municipio' || !municipio) return null
    const l = this.municipios.get(`${UF}:${normalizeKey(municipio)}`)
    return l ? info(l, `${l.municipio_nome ?? municipio}/${UF}`) : null
  }
}

export async function carregarIndicePagometro(ufs?: string[]): Promise<IndicePagometro> {
  const chave = `pagometro:idx:${ufs?.length ? [...ufs].map((u) => u.toUpperCase()).sort().join(',') : 'all'}`
  const cached = getCached<IndicePagometro>(chave)
  if (cached) return cached
  const idx = new IndicePagometro()
  try {
    // Data como TEXTO de propósito: o pg converte DATE em Date no fuso da máquina, e num
    // servidor fora do Brasil 2026-01-01 virava 31/12/2025 — o selo diria "dez/2025".
    const cols = `ente_tipo, uf, municipio_key, municipio_nome, dias::float8 AS dias, dias_saude::float8 AS dias_saude, meses,
                  to_char(mes_inicio, 'YYYY-MM-DD') AS mes_inicio, to_char(mes_fim, 'YYYY-MM-DD') AS mes_fim`
    const rows = ufs?.length
      ? await query<Linha>(`SELECT ${cols} FROM pagometro WHERE uf = ANY($1::text[])`, [ufs.map((u) => u.toUpperCase())])
      : await query<Linha>(`SELECT ${cols} FROM pagometro`)
    for (const r of rows) idx.add(r)
    setCached(chave, idx, TTL.LONG)
  } catch (e) {
    // Sem a tabela ainda (carga não rodou): índice vazio, o selo simplesmente não aparece.
    console.warn('[pagometro] indisponível:', e instanceof Error ? e.message : e)
  }
  return idx
}
