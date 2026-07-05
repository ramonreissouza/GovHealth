'use client'
// src/app/assinar/page.tsx — checkout PÚBLICO da assinatura.
// PCI-safe: NÃO coletamos número de cartão aqui. O cartão vai no checkout hospedado
// do gateway (Asaas/Iugu/Pagar.me/Stripe), tokenizado — a integração é o próximo
// passo. Por ora, coletamos os dados de cobrança + método e registramos a intenção.

import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { clsx } from 'clsx'
import { Check, ArrowLeft, ShieldCheck, QrCode, CreditCard, FileText, Loader2, CheckCircle2, Lock } from 'lucide-react'
import { PLANOS, planoPorId, formatarPreco } from '@/lib/planos'

type Metodo = 'pix' | 'cartao' | 'boleto'

const METODOS: { key: Metodo; label: string; icon: React.ElementType; nota: string }[] = [
  { key: 'cartao', label: 'Cartão de crédito', icon: CreditCard, nota: 'Cobrança mensal recorrente automática. O cartão é inserido no checkout seguro do Stripe (PCI-DSS) — nunca passa pelos nossos servidores. Você é redirecionado para concluir o pagamento.' },
  { key: 'pix', label: 'PIX', icon: QrCode, nota: 'Ideal para compras institucionais. Registramos sua solicitação e nossa equipe envia o QR Code / cobrança e conclui a ativação com nota fiscal.' },
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
  const plano = planoPorId(sp.get('plano')) ?? PLANOS.find((p) => p.destaque) ?? PLANOS[0]

  const [f, setF] = useState({ nome: '', email: '', empresa: '', instituicao: '', cpfCnpj: '', telefone: '', endereco: '' })
  const [metodo, setMetodo] = useState<Metodo>('cartao')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [ok, setOk] = useState(false)

  async function assinar() {
    setErro('')
    if (!f.nome.trim() || !f.email.trim()) { setErro('Preencha nome e e-mail.'); return }
    setEnviando(true)

    // Cartão → Stripe Checkout hospedado (recorrente). Redireciona para o Stripe.
    if (metodo === 'cartao') {
      const res = await fetch('/api/assinaturas/checkout', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...f, plano: plano.id }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.url) { window.location.href = d.url; return }
      // Stripe ainda não configurado (503): não quebra — registra como lead abaixo.
      if (res.status !== 503) { setEnviando(false); setErro(d.error ?? 'Não foi possível iniciar o pagamento.'); return }
    }

    // PIX/Boleto → registra a intenção (lead institucional); equipe conclui.
    const res = await fetch('/api/assinaturas', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...f, plano: plano.id, metodo }),
    })
    const d = await res.json().catch(() => ({}))
    setEnviando(false)
    if (!res.ok) { setErro(d.error ?? 'Erro ao enviar.'); return }
    setOk(true)
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const inp = 'w-full text-[13px] bg-bg3 border border-subtle rounded-lg px-3 py-2.5 text-strong placeholder:text-faint focus:border-accent outline-none'

  return (
    <div className="min-h-screen bg-bg text-strong">
      <header className="border-b border-subtle bg-bg2/80 backdrop-blur">
        <div className="max-w-[900px] mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/inicio" className="flex items-center gap-1.5 text-[13px] text-muted hover:text-strong"><ArrowLeft size={15} /> Voltar</Link>
          <span className="font-heading font-bold text-[14px]">GovHealth<span className="text-accent">.ai</span></span>
        </div>
      </header>

      <main className="max-w-[900px] mx-auto px-6 py-8">
        {ok ? (
          <div className="max-w-[480px] mx-auto text-center py-16">
            <CheckCircle2 size={40} className="text-accent mx-auto mb-4" />
            <h1 className="font-heading font-bold text-[22px] mb-2">Solicitação recebida!</h1>
            <p className="text-[14px] text-muted mb-6">Recebemos sua assinatura do plano <strong className="text-strong">{plano.nome}</strong>. Nossa equipe entra em contato em <strong className="text-strong">{f.email}</strong> para concluir o pagamento e liberar o acesso.</p>
            <Link href="/inicio" className="inline-flex items-center gap-2 text-[14px] font-semibold bg-accent text-black px-5 py-2.5 rounded-lg hover:bg-accent2">Voltar ao início</Link>
          </div>
        ) : (
          <div className="grid md:grid-cols-[1fr_360px] gap-6">
            {/* Formulário */}
            <div>
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
                    <button key={m.key} onClick={() => setMetodo(m.key)}
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
              </div>

              {erro && <p className="text-[12px] text-red mt-3">{erro}</p>}
              <button onClick={assinar} disabled={enviando}
                className="mt-5 w-full flex items-center justify-center gap-2 text-[15px] font-semibold bg-accent text-black py-3 rounded-lg hover:bg-accent2 disabled:opacity-60">
                {enviando && <Loader2 size={16} className="animate-spin" />}
                {metodo === 'cartao' ? 'Ir para pagamento seguro' : 'Enviar solicitação'} · {formatarPreco(plano.preco)}/{plano.ciclo}
              </button>
              <p className="text-[10.5px] text-faint text-center mt-2 flex items-center justify-center gap-1"><ShieldCheck size={11} /> Dados de cartão processados por gateway certificado (PCI-DSS) — não armazenamos o cartão.</p>
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
