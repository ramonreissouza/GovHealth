'use client'
// src/app/radar/components/SaudeConectores.tsx — REQUISITO 4.2.
// Mostra o estado de cada conector distinguindo claramente "verificado OK" de
// "não foi possível verificar" — nunca deixa o usuário achar que está protegido
// quando a sessão expirou ou o portal caiu.

import { clsx } from 'clsx'
import { ShieldCheck, ShieldAlert, ShieldQuestion, Loader2 } from 'lucide-react'
import { rotuloSaude, tempoDesde, confiavelAgora } from '@/lib/radar/saude'
import { nomeConector } from '@/lib/radar/conectores'
import type { StatusSaude } from '@/lib/radar/types'

export interface SaudeItem {
  credencialId: string
  conectorId: string
  cnpj: string
  status: StatusSaude
  verificadoEm: string | null
  tentadoEm: string | null
  detalhe: string | null
}

const COR_CLS: Record<string, string> = {
  verde: 'bg-emerald-500/12 text-emerald-400 border-emerald-500/30',
  amarelo: 'bg-amber/15 text-amber border-amber/30',
  vermelho: 'bg-red/15 text-red border-red/30',
  cinza: 'bg-bg4 text-faint border-subtle2',
}

export default function SaudeConectores({ saude, agoraMs }: { saude: SaudeItem[]; agoraMs: number }) {
  if (saude.length === 0) {
    return (
      <div className="bg-bg2 border border-subtle rounded-xl p-4 text-[12px] text-muted">
        Nenhum conector configurado. Conecte um portal (Compras.gov.br disponível; BLL, Portal de Compras Públicas e Licitações-e em breve) para o Radar começar a monitorar os chats.
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {saude.map((s) => {
        const r = rotuloSaude(s.status)
        const confiavel = confiavelAgora(s, agoraMs)
        const Icon = r.cor === 'verde' ? ShieldCheck : r.cor === 'cinza' ? ShieldQuestion : ShieldAlert
        return (
          <div key={s.credencialId} className={clsx('rounded-xl border p-3.5', COR_CLS[r.cor])}>
            <div className="flex items-center gap-2">
              <Icon size={15} />
              <span className="text-[12px] font-semibold">{nomeConector(s.conectorId)}</span>
            </div>
            <div className="text-[10.5px] font-mono-custom opacity-80 mt-0.5">CNPJ {s.cnpj || '—'}</div>
            <div className="text-[12px] mt-2 leading-snug">{r.titulo}</div>
            <div className="text-[10.5px] opacity-80 mt-1 flex items-center gap-1">
              {s.status === 'nunca_verificado' && <Loader2 size={10} className="animate-spin" />}
              {confiavel
                ? `verificado ${tempoDesde(s.verificadoEm, agoraMs)} · sem novidades`
                : s.verificadoEm
                ? `última verificação OK ${tempoDesde(s.verificadoEm, agoraMs)}`
                : `tentativa ${tempoDesde(s.tentadoEm, agoraMs)}`}
            </div>
            {s.detalhe && !confiavel && <div className="text-[10.5px] opacity-70 mt-1 truncate" title={s.detalhe}>{s.detalhe}</div>}
          </div>
        )
      })}
    </div>
  )
}
