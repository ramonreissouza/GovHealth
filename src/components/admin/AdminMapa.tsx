'use client'
// src/components/admin/AdminMapa.tsx — mapa de acessos (MapLibre + OpenFreeMap, sem
// chave). Plota pontos do log agregados por coordenada, tamanho ~ nº de acessos.
// Dynamic import only (ssr:false).

import { useState, useEffect } from 'react'
import Map, { Marker, Popup } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Loader2 } from 'lucide-react'

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron'

interface Ponto { latitude: number; longitude: number; cidade: string | null; pais: string | null; n: number; ultimo: string }

export default function AdminMapa({ dias }: { dias: number }) {
  const [pontos, setPontos] = useState<Ponto[]>([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<Ponto | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/admin/acessos/mapa?dias=${dias}`)
      .then((r) => r.json())
      .then((d) => setPontos(d.pontos ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [dias])

  const max = Math.max(1, ...pontos.map((p) => p.n))

  return (
    <div className="relative h-[560px] rounded-xl overflow-hidden border border-subtle">
      <Map initialViewState={{ longitude: -52, latitude: -14, zoom: 3.4 }} style={{ width: '100%', height: '100%' }} mapStyle={MAP_STYLE} onClick={() => setSel(null)}>
        {pontos.map((p, i) => {
          const size = 10 + Math.round((p.n / max) * 22)
          return (
            <Marker key={i} longitude={p.longitude} latitude={p.latitude} anchor="center"
              onClick={(e) => { e.originalEvent.stopPropagation(); setSel(p) }}>
              <div className="rounded-full cursor-pointer flex items-center justify-center text-[9px] font-bold text-black"
                style={{ width: size, height: size, background: '#2f80edcc', border: '2px solid #fff', boxShadow: '0 0 8px #2f80ed80' }}>
                {p.n > 1 ? p.n : ''}
              </div>
            </Marker>
          )
        })}
        {sel && (
          <Popup longitude={sel.longitude} latitude={sel.latitude} anchor="bottom" offset={14} closeButton={false} onClose={() => setSel(null)} style={{ padding: 0 }}>
            <div className="bg-bg2 border border-subtle rounded-xl p-3 w-52 shadow-2xl">
              <div className="text-[12px] font-semibold text-strong">{sel.cidade || 'Local'}{sel.pais ? ` · ${sel.pais}` : ''}</div>
              <div className="text-[11px] text-muted mt-1">{sel.n} acesso{sel.n > 1 ? 's' : ''}</div>
              <div className="text-[10px] text-faint font-mono-custom mt-0.5">último: {sel.ultimo.replace('T', ' ')}</div>
            </div>
          </Popup>
        )}
      </Map>

      {loading && (
        <div className="absolute inset-0 bg-bg/40 flex items-center justify-center pointer-events-none">
          <Loader2 size={20} className="animate-spin text-faint" />
        </div>
      )}
      {!loading && pontos.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-bg2/95 border border-subtle rounded-xl px-5 py-4 text-center max-w-sm">
            <div className="text-[13px] text-strong font-semibold mb-1">Sem dados de geolocalização</div>
            <p className="text-[12px] text-muted">Os pontos aparecem a partir dos acessos em produção (headers da Vercel). Acessos locais/dev não têm coordenadas.</p>
          </div>
        </div>
      )}
    </div>
  )
}
