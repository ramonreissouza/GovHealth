'use client'
// src/app/assinar/page.tsx — checkout PÚBLICO da assinatura (pagamento MANUAL).
// Sem gateway: a pessoa paga por Pix (QR/copia-e-cola) e envia o comprovante; a
// equipe/admin confirma e ativa a conta. Cartão/boleto registram a intenção e a
// equipe conclui. NENHUM dado de cartão passa pelos nossos servidores.

import { useState, useCallback, Suspense } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import { clsx } from 'clsx'
import { QRCodeSVG } from 'qrcode.react'
import { loadStripe } from '@stripe/stripe-js'
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js'
import { Check, ArrowLeft, ShieldCheck, QrCode, CreditCard, FileText, Loader2, CheckCircle2, Lock, Copy, Mail, LogOut } from 'lucide-react'
import { PLANOS, planoPorId, formatarPreco } from '@/lib/planos'
import { PIX, CONTATO_EMAIL } from '@/lib/pix'

type Metodo = 'pix' | 'cartao' | 'boleto'

// Stripe.js só é carregado se houver chave publicável (checkout embutido no site).
const STRIPE_PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
const stripePromise = STRIPE_PK ? loadStripe(STRIPE_PK) : null

// Dados de cobrança coletados no formulário (snapshot enviado ao checkout).
type DadosCobranca = { nome: string; email: string; empresa: string; instituicao: string; cpfCnpj: string; telefone: string; endereco: string }

