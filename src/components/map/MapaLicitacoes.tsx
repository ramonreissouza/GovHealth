'use client'
// src/components/map/MapaLicitacoes.tsx
// Mapa de calor de licitações em MapLibre + OpenFreeMap (tiles grátis, SEM token).
// Dados AGREGADOS por município (/api/mapa) → ~4,6k pontos representando as ~69k
// contratações abertas (não só a capital, cidades do interior incluídas).
//  • zoom baixo  → heatmap (densidade de licitações)
//  • zoom alto   → círculos por município (raio = nº de licitações), clicáveis
// "Meu território" destaca/filtra as UFs do vendedor. Dynamic import only (sem SSR).

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Map, { Source, Layer, Popup, type MapLayerMouseEvent, type LayerProps, type MapRef } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { clsx } from 'clsx'
import { MapPin, Filter, X, ChevronDown, Plus, Minus, ZoomIn } from 'lucide-react'
import { CATEGORIA_CHART_COLOR as CAT_COLOR, CATEGORIA_LABEL as CAT_LABEL } from '@/lib/categorias'
import { formatBRLCompact as formatBRL } from '@/lib/format'
import { publishDataStatus } from '@/lib/data-status'
import { REGIOES, TODAS_UFS, getTerritorio, setTerritorio, toggleUF, toggleRegiao, regiaoAtiva } from '@/lib/territorio'

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron'
const ZOOM_CORTE = 6.5 // abaixo: heatmap; acima: círculos

interface MunicipioPonto {
  uf: string; municipio: string; lat: number; lng: number
  n: number; valor: number; cats: Record<string, number>
}

function catDominante(cats: Record<string, number>): string {
  let top = 'outros', max = -1
  for (const [k, v] of Object.entries(cats)) if (v > max) { max = v; top = k }
  return top
}

// ── Camadas MapLibre ──────────────────────────────────────────────────────────
const heatmapLayer: LayerProps = {
  id: 'municipios-heat',
  type: 'heatmap',
  source: 'municipios',
  maxzoom: ZOOM_CORTE + 1.5,
  paint: {
    // Peso pela contagem de licitações (log-ish: satura em ~80).
    'heatmap-weight': ['interpolate', ['linear'], ['get', 'count'], 0, 0, 5, 0.25, 20, 0.6, 80, 1],
    'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 3, 1, 6, 2.2],
    'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
      0, 'rgba(47,128,237,0)', 0.2, 'rgba(47,128,237,0.5)', 0.4, 'rgba(34,197,94,0.6)',
      0.6, 'rgba(245,158,11,0.75)', 0.8, 'rgba(239,68,68,0.85)', 1, 'rgba(220,38,38,0.95)'],
    'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 3, 14, 6, 30],
    // Some conforme aproxima (dá lugar aos círculos).
    'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], ZOOM_CORTE - 0.5, 0.9, ZOOM_CORTE + 1.5, 0],
  },
}

const circleLayer: LayerProps = {
  id: 'municipios-circles',
  type: 'circle',
  source: 'municipios',
  minzoom: ZOOM_CORTE - 0.5,
  paint: {
    // Raio cresce com o nº de licitações e com o zoom.
    'circle-radius': ['interpolate', ['linear'], ['zoom'],
      ZOOM_CORTE, ['interpolate', ['linear'], ['get', 'count'], 1, 3, 20, 8, 100, 16],
      12, ['interpolate', ['linear'], ['get', 'count'], 1, 6, 20, 18, 100, 40]],
    'circle-color': ['get', 'color'],
    'circle-opacity': ['interpolate', ['linear'], ['zoom'], ZOOM_CORTE - 0.5, 0, ZOOM_CORTE + 1, 0.82],
    'circle-stroke-width': ['case', ['get', 'terr'], 2, 1],
    'circle-stroke-color': ['case', ['get', 'terr'], '#2f80ed', 'rgba(255,255,255,0.7)'],
    'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], ZOOM_CORTE - 0.5, 0, ZOOM_CORTE + 1, 1],
  },
}

interface SelInfo { uf: string; municipio: string; lat: number; lng: number; n: number; valor: number; catTop: string }

