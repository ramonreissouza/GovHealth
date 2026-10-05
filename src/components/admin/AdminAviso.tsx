'use client'
// src/components/admin/AdminAviso.tsx — aba Aviso do admin: quanto tempo o Aviso do
// Radar leva, do pregoeiro escrever até o cliente saber, etapa por etapa, contra a meta
// de p95 ≤ 60 s. Os números e o porquê de cada recorte: src/lib/radar/latencia-aviso.ts.

import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { AlertTriangle } from 'lucide-react'
import type { Faixa, PainelAviso } from '@/lib/radar/latencia-aviso'

const num = (n: number) => n.toLocaleString('pt-BR')

/** 45 s · 12 min · 3,2 h · 40 d */
function dur(s: number | null): string {
  if (s == null) return '—'
  if (s < 90) return `${s} s`
  if (s < 90 * 60) return `${Math.round(s / 60)} min`
  if (s < 48 * 3600) return `${(s / 3600).toFixed(1).replace('.', ',')} h`
  return `${Math.round(s / 86400)} d`
}

const pct = (f: number | null) => (f == null ? '—' : `${Math.round(f * 100)}%`)

type Estado = 'ok' | 'atencao' | 'critico' | 'vazio'
function estadoDe(p95: number | null, meta: number): Estado {
  if (p95 == null) return 'vazio'
  if (p95 <= meta) return 'ok'
  return p95 <= 5 * meta ? 'atencao' : 'critico'
}
const PILL: Record<Estado, { txt: string; cls: string }> = {
  ok: { txt: 'Na meta', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  atencao: { txt: 'Acima da meta', cls: 'bg-amber/15 text-amber border-amber/30' },
  critico: { txt: 'Muito acima', cls: 'bg-red/15 text-red border-red/30' },
  vazio: { txt: 'Sem amostra', cls: 'bg-bg4 text-faint border-subtle2' },
}

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Na fila', enviando: 'Enviando', enviado: 'Enviado na hora', falha: 'Falhou',
  aguardando_resumo: 'Para o resumo do dia', resumindo: 'Montando o resumo', resumido: 'Foi no resumo do dia',
  expirado: 'Expirou (mais de 48 h)', entregue: 'Lido na tela antes do e-mail',
}

