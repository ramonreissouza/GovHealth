'use client'
// src/app/radar/components/AvisoCelular.tsx — "Aviso no celular": ativa o push (Web Push)
// NESTE aparelho. Diferente da opção "Push notification" de cima, que só avisa com a tela
// do Radar aberta, este chega com o GovHealth fechado (public/sw.js + src/lib/push.ts).
//
// A inscrição é por pessoa e por aparelho: cada um ativa no próprio celular. No iPhone,
// a Apple só entrega push a site instalado na Tela de Início (iOS 16.4+), então lá a
// tela ensina a instalar antes de mostrar o botão.

import { useCallback, useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { Smartphone, Loader2, Check, AlertTriangle, Send } from 'lucide-react'

type Estado = 'carregando' | 'sem-suporte' | 'iphone-instalar' | 'servidor-desligado' | 'bloqueado' | 'inativo' | 'ativo'

interface Aparelho { endpoint: string; aparelho: string | null; criado_em: string; ultimo_ok_em: string | null }

/** Chave VAPID (base64url) → bytes, como o PushManager pede. */
function chaveBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const bruto = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(bruto.length))
  for (let i = 0; i < bruto.length; i++) out[i] = bruto.charCodeAt(i)
  return out
}

/** "Chrome no Android": para a pessoa reconhecer o aparelho na lista. */
function nomeAparelho(): string {
  const ua = navigator.userAgent
  const so = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'aparelho'
  const nav = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador'
  return `${nav} no ${so}`
}