export default function MapaLicitacoes() {
  const [pontos, setPontos] = useState<MunicipioPonto[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<SelInfo | null>(null)
  const [catFilter, setCatFilter] = useState<string | null>(null)
  const [zoom, setZoom] = useState(3.8)
  const mapRef = useRef<MapRef>(null)

  // Território
  const [territorio, setTerr] = useState<string[]>([])
  const [soTerritorio, setSoTerritorio] = useState(false)
  const [ajustarUFs, setAjustarUFs] = useState(false)
  useEffect(() => { setTerr(getTerritorio()) }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/mapa')
      const d = await r.json()
      publishDataStatus(d)
      setPontos(d.pontos ?? [])
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const temTerritorio = territorio.length > 0

  // GeoJSON reativo aos filtros (categoria + território). O `count` é a métrica do
  // heatmap/raio: nº total do município ou, se filtrando categoria, só daquela.
  const geojson = useMemo(() => {
    const feats = []
    for (const p of pontos) {
      const count = catFilter ? (p.cats[catFilter] ?? 0) : p.n
      if (count <= 0) continue
      if (soTerritorio && temTerritorio && !territorio.includes(p.uf)) continue
      const catTop = catFilter ?? catDominante(p.cats)
      feats.push({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
        properties: {
          uf: p.uf, municipio: p.municipio, n: p.n, valor: p.valor, count,
          catTop, color: CAT_COLOR[catTop] ?? '#94a3b8', terr: territorio.includes(p.uf),
        },
      })
    }
    return { type: 'FeatureCollection' as const, features: feats }
  }, [pontos, catFilter, soTerritorio, temTerritorio, territorio])

  // Stats do escopo visível.
  const stats = useMemo(() => {
    let mun = 0, lic = 0, valor = 0
    for (const f of geojson.features) { mun++; lic += f.properties.n; valor += f.properties.valor }
    return { mun, lic, valor }
  }, [geojson])

  const noTerr = useMemo(() => {
    const p = pontos.filter((x) => territorio.includes(x.uf))
    return { n: p.reduce((s, x) => s + x.n, 0), valor: p.reduce((s, x) => s + x.valor, 0) }
  }, [pontos, territorio])

  const onClickMapa = useCallback((e: MapLayerMouseEvent) => {
    const f = e.features?.[0]
    if (!f) { setSelected(null); return }
    const pr = f.properties as { uf: string; municipio: string; n: number; valor: number; catTop: string }
    const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates
    setSelected({ uf: pr.uf, municipio: pr.municipio, lat, lng, n: pr.n, valor: pr.valor, catTop: pr.catTop })
  }, [])

  function commitTerr(novo: string[]) { setTerr(novo) }

  const catsPresentes = useMemo(() => {
    const tot: Record<string, number> = {}
    for (const p of pontos) for (const [k, v] of Object.entries(p.cats)) tot[k] = (tot[k] ?? 0) + v
    return tot
  }, [pontos])

  return (
    <div className="flex-1 relative">
      <Map
        ref={mapRef}
        initialViewState={{ longitude: -52, latitude: -14, zoom: 3.8 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={MAP_STYLE}
        interactiveLayerIds={['municipios-circles']}
        onClick={onClickMapa}
        onZoom={(e) => setZoom(e.viewState.zoom)}
        cursor={zoom >= ZOOM_CORTE ? 'pointer' : 'grab'}
      >
        <Source id="municipios" type="geojson" data={geojson}>
          <Layer {...heatmapLayer} />
          <Layer {...circleLayer} />
        </Source>

        {selected && (
          <Popup longitude={selected.lng} latitude={selected.lat} anchor="bottom" offset={14}
            onClose={() => setSelected(null)} closeButton={false} style={{ padding: 0 }}>
            <div className="bg-bg2 border border-subtle rounded-xl p-3 w-56 shadow-2xl">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="text-[13px] font-semibold text-strong leading-snug">{selected.municipio} <span className="text-faint font-mono-custom text-[10px]">/ {selected.uf}</span></div>
                <button onClick={() => setSelected(null)} className="text-faint hover:text-strong text-[14px] leading-none flex-shrink-0">×</button>
              </div>
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full" style={{ background: `${CAT_COLOR[selected.catTop]}20`, color: CAT_COLOR[selected.catTop] }}>
                  {CAT_LABEL[selected.catTop] ?? selected.catTop}
                </span>
                <span className="ml-auto text-[11px] font-mono-custom font-bold text-accent">{formatBRL(selected.valor)}</span>
              </div>
              <div className="text-[11px] text-strong"><strong>{selected.n}</strong> licitaç{selected.n !== 1 ? 'ões' : 'ão'} aberta{selected.n !== 1 ? 's' : ''}</div>
              <a href={`/oportunidades?uf=${selected.uf}&municipio=${encodeURIComponent(selected.municipio)}`}
                className="mt-2 flex items-center justify-center gap-1 bg-accent text-black text-[11px] font-semibold rounded-md px-2 py-1.5 hover:bg-accent/90 transition-colors">
                Ver as {selected.n} licitações desta cidade →
              </a>
            </div>
          </Popup>
        )}
      </Map>

      {/* Controle de zoom +/- (alternativa ao scroll do mouse) */}
      <div className="absolute top-4 right-4 flex flex-col rounded-lg overflow-hidden border border-subtle shadow-lg">
        <button onClick={() => mapRef.current?.zoomIn()} title="Aproximar"
          className="w-9 h-9 bg-bg2/95 backdrop-blur text-strong hover:bg-bg3 flex items-center justify-center border-b border-subtle transition-colors">
          <Plus size={16} />
        </button>
        <button onClick={() => mapRef.current?.zoomOut()} title="Afastar"
          className="w-9 h-9 bg-bg2/95 backdrop-blur text-strong hover:bg-bg3 flex items-center justify-center transition-colors">
          <Minus size={16} />
        </button>
      </div>

      {/* Dica de zoom (só no modo heatmap, quando ainda está afastado) */}
      {zoom < ZOOM_CORTE && !loading && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-bg2/90 backdrop-blur border border-subtle rounded-full px-3 py-1.5 text-[11px] text-muted shadow">
          <ZoomIn size={13} className="text-accent" />
          Dê zoom para ver melhor cada região
        </div>
      )}

      {/* Painel: Meu território (top-left) */}
      <div className="absolute top-4 left-4 bg-bg2/95 backdrop-blur border border-subtle rounded-xl p-3 shadow-lg w-[260px]">
        <div className="flex items-center gap-1.5 mb-1">
          <MapPin size={13} className="text-accent" />
          <span className="text-[12px] font-heading font-semibold text-strong">Meu território</span>
        </div>
        <div className="text-[10px] text-faint font-mono-custom mb-2">
          {stats.mun.toLocaleString('pt-BR')} municípios · {stats.lic.toLocaleString('pt-BR')} licitações abertas
        </div>

        <div className="flex flex-wrap gap-1 mb-2">
          {REGIOES.map((r) => {
            const st = regiaoAtiva(r, territorio)
            return (
              <button key={r.key} onClick={() => commitTerr(toggleRegiao(r, territorio))}
                className={clsx('text-[10px] px-2 py-1 rounded-full border transition-colors',
                  st === 'cheia' ? 'bg-accent text-black border-accent font-semibold'
                    : st === 'parcial' ? 'border-accent/50 text-accent'
                    : 'border-subtle2 text-faint hover:text-strong')}>
                {r.label}
              </button>
            )
          })}
        </div>

        <button onClick={() => setAjustarUFs((v) => !v)} className="flex items-center gap-1 text-[10px] text-faint hover:text-strong transition-colors mb-1">
          <ChevronDown size={11} className={clsx('transition-transform', ajustarUFs && 'rotate-180')} /> Ajustar UFs
        </button>
        {ajustarUFs && (
          <div className="grid grid-cols-6 gap-1 mb-2">
            {TODAS_UFS.map((uf) => (
              <button key={uf} onClick={() => commitTerr(toggleUF(uf, territorio))}
                className={clsx('text-[9px] py-0.5 rounded border transition-colors',
                  territorio.includes(uf) ? 'bg-accent/15 text-accent border-accent/40' : 'border-subtle2 text-faint hover:text-strong')}>
                {uf}
              </button>
            ))}
          </div>
        )}

        {temTerritorio ? (
          <div className="border-t border-subtle pt-2 mt-1">
            <div className="text-[11px] text-strong">
              <strong>{territorio.length}</strong> UF{territorio.length > 1 ? 's' : ''} · <strong>{noTerr.n.toLocaleString('pt-BR')}</strong> licitações
            </div>
            <div className="text-[11px] text-accent font-mono-custom">{formatBRL(noTerr.valor)} em jogo</div>
            <div className="flex items-center gap-2 mt-2">
              <button onClick={() => setSoTerritorio((v) => !v)}
                className={clsx('flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border transition-colors',
                  soTerritorio ? 'bg-accent/15 text-accent border-accent/40' : 'border-subtle2 text-faint hover:text-strong')}>
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
      <div className="absolute bottom-4 left-4 flex flex-wrap gap-1.5 max-w-md">
        <button onClick={() => setCatFilter(null)}
          className={clsx('px-2.5 py-1 rounded-full text-[10px] font-mono-custom font-semibold shadow transition-all',
            !catFilter ? 'bg-accent text-black' : 'bg-bg2/80 text-strong border border-subtle hover:bg-bg3')}>
          Todas ({stats.lic.toLocaleString('pt-BR')})
        </button>
        {Object.entries(CAT_COLOR).map(([cat, color]) => {
          const count = catsPresentes[cat] ?? 0
          if (count === 0) return null
          return (
            <button key={cat} onClick={() => setCatFilter(catFilter === cat ? null : cat)}
              className={clsx('px-2.5 py-1 rounded-full text-[10px] font-mono-custom font-semibold shadow transition-all',
                catFilter === cat ? 'ring-2 ring-accent' : 'hover:opacity-100 opacity-80')}
              style={{ background: catFilter === cat ? color : `${color}30`, color: catFilter === cat ? '#000' : color }}>
              {CAT_LABEL[cat] ?? cat} ({count.toLocaleString('pt-BR')})
            </button>
          )
        })}
      </div>

      {loading && (
        <div className="absolute inset-0 bg-bg/50 flex items-center justify-center pointer-events-none">
          <div className="bg-bg2 border border-subtle rounded-xl px-4 py-2 text-[12px] text-faint font-mono-custom">Carregando mapa de calor…</div>
        </div>
      )}
    </div>
  )
}
