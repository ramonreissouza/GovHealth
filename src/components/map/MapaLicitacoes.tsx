'use client'
// src/components/map/MapaLicitacoes.tsx
// Mapa de licitações em MapLibre + OpenFreeMap (tiles 100% gratuitos, SEM token/chave)
// com "Meu território": o vendedor marca as UFs onde atua e o mapa filtra/destaca o
// que é dele. Dynamic import only — não importar com SSR habilitado.

import { useState, useEffect, useCallback } from 'react'
import Map, { Marker, Popup, NavigationControl } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { clsx } from 'clsx'
import { MapPin, Filter, X, ChevronDown } from 'lucide-react'
import type { Oportunidade } from '@/lib/types'
import { CATEGORIA_CHART_COLOR as CAT_COLOR, CATEGORIA_LABEL as CAT_LABEL } from '@/lib/categorias'
import { formatBRLCompact as formatBRL } from '@/lib/format'
import { publishDataStatus } from '@/lib/data-status'
import { REGIOES, TODAS_UFS, getTerritorio, setTerritorio, toggleUF, toggleRegiao, regiaoAtiva } from '@/lib/territorio'

// Tiles gratuitos, sem chave (https://openfreemap.org). Tema claro (positron) combina
// com a UI clara; alternativas: 'liberty' (colorido), 'bright'.
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron'

const ESTADO_COORDS: Record<string, [number, number]> = {
  AC: [-9.9750, -67.8243], AL: [-9.6660, -35.7350], AM: [-3.1019, -60.0250],
  AP: [0.0344, -51.0665],  BA: [-12.9718, -38.5011], CE: [-3.7172, -38.5434],
  DF: [-15.7794, -47.9297], ES: [-20.3155, -40.3128], GO: [-16.6864, -49.2643],
  MA: [-2.5307, -44.3068], MG: [-19.9167, -43.9345], MS: [-20.4697, -54.6201],
  MT: [-15.5989, -56.0949], PA: [-1.4550, -48.5024], PB: [-7.1153, -34.8641],
  PE: [-8.0543, -34.8813], PI: [-5.0892, -42.8016], PR: [-25.4297, -49.2713],
  RJ: [-22.9068, -43.1729], RN: [-5.7945, -35.2110], RO: [-8.7619, -63.9039],
  RR: [2.8195, -60.6733],  RS: [-30.0346, -51.2177], SC: [-27.5954, -48.5480],
  SE: [-10.9091, -37.0677], SP: [-23.5505, -46.6333], TO: [-10.2491, -48.3243],
}

function jitter(base: number) {
  return base + (Math.random() - 0.5) * 1.2
}

interface PinData extends Oportunidade { pinLat: number; pinLng: number }