const data = (v: string) => new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function AvisoCelular() {
  const [estado, setEstado] = useState<Estado>('carregando')
  const [chave, setChave] = useState<string | null>(null)
  const [aparelhos, setAparelhos] = useState<Aparelho[]>([])
  const [endpointAqui, setEndpointAqui] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)

  const atualizar = useCallback(async () => {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
    const instalado = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true
    let info: { configurado?: boolean; chave?: string | null; aparelhos?: Aparelho[] } = {}
    try { info = await (await fetch('/api/push')).json() } catch { /* mostra o que der */ }
    setChave(info.chave ?? null)
    setAparelhos(info.aparelhos ?? [])
    const suporta = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    if (!suporta) { setEstado(ios && !instalado ? 'iphone-instalar' : 'sem-suporte'); return }
    if (!info.configurado || !info.chave) { setEstado('servidor-desligado'); return }
    if (Notification.permission === 'denied') { setEstado('bloqueado'); return }
    const reg = await navigator.serviceWorker.getRegistration('/')
    const sub = await reg?.pushManager.getSubscription()
    setEndpointAqui(sub?.endpoint ?? null)
    setEstado(sub && (info.aparelhos ?? []).some((a) => a.endpoint === sub.endpoint) ? 'ativo' : 'inativo')
  }, [])

  useEffect(() => { void atualizar() }, [atualizar])

  async function ativar() {
    if (!chave) return
    setOcupado(true); setMsg(null)
    try {
      // A permissão primeiro, direto do clique: o Safari só pergunta dentro do gesto.
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setEstado(perm === 'denied' ? 'bloqueado' : 'inativo'); return }
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
        ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveBytes(chave) })
      const r = await fetch('/api/push', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), aparelho: nomeAparelho() }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'falha')
      setMsg({ ok: true, texto: 'Ativado. Mande um aviso de teste para conferir.' })
      await atualizar()
    } catch (e) {
      setMsg({ ok: false, texto: `Não deu para ativar: ${e instanceof Error ? e.message : 'erro do navegador'}.` })
    } finally { setOcupado(false) }
  }

  async function remover(endpoint: string) {
    setOcupado(true); setMsg(null)
    try {
      if (endpoint === endpointAqui) {
        const reg = await navigator.serviceWorker.getRegistration('/')
        await (await reg?.pushManager.getSubscription())?.unsubscribe()
      }
      await fetch('/api/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }) })
      await atualizar()
    } finally { setOcupado(false) }
  }

  async function testar() {
    setOcupado(true); setMsg(null)
    try {
      const r = await fetch('/api/push/teste', { method: 'POST' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'falha')
      setMsg(j.enviados
        ? { ok: true, texto: `Aviso de teste enviado para ${j.enviados} ${j.enviados === 1 ? 'aparelho' : 'aparelhos'}.` }
        : { ok: false, texto: 'Nenhum aparelho recebeu. Desative e ative de novo neste aparelho.' })
      await atualizar()
    } catch (e) {
      setMsg({ ok: false, texto: `Não deu para enviar: ${e instanceof Error ? e.message : 'erro'}.` })
    } finally { setOcupado(false) }
  }

  return (
    <section className="bg-bg2 border border-subtle rounded-xl p-5">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-strong">
        <Smartphone size={14} /> Aviso no celular
        {estado === 'ativo' && <span className="text-[10.5px] font-semibold text-emerald-400 bg-emerald-500/15 rounded-full px-2 py-0.5">ativo neste aparelho</span>}
      </div>
      <p className="text-[11.5px] text-muted mt-1.5 max-w-[640px]">
        A convocação chega como notificação, mesmo com o GovHealth fechado, com o botão &quot;Vi, estou cuidando&quot;.
        Ative em cada aparelho que você usa.
      </p>

      <div className="mt-4 space-y-3">
        {estado === 'carregando' && <Loader2 size={14} className="animate-spin text-faint" />}

        {estado === 'servidor-desligado' && (
          <Aviso>O aviso no celular ainda não foi ligado no servidor. Fale com o suporte do GovHealth.</Aviso>
        )}
        {estado === 'sem-suporte' && (
          <Aviso>Este navegador não recebe aviso por push. No Android, use o Chrome. No iPhone, é preciso o iOS 16.4 ou mais novo, com o GovHealth na Tela de Início.</Aviso>
        )}
        {estado === 'bloqueado' && (
          <Aviso>As notificações deste site estão bloqueadas no navegador. Libere nas permissões do site e recarregue a página.</Aviso>
        )}
        {estado === 'iphone-instalar' && (
          <div className="text-[12px] text-strong bg-bg3 border border-subtle rounded-lg p-3 max-w-[560px]">
            <div className="font-semibold mb-1.5">No iPhone, o aviso só chega com o GovHealth na Tela de Início:</div>
            <ol className="list-decimal ml-4 space-y-1 text-muted">
              <li>No Safari, toque em <strong className="text-strong">Compartilhar</strong> (o quadrado com a seta para cima).</li>
              <li>Escolha <strong className="text-strong">Adicionar à Tela de Início</strong>.</li>
              <li>Abra o GovHealth pelo ícone novo, entre nesta tela e toque em <strong className="text-strong">Ativar neste aparelho</strong>.</li>
            </ol>
            <div className="text-[11px] text-faint mt-1.5">Precisa do iOS 16.4 ou mais novo.</div>
          </div>
        )}

        {(estado === 'inativo' || estado === 'ativo') && (
          <div className="flex items-center gap-2 flex-wrap">
            {estado === 'inativo' ? (
              <button onClick={() => void ativar()} disabled={ocupado}
                className="inline-flex items-center gap-1.5 text-[12px] px-3 py-2 rounded-md bg-accent text-black font-semibold disabled:opacity-50">
                {ocupado ? <Loader2 size={13} className="animate-spin" /> : <Smartphone size={13} />} Ativar neste aparelho
              </button>
            ) : (
              <>
                <button onClick={() => void testar()} disabled={ocupado}
                  className="inline-flex items-center gap-1.5 text-[12px] px-3 py-2 rounded-md bg-accent text-black font-semibold disabled:opacity-50">
                  {ocupado ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Enviar aviso de teste
                </button>
                <button onClick={() => endpointAqui && void remover(endpointAqui)} disabled={ocupado}
                  className="text-[12px] px-3 py-2 rounded-md border border-subtle2 text-muted hover:text-strong disabled:opacity-50">
                  Desativar neste aparelho
                </button>
              </>
            )}
          </div>
        )}

        {msg && (
          <p className={clsx('flex items-center gap-1.5 text-[11.5px]', msg.ok ? 'text-emerald-400' : 'text-red')}>
            {msg.ok ? <Check size={12} /> : <AlertTriangle size={12} />} {msg.texto}
          </p>
        )}

        {aparelhos.length > 0 && (
          <div className="pt-3 border-t border-subtle">
            <div className="text-[11px] text-faint mb-1.5">Seus aparelhos com aviso</div>
            <ul className="space-y-1">
              {aparelhos.map((a) => (
                <li key={a.endpoint} className="flex items-center gap-2 text-[12px] text-strong flex-wrap">
                  <span>{a.aparelho || 'Aparelho'}{a.endpoint === endpointAqui ? ' (este)' : ''}</span>
                  <span className="text-[11px] text-faint">
                    desde {data(a.criado_em)}{a.ultimo_ok_em ? ` · último aviso ${data(a.ultimo_ok_em)}` : ''}
                  </span>
                  {a.endpoint !== endpointAqui && (
                    <button onClick={() => void remover(a.endpoint)} disabled={ocupado}
                      className="text-[11px] text-faint hover:text-red underline disabled:opacity-50">remover</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-start gap-1.5 bg-amber/10 border border-amber/30 rounded-md px-2.5 py-1.5 max-w-[640px]">
      <AlertTriangle size={12} className="text-amber flex-shrink-0 mt-0.5" />
      <span className="text-[11.5px] text-amber">{children}</span>
    </div>
  )
}
