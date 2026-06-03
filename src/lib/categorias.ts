// src/lib/categorias.ts
// Fonte ÚNICA de metadados de apresentação de categorias e tipos de fornecimento.
// Antes, os mapas de label/cor estavam duplicados em ~8 páginas/componentes —
// adicionar uma categoria exigia editar todos. Agora, basta editar aqui.

import type { CategoriaEquipamento, TipoFornecimento } from './types'

interface CategoriaMeta {
  label: string       // rótulo completo (ex.: "Laboratório")
  labelCurto: string  // rótulo abreviado para tabelas densas (ex.: "Lab")
  tag: string         // classe utilitária do selo (globals.css)
  chart: string       // cor hex para gráficos (recharts/mapa)
}

export const CATEGORIA_META: Record<CategoriaEquipamento, CategoriaMeta> = {
  imagem:      { label: 'Imagem',      labelCurto: 'Imagem',      tag: 'tag-blue',         chart: '#60a5fa' },
  uti:         { label: 'UTI',         labelCurto: 'UTI',         tag: 'tag-red',          chart: '#f87171' },
  laboratorio: { label: 'Laboratório', labelCurto: 'Lab',         tag: 'tag-amber',        chart: '#f59e0b' },
  cirurgia:    { label: 'Cirurgia',    labelCurto: 'Cirurgia',    tag: 'tag-purple',       chart: '#c084fc' },
  oncologia:   { label: 'Oncologia',   labelCurto: 'Oncologia',   tag: 'tag-green',        chart: '#4ade80' },
  medicamento: { label: 'Medicamento', labelCurto: 'Medicamento', tag: 'tag-cyan',         chart: '#22d3ee' },
  outros:      { label: 'Outros',      labelCurto: 'Outros',      tag: 'bg-bg4 text-faint', chart: '#94a3b8' },
}

const pick = <K extends keyof CategoriaMeta>(k: K): Record<string, CategoriaMeta[K]> =>
  Object.fromEntries(Object.entries(CATEGORIA_META).map(([cat, m]) => [cat, m[k]]))

// Mapas derivados (compatíveis com os usos existentes nas páginas).
export const CATEGORIA_LABEL       = pick('label')       as Record<string, string>
export const CATEGORIA_LABEL_CURTO = pick('labelCurto')  as Record<string, string>
export const CATEGORIA_COLOR       = pick('tag')         as Record<string, string>
export const CATEGORIA_CHART_COLOR = pick('chart')       as Record<string, string>

// ── Tipos de fornecimento (eixo de navegação por aba) ────────────────────────

export const TIPO_LABEL: Record<TipoFornecimento, string> = {
  equipamento: 'Equip. Médicos',
  medicamento: 'Medicamentos',
  opme:        'OPME',
  servico:     'Serviços de Saúde',
  acessorio:   'Acessórios',
  outros:      'Outros',
}
