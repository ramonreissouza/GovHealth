'use client'
// src/components/ui/PrecoRefItem.tsx
// Preço de referência do Compras.gov POR ITEM, sob demanda (carrega ao clicar).
// Consulta pela descrição do item (mais específica que o objeto da licitação) e
// compara com o valor unitário orçado. Marcado como APROXIMADO: sem código CATMAT
// nos nossos dados, a resolução é por texto e as unidades podem variar.

import React, { useState } from 'react'
import { TrendingDown, RefreshCw, ChevronDown, ChevronUp, ExternalLink, AlertTriangle } from 'lucide-react'
import type { EstatisticaPrecos } from '@/lib/types'
import { formatBRL } from '@/lib/format'

// Remove acentos e baixa a caixa — casamento robusto por texto (mapa explícito para
// não depender de regex de marcas combinantes / encoding do arquivo).
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[áàâãä]/g, 'a')
    .replace(/[éèêë]/g, 'e')
    .replace(/[íìîï]/g, 'i')
    .replace(/[óòôõö]/g, 'o')
    .replace(/[úùûü]/g, 'u')
    .replace(/ç/g, 'c')
}

// Substantivos de produto de saúde ESPECÍFICOS, do mais específico ao mais genérico.
// Resolvem bem no catálogo CATMAT (viram nomes de PDM). Escolher o mais forte é muito
// melhor que "as 3 primeiras palavras" — que costumam ser ruído ("aquisição de material…").
const TERMOS_FORTES = [
  // imagem / diagnóstico
  'tomografo', 'ressonancia', 'ultrassom', 'mamografo', 'densitometro', 'angiografo',
  'eletrocardiografo', 'eletroencefalografo', 'endoscopio', 'colonoscopio', 'microscopio',
  // terapia / monitoramento
  'ventilador pulmonar', 'ventilador', 'respirador', 'desfibrilador', 'cardioversor',
  'monitor multiparametrico', 'monitor', 'oximetro', 'bomba de infusao', 'nebulizador',
  'aspirador', 'autoclave', 'incubadora', 'berco aquecido', 'foco cirurgico', 'mesa cirurgica',
  'bisturi eletrico', 'bisturi',
  // insumos / descartáveis
  'seringa', 'agulha', 'cateter', 'sonda', 'equipo', 'luva cirurgica', 'luva de procedimento',
  'luva', 'gaze', 'atadura', 'compressa', 'curativo', 'esparadrapo', 'fralda', 'mascara',
  'avental', 'eletrodo', 'reagente', 'tubo de coleta', 'escalpe', 'soro fisiologico',
  // opme / prótese / diálise
  'protese', 'ortese', 'implante', 'stent', 'marcapasso', 'dialisador',
  // mobiliário / apoio / aferição
  'cadeira de rodas', 'maca', 'cama hospitalar', 'cama fowler', 'estetoscopio',
  'esfigmomanometro', 'termometro', 'glicosimetro', 'concentrador de oxigenio', 'oxigenio',
  // medicamento (só se nada mais específico casar)
  'insulina', 'vacina', 'medicamento',
]

// Palavras genéricas de licitação que só atrapalham a resolução do catálogo.
const STOPWORDS = new Set([
  'aquisicao', 'aquisicoes', 'contratacao', 'compra', 'compras', 'fornecimento', 'registro',
  'preco', 'precos', 'material', 'materiais', 'equipamento', 'equipamentos', 'hospitalar',
  'hospitalares', 'medico', 'medica', 'medicos', 'medicas', 'para', 'com', 'tipo', 'uso',
  'unidade', 'conforme', 'especificacao', 'descricao', 'diversos', 'diversas', 'insumo',
  'insumos', 'servico', 'servicos', 'item', 'itens', 'saude', 'produto', 'produtos', 'destinado',
  'outros', 'outras', 'componentes', 'componente', 'primeira', 'segunda', 'demais', 'tipos',
])

// Casa o termo como PALAVRA (limite \b + plural opcional), não como substring solta —
// senão "stent" casa "reSISTENTe", "maca" casa "maCArrão", "soro" casa "teSOuRO".
function casaTermo(desc: string, termo: string): boolean {
  const esc = termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // multi-palavra já é específico (só limite inicial); simples exige limite nas 2 pontas.
  const re = termo.includes(' ') ? new RegExp(`\\b${esc}`) : new RegExp(`\\b${esc}(s|es)?\\b`)
  return re.test(desc)
}

