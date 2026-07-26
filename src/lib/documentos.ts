// src/lib/documentos.ts — tipos + estado de validade do Cofre de Documentos.
// Módulo PURO (sem DB): usado no cliente (badges), na API e no cron de avisos.

export interface Documento {
  id: string
  tipo: string
  nome: string
  numero: string | null
  orgaoEmissor: string | null
  emissao: string | null       // 'YYYY-MM-DD' ou null
  validade: string | null      // 'YYYY-MM-DD' ou null
  semValidade: boolean
  arquivoUrl: string | null
  observacao: string | null
  criadoEm: string
  atualizadoEm: string
}

export const TIPOS_DOC: { key: string; label: string }[] = [
  { key: 'certidao_federal', label: 'CND Federal (Receita/PGFN)' },
  { key: 'fgts', label: 'CRF — FGTS (Caixa)' },
  { key: 'trabalhista', label: 'CNDT — Trabalhista (TST)' },
  { key: 'estadual', label: 'Fazenda Estadual' },
  { key: 'municipal', label: 'Fazenda Municipal' },
  { key: 'falencia', label: 'Falência/Concordata' },
  { key: 'contrato_social', label: 'Contrato Social' },
  { key: 'balanco', label: 'Balanço Patrimonial' },
  { key: 'atestado', label: 'Atestado de Capacidade Técnica' },
  { key: 'alvara', label: 'Alvará / Licença' },
  { key: 'outro', label: 'Outro' },
]

const TIPO_LABEL = new Map(TIPOS_DOC.map((t) => [t.key, t.label]))
export function tipoLabel(key: string): string {
  return TIPO_LABEL.get(key) ?? key
}

export type EstadoDoc = 'sem_validade' | 'valido' | 'vencendo' | 'vencido'

/** Janela (dias) em que um documento é considerado "vencendo" — dispara aviso. */
export const DIAS_ALERTA = 30

/** Dias até vencer (negativo = vencido). null se sem validade. */
export function diasParaVencer(validade: string | null, hojeMs = Date.now()): number | null {
  if (!validade) return null
  const v = new Date(validade + 'T23:59:59').getTime()
  if (Number.isNaN(v)) return null
  return Math.ceil((v - hojeMs) / 86_400_000)
}

export function estadoDoc(d: { validade: string | null; semValidade: boolean }, hojeMs = Date.now()): EstadoDoc {
  if (d.semValidade || !d.validade) return 'sem_validade'
  const dias = diasParaVencer(d.validade, hojeMs)
  if (dias == null) return 'sem_validade'
  if (dias < 0) return 'vencido'
  if (dias <= DIAS_ALERTA) return 'vencendo'
  return 'valido'
}

export const ESTADO_LABEL: Record<EstadoDoc, string> = {
  sem_validade: 'Sem validade',
  valido: 'Válido',
  vencendo: 'Vence em breve',
  vencido: 'Vencido',
}
