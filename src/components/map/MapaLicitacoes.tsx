'use client'
// src/components/map/MapaLicitacoes.tsx
// Dynamic import only — do NOT import this file with SSR enabled.

import { useState, useEffect, useCallback } from 'react'
import Map, { Marker, Popup, NavigationControl } from 'react-map-gl/mapbox'
import 'mapbox-gl/dist/mapbox-gl.css'
import { clsx } from 'clsx'
import type { Oportunidade } from '@/lib/types'
import { CATEGORIA_CHART_COLOR as CAT_COLOR, CATEGORIA_LABEL as CAT_LABEL } from '@/lib/categorias'
import { formatBRLCompact as formatBRL } from '@/lib/format'
import { publishDataStatus } from '@/lib/data-status'

// ── Estado → coordenadas da capital ──────────────────────────────────────────

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

// Add small jitter so pins from same state don't overlap
function jitter(base: number) {
  return base + (Math.random() - 0.5) * 1.2
}


// ── Component ─────────────────────────────────────────────────────────────────

interface PinData extends Oportunidade { pinLat: number; pinLng: number }

export default function MapaLicitacoes() {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''
  const hasToken = token.startsWith('pk.')

  const [opps, setOpps] = useState<PinData[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<PinData | null>(null)
  const [catFilter, setCatFilter] = useState<string | null>(null)

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
          return {
            ...o,
            pinLat: o.lat ?? jitter(base[0]),
            pinLng: o.lng ?? jitter(base[1]),
          }
        })
      setOpps(pins)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const visible = catFilter ? opps.filter((o) => o.categoria === catFilter) : opps

  if (!hasToken) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg3/20 rounded-xl border border-subtle m-6">
        <div className="text-center px-6 py-10 max-w-sm">
          <div className="text-[28px] mb-3">🗺️</div>
          <div className="text-[14px] font-heading font-semibold text-strong mb-2">
            Token Mapbox necessário
          </div>
          <p className="text-[12px] text-muted mb-4">
            Configure <code className="text-accent font-mono-custom">NEXT_PUBLIC_MAPBOX_TOKEN</code> no <code className="text-faint font-mono-custom">.env.local</code> para ativar o mapa interativo.
          </p>
          <a
            href="https://account.mapbox.com/access-tokens"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block px-4 py-2 bg-accent text-black text-[12px] font-semibold rounded-lg hover:bg-accent/90 transition-colors"
          >
            Obter token gratuito →
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 relative">
      {/* Map */}
      <Map
        mapboxAccessToken={token}
        initialViewState={{ longitude: -52, latitude: -14, zoom: 3.8 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        onClick={() => setSelected(null)}
      >
        <NavigationControl position="top-right" />

        {visible.map((o) => (
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
                width: 10,
                height: 10,
                background: CAT_COLOR[o.categoria] ?? '#94a3b8',
                opacity: 0.85,
                border: '1.5px solid rgba(255,255,255,0.3)',
                boxShadow: `0 0 6px ${CAT_COLOR[o.categoria] ?? '#94a3b8'}80`,
              }}
            />
          </Marker>
        ))}

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
                <button
                  onClick={() => setSelected(null)}
                  className="text-faint hover:text-strong text-[14px] leading-none flex-shrink-0"
                >
                  ×
                </button>
              </div>
              <p className="text-[10px] text-muted line-clamp-2 mb-2">{selected.descricao}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full"
                  style={{ background: `${CAT_COLOR[selected.categoria]}20`, color: CAT_COLOR[selected.categoria] }}
                >
                  {CAT_LABEL[selected.categoria]}
                </span>
                <span className="text-[9px] font-mono-custom text-faint">{selected.municipio} / {selected.uf}</span>
                <span className="ml-auto text-[11px] font-mono-custom font-bold text-accent">
                  {formatBRL(selected.valorEstimado)}
                </span>
              </div>
              {selected.licitacaoRelacionada?.linkSistemaOrigem && (
                <a
                  href={selected.licitacaoRelacionada.linkSistemaOrigem}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block mt-2 text-[10px] font-mono-custom text-accent hover:underline"
                >
                  Ver no PNCP →
                </a>
              )}
            </div>
          </Popup>
        )}
      </Map>

      {/* Category filter overlay */}
      <div className="absolute bottom-4 left-4 flex flex-wrap gap-1.5 max-w-xs">
        <button
          onClick={() => setCatFilter(null)}
          className={clsx(
            'px-2.5 py-1 rounded-full text-[10px] font-mono-custom font-semibold shadow transition-all',
            !catFilter ? 'bg-white text-black' : 'bg-black/60 text-strong hover:bg-black/80'
          )}
        >
          Todos ({opps.length})
        </button>
        {Object.entries(CAT_COLOR).map(([cat, color]) => {
          const count = opps.filter((o) => o.categoria === cat).length
          if (count === 0) return null
          return (
            <button
              key={cat}
              onClick={() => setCatFilter(catFilter === cat ? null : cat)}
              className={clsx(
                'px-2.5 py-1 rounded-full text-[10px] font-mono-custom font-semibold shadow transition-all',
                catFilter === cat ? 'ring-2 ring-white' : 'hover:opacity-100 opacity-80'
              )}
              style={{
                background: catFilter === cat ? color : `${color}30`,
                color: catFilter === cat ? '#000' : color,
              }}
            >
              {CAT_LABEL[cat]} ({count})
            </button>
          )
        })}
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 bg-bg/50 flex items-center justify-center pointer-events-none">
          <div className="bg-bg2 border border-subtle rounded-xl px-4 py-2 text-[12px] text-faint font-mono-custom">
            Carregando licitações…
          </div>
        </div>
      )}
    </div>
  )
}
