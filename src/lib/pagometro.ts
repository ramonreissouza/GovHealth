// src/lib/pagometro.ts — PAGÔMETRO no app: em quantos dias o ente que vai pagar a compra
// costuma pagar uma conta depois de reconhecê-la. Lê a tabela `pagometro` (municípios e
// estados, Siconfi/MSC: scripts/ingest-pagometro.mjs e src/lib/pagometro-calculo.mjs) e
// `pagometro_federal` (Unidades Gestoras, Portal da Transparência:
// scripts/ingest-pagometro-federal.mjs e src/lib/pagometro-federal.mjs).
//
// Não entra no score nesta fase: é informação ao lado do selo CAPAG. Sem dado, o selo
// some — nunca um número inventado.

import { query } from '@/lib/db'
import { getCached, setCached, TTL } from '@/lib/server-cache'
import { lerLocalidade } from '@/lib/capacidade-pagamento'
import { acharPagador, faixaDias, rotuloPagador } from '@/lib/pagometro-calculo.mjs'
import type { FaixaPagometro, PagometroInfo } from '@/lib/pagometro-texto'

export type { FaixaPagometro, PagometroInfo }

interface Linha {
  ente_tipo: string; uf: string; municipio_key: string; municipio_nome: string | null
  dias: number | null; dias_saude: number | null; meses: number
  mes_inicio: string | null; mes_fim: string | null
}

/** Unidade Gestora federal (tabela pagometro_federal, scripts/ingest-pagometro-federal.mjs). */
interface LinhaFederal {
  ug: string; nome: string | null; dias: number | null; meses: number | null
  mes_inicio: string | null; mes_fim: string | null
}

/** O que acharPagador devolve (src/lib/pagometro-calculo.mjs). */
interface Achado { tipo: 'estado' | 'municipio' | 'federal'; uf: string; linha: Linha | LinhaFederal; dias: number; saude: boolean }

function paraInfo(p: Achado, municipioPedido?: string | null): PagometroInfo {
  const l = p.linha
  return {
    dias: p.dias, saude: p.saude, faixa: faixaDias(p.dias) as FaixaPagometro,
    pagador: rotuloPagador(p, municipioPedido),
    meses: l.meses ?? 0, inicio: l.mes_inicio, fim: l.mes_fim,
    fonte: p.tipo === 'federal' ? 'portal' : 'siconfi',
  }
}

/**
 * A decisão de quem paga e qual número mostrar mora em acharPagador
 * (pagometro-calculo.mjs), a MESMA que grava contratacoes.pagometro_dias para o score,
 * o filtro e o e-mail. Aqui só as tabelas em memória e o texto do selo.
 */
export class IndicePagometro {
  private estados = new Map<string, Linha>()
  private municipios = new Map<string, Linha>()
  private federais = new Map<string, LinhaFederal>()
  private buscar = {
    estado: (uf: string) => this.estados.get(uf),
    municipio: (uf: string, chave: string) => this.municipios.get(`${uf}:${chave}`),
    federal: (ug: string) => this.federais.get(ug),
  }

  add(l: Linha) {
    if (l.ente_tipo === 'estado') this.estados.set(l.uf, l)
    else this.municipios.set(`${l.uf}:${l.municipio_key}`, l)
  }

  addFederal(l: LinhaFederal) { this.federais.set(l.ug, l) }

  /** Unidade Gestora federal como pagadora (pela UASG da compra). */
  federal(ug: string | null | undefined): PagometroInfo | null {
    return this.resolver(null, null, null, { esfera: 'F', ug })
  }

  /** O governo do estado (ou do DF) como pagador. */
  estado(uf: string | null | undefined): PagometroInfo | null {
    return this.resolver(uf, null, null, { esfera: 'E' })
  }

  /**
   * A prefeitura como pagadora. Diferente do CAPAG, NÃO cai para o estado quando o
   * município não tem dado: quem paga a compra da prefeitura é a prefeitura, e o prazo
   * do estado diria outra coisa.
   */
  municipio(uf: string | null | undefined, municipio: string | null | undefined): PagometroInfo | null {
    return this.resolver(uf, municipio, null, { esfera: 'M' })
  }

  /**
   * Compra de licitação: quem paga sai da esfera do PNCP quando ela veio, senão do nome
   * do órgão (pagadorDe). Federal resolve pela Unidade Gestora (= UASG); sem UASG, sem selo.
   */
  resolver(
    uf: string | null | undefined, municipio: string | null | undefined, orgao: string | null | undefined,
    ctx: { esfera?: string | null; ug?: string | null } = {},
  ): PagometroInfo | null {
    const p = acharPagador({ uf, municipio, orgao, esfera: ctx.esfera, ug: ctx.ug }, this.buscar) as Achado | null
    return p ? paraInfo(p, municipio) : null
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
  } catch (e) {
    // Sem a tabela ainda (carga não rodou): índice vazio, o selo simplesmente não aparece.
    console.warn('[pagometro] indisponível:', e instanceof Error ? e.message : e)
    return idx
  }
  try {
    // Federal à parte: a carga federal pode ainda não ter rodado onde a municipal já rodou.
    const fed = await query<LinhaFederal>(
      `SELECT ug, nome, dias::float8 AS dias, meses,
              to_char(mes_inicio, 'YYYY-MM-DD') AS mes_inicio, to_char(mes_fim, 'YYYY-MM-DD') AS mes_fim
         FROM pagometro_federal WHERE dias IS NOT NULL`,
    )
    for (const r of fed) idx.addFederal(r)
  } catch (e) {
    console.warn('[pagometro] federal indisponível:', e instanceof Error ? e.message : e)
  }
  setCached(chave, idx, TTL.LONG)
  return idx
}