/** Checkout do cartão EMBUTIDO na página (Stripe Embedded Checkout, recorrente). */
function CartaoCheckout({ dados, planoId }: { dados: DadosCobranca; planoId: string }) {
  const fetchClientSecret = useCallback(async () => {
    const res = await fetch('/api/assinaturas/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...dados, plano: planoId }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok || !d.clientSecret) throw new Error(d.error ?? 'Não foi possível iniciar o pagamento.')
    return d.clientSecret as string
  }, [dados, planoId])

  return (
    <div className="rounded-xl overflow-hidden border border-subtle bg-white">
      <EmbeddedCheckoutProvider stripe={stripePromise} options={{ fetchClientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  )
}

const METODOS: { key: Metodo; label: string; icon: React.ElementType; nota: string }[] = [
  { key: 'pix', label: 'PIX', icon: QrCode, nota: 'Pague na hora pelo QR Code ou copia-e-cola abaixo e envie o comprovante. Confirmamos e ativamos seu acesso em até 24h úteis, com nota fiscal.' },
  { key: 'cartao', label: 'Cartão de crédito', icon: CreditCard, nota: 'Pagamento no cartão com cobrança mensal recorrente automática, no checkout seguro do Stripe (PCI-DSS) — o cartão nunca passa pelos nossos servidores. Acesso liberado na hora após o pagamento.' },
  { key: 'boleto', label: 'Boleto (30 dias)', icon: FileText, nota: 'Comum em compras institucionais/saúde. Registramos sua solicitação e nossa equipe emite o boleto (30 dias) com nota fiscal.' },
]

export default function AssinarPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg flex items-center justify-center text-faint">Carregando…</div>}>
      <Checkout />
    </Suspense>
  )
}

function Checkout() {
  const sp = useSearchParams()
  const { status: authStatus } = useSession()
  const plano = planoPorId(sp.get('plano')) ?? PLANOS.find((p) => p.destaque) ?? PLANOS[0]

  const [f, setF] = useState({ nome: '', email: '', empresa: '', instituicao: '', cpfCnpj: '', telefone: '', endereco: '' })
  const [metodo, setMetodo] = useState<Metodo>('pix')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [ok, setOk] = useState(false)
  const [copiado, setCopiado] = useState(false)
  // Snapshot dos dados quando parte para o cartão embutido (evita re-montar o
  // checkout do Stripe a cada tecla no formulário acima).
  const [cartaoDados, setCartaoDados] = useState<DadosCobranca | null>(null)

  function selecionarMetodo(m: Metodo) { setMetodo(m); setCartaoDados(null); setErro('') }

  async function assinar() {
    setErro('')
    if (!f.nome.trim() || !f.email.trim()) { setErro('Preencha nome e e-mail.'); return }

    // CARTÃO → checkout EMBUTIDO na página (recorrente). Congela os dados e mostra
    // o formulário de cartão do Stripe abaixo. A ativação vem pelo webhook.
    if (metodo === 'cartao') {
      if (!stripePromise) { setErro('Pagamento por cartão indisponível no momento. Use o Pix abaixo.'); return }
      setCartaoDados({ ...f })
      return
    }

    // PIX/BOLETO → manual: registra a solicitação; ativação após confirmação.
    setEnviando(true)
    const res = await fetch('/api/assinaturas', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...f, plano: plano.id, metodo }),
    })
    const d = await res.json().catch(() => ({}))
    setEnviando(false)
    if (!res.ok) { setErro(d.error ?? 'Erro ao enviar.'); return }
    setOk(true)
  }

  async function copiarPix() {
    try { await navigator.clipboard.writeText(PIX.copiaECola); setCopiado(true); setTimeout(() => setCopiado(false), 2000) } catch { /* clipboard indisponível */ }
  }

  // E-mail de comprovante pré-preenchido (a pessoa anexa o print no cliente de e-mail).
  const comprovanteHref = `mailto:${CONTATO_EMAIL}?subject=${encodeURIComponent(`Comprovante Pix — ${plano.nome} — ${f.email || ''}`)}&body=${encodeURIComponent(`Olá, segue o comprovante do Pix para ativação do plano ${plano.nome}.\n\nConta (e-mail de acesso): ${f.email}\nValor: ${formatarPreco(plano.preco)}/${plano.ciclo}\n\n(anexe o comprovante do Pix a este e-mail)`)}`

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const inp = 'w-full text-[13px] bg-bg3 border border-subtle rounded-lg px-3 py-2.5 text-strong placeholder:text-faint focus:border-accent outline-none'

  return (
    <div className="min-h-screen bg-bg text-strong">
      <header className="border-b border-subtle bg-bg2/80 backdrop-blur">
        <div className="max-w-[900px] mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/inicio" className="flex items-center gap-1.5 text-[13px] text-muted hover:text-strong"><ArrowLeft size={15} /> Voltar</Link>
          <div className="flex items-center gap-4">
            <Image src="/logo-govhealth.png" alt="GovHealth" width={130} height={59} priority className="h-6 w-auto" />
            {/* Escape do loop: um trial EXPIRADO cai aqui e não tinha como sair da conta.
                "Sair" desloga e volta à landing (podendo entrar com outra conta). */}
            {authStatus === 'authenticated' && (
              <button
                onClick={() => signOut({ callbackUrl: '/inicio' })}
                className="flex items-center gap-1.5 text-[13px] text-muted hover:text-strong"
              >
                <LogOut size={15} /> Sair
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[900px] mx-auto px-6 py-8">
        {ok ? (
          <div className="max-w-[480px] mx-auto text-center py-16">
            <CheckCircle2 size={40} className="text-accent mx-auto mb-4" />
            <h1 className="font-heading font-bold text-[22px] mb-2">Solicitação recebida!</h1>
            {metodo === 'pix' ? (
              <>
                <p className="text-[14px] text-muted mb-5">Recebemos sua solicitação do plano <strong className="text-strong">{plano.nome}</strong>. Assim que confirmarmos o Pix, ativamos o acesso de <strong className="text-strong">{f.email}</strong> — em até <strong className="text-strong">24h úteis</strong>. Envie o comprovante para agilizar:</p>
                <a href={comprovanteHref} className="inline-flex items-center gap-2 text-[14px] font-semibold bg-accent text-black px-5 py-2.5 rounded-lg hover:bg-accent2">
                  <Mail size={15} /> Enviar comprovante por e-mail
                </a>
                <p className="text-[11.5px] text-faint mt-3">Ou envie para <strong className="text-muted">{CONTATO_EMAIL}</strong>.</p>
              </>
            ) : (
              <p className="text-[14px] text-muted mb-6">Recebemos sua assinatura do plano <strong className="text-strong">{plano.nome}</strong>. Nossa equipe entra em contato em <strong className="text-strong">{f.email}</strong> para concluir o pagamento e liberar o acesso.</p>
            )}
            <div className="mt-6"><Link href="/inicio" className="text-[13px] text-muted hover:text-strong">Voltar ao início</Link></div>
          </div>
        ) : (
          <div className="grid md:grid-cols-[minmax(0,1fr)_360px] gap-6">
            {/* Formulário */}
            <div className="min-w-0">
              {sp.get('trial') === 'expirado' && (
                <div className="mb-4 bg-amber/10 border border-amber/30 rounded-lg px-3.5 py-2.5 text-[12.5px] text-amber">
                  Seu teste grátis terminou. Assine para continuar com acesso total à plataforma.
                </div>
              )}
              {sp.get('upgrade') === 'pro' && (
                <div className="mb-4 bg-accent/10 border border-accent/30 rounded-lg px-3.5 py-2.5 text-[12.5px] text-accent flex items-center gap-2">
                  <Lock size={14} className="flex-shrink-0" />
                  Este recurso está disponível no plano <strong>Pro</strong>. Faça upgrade para desbloquear Concorrentes, Breakdown, Mapa, CRM, Agenda, Dossiês e Portfólio.
                </div>
              )}
              <h1 className="font-heading font-bold text-[22px] mb-1">Assinar {plano.nome}</h1>
              <p className="text-[13px] text-muted mb-5">Preencha os dados de cobrança. Sem fidelidade — cancele quando quiser.</p>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Nome completo *"><input className={inp} value={f.nome} onChange={set('nome')} /></Field>
                  <Field label="E-mail *"><input type="email" className={inp} value={f.email} onChange={set('email')} placeholder="voce@empresa.com.br" /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Empresa"><input className={inp} value={f.empresa} onChange={set('empresa')} /></Field>
                  <Field label="Instituição de trabalho"><input className={inp} value={f.instituicao} onChange={set('instituicao')} placeholder="Hospital, distribuidora…" /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="CPF ou CNPJ"><input className={inp} value={f.cpfCnpj} onChange={set('cpfCnpj')} placeholder="p/ nota fiscal" /></Field>
                  <Field label="Telefone"><input className={inp} value={f.telefone} onChange={set('telefone')} placeholder="(11) 90000-0000" /></Field>
                </div>
                <Field label="Endereço"><input className={inp} value={f.endereco} onChange={set('endereco')} placeholder="Rua, nº, cidade/UF" /></Field>
              </div>

              {/* Método de pagamento */}
              <div className="mt-6">
                <div className="text-[12px] font-mono-custom text-faint uppercase tracking-wider mb-2">Forma de pagamento</div>
                <div className="grid grid-cols-3 gap-2">
                  {METODOS.map((m) => (
                    <button key={m.key} onClick={() => selecionarMetodo(m.key)}
                      className={clsx('flex flex-col items-center gap-1.5 py-3 rounded-xl border text-[12px] transition-colors',
                        metodo === m.key ? 'border-accent bg-accent/10 text-accent font-semibold' : 'border-subtle text-muted hover:text-strong')}>
                      <m.icon size={18} /> {m.label}
                    </button>
                  ))}
                </div>
                <div className="mt-3 bg-bg2 border border-subtle rounded-lg p-3 flex items-start gap-2">
                  <Lock size={13} className="text-accent flex-shrink-0 mt-0.5" />
                  <p className="text-[11.5px] text-muted">{METODOS.find((m) => m.key === metodo)!.nota} Emitimos <strong className="text-strong">nota fiscal</strong>.</p>
                </div>

                {/* Pix: QR + copia e cola (pagamento manual, self-service) */}
                {metodo === 'pix' && (
                  <div className="mt-3 bg-bg2 border border-accent/30 rounded-xl p-4">
                    <div className="flex flex-col sm:flex-row gap-4 items-center">
                      <div className="bg-white rounded-lg p-2.5 flex-shrink-0">
                        <QRCodeSVG value={PIX.copiaECola} size={132} />
                      </div>
                      <div className="min-w-0 flex-1 w-full">
                        <div className="text-[11px] font-mono-custom text-faint uppercase tracking-wider mb-1">Pague com Pix</div>
                        <div className="text-[12.5px] text-strong">{PIX.beneficiario}</div>
                        <div className="text-[11.5px] text-muted">CNPJ {PIX.chave} · {PIX.cidade}</div>
                        <div className="mt-2.5">
                          <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wide mb-1">Pix copia e cola</div>
                          <div className="flex items-stretch gap-1.5">
                            <code className="flex-1 min-w-0 truncate bg-bg3 border border-subtle rounded-lg px-2.5 py-2 text-[11px] text-muted font-mono-custom">{PIX.copiaECola}</code>
                            <button type="button" onClick={copiarPix}
                              className={clsx('flex items-center gap-1 px-2.5 rounded-lg text-[11.5px] font-semibold transition-colors', copiado ? 'bg-emerald-500 text-white' : 'bg-accent text-black hover:bg-accent2')}>
                              {copiado ? <Check size={13} /> : <Copy size={13} />} {copiado ? 'Copiado' : 'Copiar'}
                            </button>
                          </div>
                        </div>
                        <p className="text-[11px] text-faint mt-2 leading-snug">Valor: <strong className="text-muted">{formatarPreco(plano.preco)}/{plano.ciclo}</strong>. Depois de pagar, clique abaixo para enviar o comprovante — ativamos em até 24h úteis.</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {erro && <p className="text-[12px] text-red mt-3">{erro}</p>}

              {metodo === 'cartao' && cartaoDados ? (
                <div className="mt-5">
                  <CartaoCheckout dados={cartaoDados} planoId={plano.id} />
                  <button type="button" onClick={() => setCartaoDados(null)} className="mt-3 text-[12px] text-muted hover:text-strong flex items-center gap-1">
                    <ArrowLeft size={12} /> Editar dados de cobrança
                  </button>
                </div>
              ) : (
                <>
                  <button onClick={assinar} disabled={enviando}
                    className="mt-5 w-full flex items-center justify-center gap-2 text-[15px] font-semibold bg-accent text-black py-3 rounded-lg hover:bg-accent2 disabled:opacity-60">
                    {enviando && <Loader2 size={16} className="animate-spin" />}
                    {metodo === 'pix' ? 'Já fiz o Pix — enviar comprovante' : metodo === 'cartao' ? 'Pagar com cartão' : 'Enviar solicitação'} · {formatarPreco(plano.preco)}/{plano.ciclo}
                  </button>
                  <p className="text-[10.5px] text-faint text-center mt-2 flex items-center justify-center gap-1"><ShieldCheck size={11} /> Cartão processado pelo Stripe (PCI-DSS) — não armazenamos dados de cartão. Emitimos nota fiscal.</p>
                </>
              )}
            </div>

            {/* Resumo do plano */}
            <div className="md:sticky md:top-6 h-fit bg-bg2 border border-subtle rounded-2xl p-5">
              <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1">Seu plano</div>
              <div className="flex items-baseline justify-between mb-3">
                <span className="font-heading font-bold text-[18px]">{plano.nome}</span>
                <span className="font-heading font-bold text-[22px]">{formatarPreco(plano.preco)}<span className="text-[12px] text-faint font-normal">/{plano.ciclo}</span></span>
              </div>
              <ul className="space-y-1.5 mb-4">
                {plano.features.map((ft) => (
                  <li key={ft} className="flex items-start gap-2 text-[12px] text-muted"><Check size={13} className="text-accent flex-shrink-0 mt-0.5" /> {ft}</li>
                ))}
              </ul>
              <div className="border-t border-subtle pt-3 flex gap-2">
                {PLANOS.filter((p) => p.id !== plano.id).map((p) => (
                  <Link key={p.id} href={`/assinar?plano=${p.id}`} className="text-[11px] text-accent hover:underline">Trocar para {p.nome}</Link>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-[10px] font-mono-custom text-faint uppercase tracking-wide block mb-1">{label}</label>{children}</div>
}
