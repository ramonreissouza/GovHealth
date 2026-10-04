// src/lib/pagometro.ts — PAGÔMETRO no app: em quantos dias o ente que vai pagar a compra
// costuma pagar uma conta depois de reconhecê-la. Lê a tabela `pagometro`, carregada por
// scripts/ingest-pagometro.mjs; o cálculo e o porquê estão em src/lib/pagometro-calculo.mjs.
//
// Não entra no score nesta fase: é informação ao lado do selo CAPAG. Sem dado, o selo
// some — nunca um número inventado.

import { query } from '@/lib/db'
import { normalizeKey } from '@/lib/text'
import { getCached, setCached, TTL } from '@/lib/server-cache'
import { lerLocalidade } from '@/lib/capacidade-pagamento'
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

  /** O governo do estado (ou do DF) como pagador. */
  estado(uf: string | null | undefined): PagometroInfo | null {
    const UF = (uf ?? '').trim().toUpperCase()
    const l = this.estados.get(UF)
    return l ? info(l, UF === 'DF' ? 'Governo do Distrito Federal' : `Governo do estado (${UF})`) : null
  }

  /**
   * A prefeitura como pagadora. Diferente do CAPAG, NÃO cai para o estado quando o
   * município não tem dado: quem paga a compra da prefeitura é a prefeitura, e o prazo
   * do estado diria outra coisa.
   */
  municipio(uf: string | null | undefined, municipio: string | null | undefined): PagometroInfo | null {
    const UF = (uf ?? '').trim().toUpperCase()
    if (!UF || !municipio) return null
    const l = this.municipios.get(`${UF}:${normalizeKey(municipio)}`)
    return l ? info(l, `${l.municipio_nome ?? municipio}/${UF}`) : null
  }

  /** Compra de licitação: quem paga sai do nome do órgão comprador (classificarPagador). */
  resolver(uf: string | null | undefined, municipio: string | null | undefined, orgao: string | null | undefined): PagometroInfo | null {
    const pagador = classificarPagador(orgao)
    if (pagador === 'estado') return this.estado(uf)
    if (pagador === 'municipio') return this.municipio(uf, municipio)
    return null
  }

  /** Emenda federal: o ente que recebe sai da "localidade do gasto" do Portal, lida como
   *  o CAPAG lê ("Cidade - PB", "Embu/SP", "BAHIA (UF)"). */
  resolverLocalidade(localidade: string | null | undefined): PagometroInfo | null {
    const l = lerLocalidade(localidade)
    if (!l) return null
    return l.municipio ? this.municipio(l.uf, l.municipio) : this.estado(l.uf)
  }
}

/** A tabela inteira (~5,6 mil entes), num cache só: filtrar por UF criava uma entrada
 *  por combinação de filtro sem economizar nada que importe. */
export async function carregarIndicePagometro(): Promise<IndicePagometro> {
  const chave = 'pagometro:idx'
  const cached = getCached<IndicePagometro>(chave)
  if (cached) return cached
  const idx = new IndicePagometro()
  try {
    // Data como TEXTO de propósito: o pg converte DATE em Date no fuso da máquina, e num
    // servidor fora do Brasil 2026-01-01 virava 31/12/2025 — o selo diria "dez/2025".
    const rows = await query<Linha>(
      `SELECT ente_tipo, uf, municipio_key, municipio_nome, dias::float8 AS dias, dias_saude::float8 AS dias_saude, meses,
              to_char(mes_inicio, 'YYYY-MM-DD') AS mes_inicio, to_char(mes_fim, 'YYYY-MM-DD') AS mes_fim
         FROM pagometro`,
    )
    for (const r of rows) idx.add(r)
    setCached(chave, idx, TTL.LONG)
  } catch (e) {
    // Sem a tabela ainda (carga não rodou): índice vazio, o selo simplesmente não aparece.
    console.warn('[pagometro] indisponível:', e instanceof Error ? e.message : e)
  }
  return idx
}