export default function MapaLicitacoes() {
  const [opps, setOpps] = useState<PinData[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<PinData | null>(null)
  const [catFilter, setCatFilter] = useState<string | null>(null)

  // Território
  const [territorio, setTerr] = useState<string[]>([])
  const [soTerritorio, setSoTerritorio] = useState(false)
  const [ajustarUFs, setAjustarUFs] = useState(false)
  useEffect(() => { setTerr(getTerritorio()) }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/opportunities?limit=400&minScore=0')
      const d = await r.json()
      publishDataStatus(d)
      const raw: Oportunidade[] = d.oportunidades ?? []
      const pins: PinData[] = raw
        .filter((o) => o.uf && ESTADO_COORDS[o.uf])
        .map((o) => {
          const base = ESTADO_COORDS[o.uf]
          return { ...o, pinLat: o.lat ?? jitter(base[0]), pinLng: o.lng ?? jitter(base[1]) }
        })
      setOpps(pins)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const temTerritorio = territorio.length > 0
  const noTerritorio = (uf: string) => territorio.includes(uf)

  // Filtro por categoria + (opcional) só território.
  const visible = opps.filter((o) => {
    if (catFilter && o.categoria !== catFilter) return false
    if (soTerritorio && temTerritorio && !noTerritorio(o.uf)) return false
    return true
  })

  // Resumo do território (sobre todas as oportunidades carregadas, ignorando o toggle).
  const noTerr = opps.filter((o) => noTerritorio(o.uf))
  const valorTerr = noTerr.reduce((s, o) => s + o.valorEstimado, 0)

  function commitTerr(novo: string[]) { setTerr(novo) }

  return (
    <div className="flex-1 relative">
      <Map
        initialViewState={{ longitude: -52, latitude: -14, zoom: 3.8 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={MAP_STYLE}
        onClick={() => setSelected(null)}
      >
        <NavigationControl position="top-right" />

        {visible.map((o) => {
          const dim = temTerritorio && !soTerritorio && !noTerritorio(o.uf)
          const destaque = temTerritorio && noTerritorio(o.uf)
          return (
            <Marker
              key={o.id}
              longitude={o.pinLng}
              latitude={o.pinLat}
              anchor="center"
              onClick={(e) => { e.originalEvent.stopPropagation(); setSelected(o) }}
            >
              <div
                className="rounded-full cursor-pointer transition-transform hover:scale-125"
                title={o.descricao}
                style={{
                  width: destaque ? 12 : 10,
                  height: destaque ? 12 : 10,
                  background: CAT_COLOR[o.categoria] ?? '#94a3b8',
                  opacity: dim ? 0.25 : 0.9,
                  border: destaque ? '2px solid #2f80ed' : '1.5px solid rgba(255,255,255,0.6)',
                  boxShadow: `0 0 6px ${CAT_COLOR[o.categoria] ?? '#94a3b8'}80`,
                }}
              />
            </Marker>
          )
        })}

        {selected && (
          <Popup
            longitude={selected.pinLng}
            latitude={selected.pinLat}
            anchor="bottom"
            offset={14}
            onClose={() => setSelected(null)}
            closeButton={false}
            style={{ padding: 0 }}
          >
            <div className="bg-bg2 border border-subtle rounded-xl p-3 w-64 shadow-2xl">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="text-[12px] font-medium text-strong leading-snug line-clamp-2 flex-1">
                  {selected.hospital ?? selected.municipio}
                </div>
                <button onClick={() => setSelected(null)} className="text-faint hover:text-strong text-[14px] leading-none flex-shrink-0">×</button>
              </div>
              <p className="text-[10px] text-muted line-clamp-2 mb-2">{selected.descricao}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full" style={{ background: `${CAT_COLOR[selected.categoria]}20`, color: CAT_COLOR[selected.categoria] }}>
                  {CAT_LABEL[selected.categoria]}
                </span>
                <span className="text-[9px] font-mono-custom text-faint">{selected.municipio} / {selected.uf}</span>
                <span className="ml-auto text-[11px] font-mono-custom font-bold text-accent">{formatBRL(selected.valorEstimado)}</span>
              </div>
              {selected.licitacaoRelacionada?.linkSistemaOrigem && (
                <a href={selected.licitacaoRelacionada.linkSistemaOrigem} target="_blank" rel="noopener noreferrer" className="block mt-2 text-[10px] font-mono-custom text-accent hover:underline">
                  Ver no PNCP →
                </a>
              )}
            </div>
          </Popup>
        )}
      </Map>

      {/* Painel: Meu território (top-left) */}
      <div className="absolute top-4 left-4 bg-bg2/95 backdrop-blur border border-subtle rounded-xl p-3 shadow-lg w-[260px]">
        <div className="flex items-center gap-1.5 mb-2">
          <MapPin size={13} className="text-accent" />
          <span className="text-[12px] font-heading font-semibold text-strong">Meu território</span>
        </div>

        {/* Regiões */}
        <div className="flex flex-wrap gap-1 mb-2">
          {REGIOES.map((r) => {
            const st = regiaoAtiva(r, territorio)
            return (
              <button
                key={r.key}
                onClick={() => commitTerr(toggleRegiao(r, territorio))}
                className={clsx('text-[10px] px-2 py-1 rounded-full border transition-colors',
                  st === 'cheia' ? 'bg-accent text-black border-accent font-semibold'
                    : st === 'parcial' ? 'border-accent/50 text-accent'
                    : 'border-subtle2 text-faint hover:text-strong')}
              >
                {r.label}
              </button>
            )
          })}
        </div>

        {/* Ajuste fino por UF */}
        <button onClick={() => setAjustarUFs((v) => !v)} className="flex items-center gap-1 text-[10px] text-faint hover:text-strong transition-colors mb-1">
          <ChevronDown size={11} className={clsx('transition-transform', ajustarUFs && 'rotate-180')} /> Ajustar UFs
        </button>
        {ajustarUFs && (
          <div className="grid grid-cols-6 gap-1 mb-2">
            {TODAS_UFS.map((uf) => (
              <button
                key={uf}
                onClick={() => commitTerr(toggleUF(uf, territorio))}
                className={clsx('text-[9px] py-0.5 rounded border transition-colors',
                  noTerritorio(uf) ? 'bg-accent/15 text-accent border-accent/40' : 'border-subtle2 text-faint hover:text-strong')}
              >
                {uf}
              </button>
            ))}
          </div>
        )}

        {/* Resumo + ações */}
        {temTerritorio ? (
          <div className="border-t border-subtle pt-2 mt-1">
            <div className="text-[11px] text-strong">
              <strong>{territorio.length}</strong> UF{territorio.length > 1 ? 's' : ''} · <strong>{noTerr.length}</strong> oportunidades
            </div>
            <div className="text-[11px] text-accent font-mono-custom">{formatBRL(valorTerr)} em jogo</div>
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => setSoTerritorio((v) => !v)}
                className={clsx('flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border transition-colors',
                  soTerritorio ? 'bg-accent/15 text-accent border-accent/40' : 'border-subtle2 text-faint hover:text-strong')}
              >
                <Filter size={11} /> {soTerritorio ? 'Filtrando' : 'Filtrar mapa'}
              </button>
              <button onClick={() => { commitTerr(setTerritorio([])); setSoTerritorio(false) }} className="flex items-center gap-1 text-[10px] text-faint hover:text-red transition-colors">
                <X size={11} /> Limpar
              </button>
            </div>
          </div>
        ) : (
          <p className="text-[10px] text-faint border-t border-subtle pt-2 mt-1">Escolha suas regiões/UFs para destacar e filtrar o que é seu.</p>
        )}
      </div>

      {/* Filtro por categoria (bottom-left) */}
      <div className="absolute bottom-4 left-4 flex flex-wrap gap-1.5 max-w-xs">
        <button
          onClick={() => setCatFilter(null)}
          className={clsx('px-2.5 py-1 rounded-full text-[10px] font-mono-custom font-semibold shadow transition-all',
            !catFilter ? 'bg-accent text-black' : 'bg-bg2/80 text-strong border border-subtle hover:bg-bg3')}
        >
          Todos ({visible.length})
        </button>
        {Object.entries(CAT_COLOR).map(([cat, color]) => {
          const count = opps.filter((o) => o.categoria === cat).length
          if (count === 0) return null
          return (
            <button
              key={cat}
              onClick={() => setCatFilter(catFilter === cat ? null : cat)}
              className={clsx('px-2.5 py-1 rounded-full text-[10px] font-mono-custom font-semibold shadow transition-all',
                catFilter === cat ? 'ring-2 ring-accent' : 'hover:opacity-100 opacity-80')}
              style={{ background: catFilter === cat ? color : `${color}30`, color: catFilter === cat ? '#000' : color }}
            >
              {CAT_LABEL[cat]} ({count})
            </button>
          )
        })}
      </div>

      {loading && (
        <div className="absolute inset-0 bg-bg/50 flex items-center justify-center pointer-events-none">
          <div className="bg-bg2 border border-subtle rounded-xl px-4 py-2 text-[12px] text-faint font-mono-custom">Carregando licitações…</div>
        </div>
      )}
    </div>
  )
}