// Extrai o melhor termo de busca do item: 1) o substantivo de saúde mais forte que
// aparecer (como palavra); 2) senão, as palavras significativas (sem stopwords).
export function extrairTermo(descricao: string): string {
  const d = norm(descricao)
  // 1) termo forte (o primeiro da lista = o mais específico) — multi-palavra antes.
  for (const termo of TERMOS_FORTES) {
    if (casaTermo(d, termo)) return termo
  }
  // 2) fallback: palavras ≥4 letras que não sejam genéricas (até 2, preservam ordem).
  const palavras = d
    .replace(/[^a-z\s]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
    .slice(0, 2)
    .join(' ')
  return palavras || descricao.slice(0, 30)
}

export function PrecoRefItem({ descricao, valorUnitario, uf, unidadeEdital, codigoPdm, nomePdm }: {
  descricao: string; valorUnitario: number; uf?: string; unidadeEdital?: string
  /** PDM do CATMAT casado no banco. Quando existe, é ele que define a referência. */
  codigoPdm?: number
  nomePdm?: string
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [carregado, setCarregado] = useState(false)
  const [stats, setStats] = useState<EstatisticaPrecos | null>(null)

  const termo = extrairTermo(descricao)

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (carregado) { setOpen((o) => !o); return }
    setOpen(true); setLoading(true)
    try {
      // Com PDM, consulta por CÓDIGO — é o que torna a referência confiável. A
      // aproximação por termo (`extrairTermo`) fica só como último recurso, e é
      // exatamente ela que fazia a referência cair em outro produto.
      const params = codigoPdm
        ? new URLSearchParams({ codigoPdm: String(codigoPdm), tamanhoPagina: '30' })
        : new URLSearchParams({ descricao: termo, tamanhoPagina: '30' })
      if (uf) params.set('uf', uf)
      const r = await fetch(`/api/comprasgov/precos?${params}`)
      const d = await r.json()
      setStats(d.estatisticas ?? null)
    } catch { /* silencioso */ }
    finally { setLoading(false); setCarregado(true) }
  }

  const mediana = stats?.valorMediano ?? 0
  const temDados = !!stats && stats.total > 0
  // Comparação orçado × mediana (aproximada — unidades podem diferir).
  const diff = temDados && mediana > 0 && valorUnitario > 0 ? (valorUnitario - mediana) / mediana : null

  return (
    <div className="mt-1">
      <button
        onClick={toggle}
        className="inline-flex items-center gap-1 text-[9px] font-mono-custom text-faint hover:text-accent transition-colors"
      >
        {loading ? <RefreshCw size={9} className="animate-spin" /> : <TrendingDown size={9} />}
        Preço ref. Compras.gov
        {open ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
      </button>

      {open && !loading && (
        <div className="mt-1 pl-2 border-l border-subtle2">
          {!temDados ? (
            <div className="text-[9px] font-mono-custom text-faint">Sem referência para este item.</div>
          ) : (
            <>
              {/* DIZER contra o que a referência foi tirada. Sem isso a pessoa não tem
                  como julgar se a comparação vale — e era a queixa: preço aparecendo
                  "distante" sem explicar de qual produto ele saiu. */}
              <div className="text-[8.5px] font-mono-custom text-faint mb-1">
                {codigoPdm
                  ? <>catálogo CATMAT · <span className="text-muted">{nomePdm ?? `PDM ${codigoPdm}`}</span></>
                  : <>aproximação por termo · <span className="text-amber">{termo}</span></>}
              </div>
              <div className="flex items-center gap-3 flex-wrap text-[9px] font-mono-custom">
                <span className="text-faint uppercase tracking-wide text-[8px]">por unidade:</span>
                <span className="text-faint">mín <span className="text-emerald-400 font-bold">{formatBRL(stats!.valorMin)}</span></span>
                <span className="text-faint">mediana <span className="text-accent font-bold">{formatBRL(stats!.valorMediano)}</span></span>
                <span className="text-faint">máx <span className="text-brand-red font-bold">{formatBRL(stats!.valorMax)}</span></span>
                <span className="text-faint">({stats!.total} reg.)</span>
                {/* Comparação SEMPRE visível (o unitário orçado × a mediana). Quando a
                    diferença é enorme, quase sempre é unidade de fornecimento diferente
                    (ex.: caixa c/ 100 no Compras.gov × unidade no edital) — sinalizamos. */}
                {diff !== null && (
                  Math.abs(diff) < 3 ? (
                    <span className={diff <= 0 ? 'text-emerald-400' : 'text-amber'}>
                      orçado {diff <= 0 ? 'abaixo' : 'acima'} {Math.abs(Math.round(diff * 100))}%
                    </span>
                  ) : (
                    <span className="text-amber">orçado {(valorUnitario / mediana).toFixed(1)}× a mediana — verifique a unidade</span>
                  )
                )}
              </div>
              {/* Unidade de fornecimento: edital × Compras.gov. Torna VISÍVEL o descasamento
                  (ex.: edital "UN" × Compras.gov "CX C/100") que distorce a comparação. */}
              {stats!.unidades && stats!.unidades.length > 0 && (() => {
                const topCg = stats!.unidades![0].sigla
                const edital = (unidadeEdital ?? '').trim().toUpperCase()
                const divergente = !!edital && !!topCg && edital !== topCg
                return (
                  <div className={`flex items-center gap-1.5 flex-wrap text-[8px] font-mono-custom mt-0.5 ${divergente ? 'text-amber' : 'text-faint'}`}>
                    <span className="uppercase tracking-wide">unid.:</span>
                    {edital && <span>edital <span className="font-bold">{edital}</span></span>}
                    <span>Compras.gov <span className="font-bold">{stats!.unidades!.slice(0, 2).map((u) => `${u.sigla} (${u.n})`).join(', ')}</span></span>
                    {divergente && <span className="font-bold">⚠ unidades diferentes</span>}
                  </div>
                )
              })()}
              <div className="flex items-center gap-1 text-[8px] font-mono-custom text-faint mt-0.5">
                <AlertTriangle size={8} className="text-amber flex-shrink-0" />
                aproximado — sem CATMAT, resolução por texto e unidades podem variar
                <a
                  href={`/precos?q=${encodeURIComponent(termo)}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-0.5 ml-1 hover:text-accent"
                >
                  <ExternalLink size={8} /> Painel de Preços
                </a>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