export default function AdminAviso() {
  const [dias, setDias] = useState('7')
  const [d, setD] = useState<PainelAviso | null>(null)
  const [erro, setErro] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true); setErro(false)
    fetch(`/api/admin/aviso?dias=${dias}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setD)
      .catch(() => setErro(true))
      .finally(() => setLoading(false))
  }, [dias])

  const travada = d && d.fila.pendentes > 0 && (d.fila.maisAntigoMin ?? 0) > 15
  // O coletor passa várias vezes ao dia; 6 h sem ler nada de nenhum portal é parada.
  const semCaptura = d && d.semCapturaHaMin != null && d.semCapturaHaMin > 6 * 60

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="font-heading font-bold text-[20px]">Aviso do Radar</h1>
          <p className="text-[12px] text-muted max-w-[640px]">
            Quanto tempo vai do pregoeiro escrever no chat até o cliente saber. Meta: 95% dos avisos em até {d?.metaS ?? 60} s.
            Conta só mensagem escrita depois que o pregão passou a ser monitorado.
          </p>
        </div>
        <select value={dias} onChange={(e) => setDias(e.target.value)} aria-label="Período"
          className="text-[12px] bg-bg2 border border-subtle rounded-lg px-2 py-2 focus:border-accent outline-none">
          <option value="1">Hoje</option><option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option>
        </select>
      </div>

      {erro && <p className="text-[13px] text-red py-6">Não foi possível medir o Aviso agora. Tente de novo em instantes.</p>}
      {loading && !d && !erro && <div className="text-faint text-[13px] py-10 text-center">Medindo…</div>}

      {d && (
        <div className={clsx('space-y-4', loading && 'opacity-60')}>
          {semCaptura && (
            <div className="flex gap-2.5 items-start bg-red/10 border border-red/30 rounded-xl px-4 py-3 text-[12px]">
              <AlertTriangle size={15} className="text-red shrink-0 mt-0.5" />
              <div>
                <strong className="text-strong">Nenhuma mensagem lida de nenhum portal há {dur((d.semCapturaHaMin ?? 0) * 60)}.</strong>{' '}
                <span className="text-muted">Sem captura, nenhum aviso sai, por mais rápido que o resto seja. Confira se o coletor do Radar está rodando.</span>
              </div>
            </div>
          )}

          {travada && (
            <div className="flex gap-2.5 items-start bg-amber/10 border border-amber/30 rounded-xl px-4 py-3 text-[12px]">
              <AlertTriangle size={15} className="text-amber shrink-0 mt-0.5" />
              <div>
                <strong className="text-strong">A fila de e-mail não está andando.</strong>{' '}
                <span className="text-muted">
                  {num(d.fila.pendentes)} {d.fila.pendentes === 1 ? 'aviso esperando' : 'avisos esperando'}; o mais antigo há {dur((d.fila.maisAntigoMin ?? 0) * 60)}.
                  O worker só envia com RESEND_API_KEY ou as chaves VAPID configuradas, e na primeira rodada expira o que passou de 48 h.
                </span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Etapa titulo="Ponta a ponta" sub="pregoeiro escreveu → aviso saiu" f={d.pontaAPonta} meta={d.metaS} destaque />
            <Etapa titulo="Captura" sub="pregoeiro escreveu → nós lemos" f={d.captura} meta={d.metaS}
              nota={d.captura.futuro > 0 ? <span className="text-amber">{num(d.captura.futuro)} com a hora do portal depois da leitura (fuso ou relógio errado; fora da conta)</span> : undefined} />
            <Etapa titulo="Envio" sub="nós lemos → aviso saiu (worker a cada 5 min)" f={d.envio} meta={d.metaS}
              nota={d.envio.falhas > 0 ? <span className="text-red">{num(d.envio.falhas)} falharam</span> : undefined} />
            <EtapaVi f={d.vi} repasses={d.repasses} />
          </div>

          <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden">
            <div className="px-4 pt-3 pb-2 text-[10px] font-mono-custom text-faint uppercase tracking-wider">Por portal</div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] tabular-nums">
                <thead>
                  <tr className="text-faint text-[10px] font-mono-custom uppercase tracking-wider border-y border-subtle">
                    {['Portal', 'Última leitura', 'Mensagens novas', 'Captura p50', 'Captura p95', 'Em até 60 s', 'Hora no futuro', 'Ponta a ponta p95'].map((h, i) => (
                      <th key={h} className={clsx('px-3 py-2 font-medium', i === 0 ? 'text-left' : 'text-right')}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.porPortal.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-faint">Nenhum portal leu mensagem ainda.</td></tr>
                  ) : d.porPortal.map((p) => (
                    <tr key={p.conector} className="border-b border-subtle last:border-0 hover:bg-bg3">
                      <td className="px-3 py-2 text-strong">{p.nome}</td>
                      <td className="px-3 py-2 text-right"><HaQuanto iso={p.ultimaCaptura} agora={d.geradoEm} /></td>
                      <td className="px-3 py-2 text-right text-muted">{num(p.captura.n + p.futuro)}</td>
                      <td className="px-3 py-2 text-right text-muted">{dur(p.captura.p50)}</td>
                      <td className="px-3 py-2 text-right"><Valor s={p.captura.p95} meta={d.metaS} /></td>
                      <td className="px-3 py-2 text-right text-muted">{pct(p.captura.naMeta)}</td>
                      <td className={clsx('px-3 py-2 text-right', p.futuro > 0 ? 'text-amber' : 'text-faint')}>{p.futuro > 0 ? num(p.futuro) : '—'}</td>
                      <td className="px-3 py-2 text-right"><Valor s={p.pontaAPonta.p95} meta={d.metaS} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden">
              <div className="px-4 pt-3 pb-2 text-[10px] font-mono-custom text-faint uppercase tracking-wider">Por dia (horário de Brasília)</div>
              <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
                <table className="w-full text-[12px] tabular-nums">
                  <thead>
                    <tr className="text-faint text-[10px] font-mono-custom uppercase tracking-wider border-y border-subtle">
                      {['Dia', 'Novas', 'Captura p95', 'Ponta a ponta p95'].map((h, i) => (
                        <th key={h} className={clsx('px-3 py-2 font-medium', i === 0 ? 'text-left' : 'text-right')}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.serie.length === 0 ? (
                      <tr><td colSpan={4} className="px-3 py-6 text-center text-faint">Sem dados no período.</td></tr>
                    ) : [...d.serie].reverse().map((s) => (
                      <tr key={s.dia} className="border-b border-subtle last:border-0">
                        <td className="px-3 py-1.5 text-muted font-mono-custom">{s.dia.slice(8, 10)}/{s.dia.slice(5, 7)}</td>
                        <td className="px-3 py-1.5 text-right text-muted">{num(s.novas)}</td>
                        <td className="px-3 py-1.5 text-right"><Valor s={s.capturaP95} meta={d.metaS} /></td>
                        <td className="px-3 py-1.5 text-right"><Valor s={s.pontaP95} meta={d.metaS} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-bg2 border border-subtle rounded-xl p-4">
              <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-3">Avisos de e-mail criados no período</div>
              {d.porStatus.length === 0 ? <p className="text-[12px] text-faint">Nenhum.</p> : (
                <div className="space-y-2">
                  {d.porStatus.map((s) => {
                    const max = Math.max(1, ...d.porStatus.map((x) => x.n))
                    return (
                      <div key={s.status} className="flex items-center gap-2 text-[12px]">
                        <span className="w-44 text-muted truncate" title={s.status}>{STATUS_LABEL[s.status] ?? s.status}</span>
                        <div className="flex-1 h-2 bg-bg4 rounded-full overflow-hidden">
                          <div className={clsx('h-full rounded-full', s.status === 'falha' ? 'bg-red' : s.status === 'pendente' || s.status === 'expirado' ? 'bg-amber' : 'bg-accent')}
                            style={{ width: `${(s.n / max) * 100}%` }} />
                        </div>
                        <span className="w-16 text-right font-mono-custom text-strong tabular-nums">{num(s.n)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function HaQuanto({ iso, agora }: { iso: string | null; agora: string }) {
  if (!iso) return <span className="text-faint">—</span>
  const s = Math.max(0, Math.round((new Date(agora).getTime() - new Date(iso).getTime()) / 1000))
  return <span title={new Date(iso).toLocaleString('pt-BR')} className={s > 6 * 3600 ? 'text-amber' : 'text-muted'}>há {dur(s)}</span>
}

function Valor({ s, meta }: { s: number | null; meta: number }) {
  const e = estadoDe(s, meta)
  return <span className={clsx(e === 'ok' && 'text-emerald-400', e === 'atencao' && 'text-amber', e === 'critico' && 'text-red', e === 'vazio' && 'text-faint')}>{dur(s)}</span>
}

function Etapa({ titulo, sub, f, meta, nota, destaque }: { titulo: string; sub: string; f: Faixa; meta: number; nota?: React.ReactNode; destaque?: boolean }) {
  const e = estadoDe(f.p95, meta)
  return (
    <div className={clsx('bg-bg2 border rounded-xl p-4 flex flex-col gap-2', destaque ? 'border-accent/40' : 'border-subtle')}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">{titulo}</div>
          <div className="text-[11px] text-muted mt-0.5">{sub}</div>
        </div>
        <span className={clsx('text-[10px] font-mono-custom px-1.5 py-0.5 rounded-full border whitespace-nowrap', PILL[e].cls)}>{PILL[e].txt}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-heading font-bold text-[26px] text-strong leading-none tabular-nums">{dur(f.p95)}</span>
        <span className="text-[11px] text-faint">p95</span>
      </div>
      <div className="text-[11px] text-muted tabular-nums">
        p50 {dur(f.p50)} · {pct(f.naMeta)} em até {meta} s · {num(f.n)} {f.n === 1 ? 'amostra' : 'amostras'}
      </div>
      {nota && <div className="text-[11px]">{nota}</div>}
    </div>
  )
}

function EtapaVi({ f, repasses }: { f: Faixa & { enviados: number }; repasses: number }) {
  const taxa = f.enviados > 0 ? f.n / f.enviados : null
  return (
    <div className="bg-bg2 border border-subtle rounded-xl p-4 flex flex-col gap-2">
      <div>
        <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">&quot;Vi&quot;</div>
        <div className="text-[11px] text-muted mt-0.5">aviso saiu → alguém confirmou</div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-heading font-bold text-[26px] text-strong leading-none tabular-nums">{dur(f.p95)}</span>
        <span className="text-[11px] text-faint">p95</span>
      </div>
      <div className="text-[11px] text-muted tabular-nums">
        p50 {dur(f.p50)} · {num(f.n)} de {num(f.enviados)} confirmados{taxa != null ? ` (${pct(taxa)})` : ''}
      </div>
      <div className="text-[11px] text-muted">{num(repasses)} {repasses === 1 ? 'repasse' : 'repasses'} para outra pessoa da equipe</div>
    </div>
  )
}
