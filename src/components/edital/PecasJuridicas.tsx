'use client'
// src/components/edital/PecasJuridicas.tsx — pedido de esclarecimento, recurso e
// contrarrazões sobre o edital carregado. A impugnação continua saindo na análise.
//
// O prazo aparece ANTES de gerar, calculado aqui mesmo com a mesma função do
// servidor: é a primeira coisa que a pessoa precisa saber ("ainda dá tempo?"), e
// não depende da IA.

import { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Gavel, Loader2, Copy, Check, Download, X, AlertTriangle, CalendarClock } from 'lucide-react'
import { getEmpresa } from '@/lib/empresa'
import {
  NOME_PECA, ROTULO_DATA_BASE, prazoDaPeca,
  type AlvoRecurso, type PecaGerada, type PrazoPeca, type TipoPeca,
} from '@/lib/pecas-juridicas'

const LS_PECAS = 'govhealth:edital:pecas'

const QUANDO_USAR: Record<TipoPeca, string> = {
  esclarecimento: 'Antes da sessão, para tirar uma dúvida do edital sem impugnar.',
  recurso: 'Depois da decisão do pregoeiro, para pedir que ela seja revista.',
  contrarrazoes: 'Quando outro licitante recorre de uma decisão que favoreceu você.',
}

const ALVO_LABEL: Record<AlvoRecurso, string> = {
  'minha-inabilitacao': 'Fui inabilitado',
  'minha-desclassificacao': 'Minha proposta foi desclassificada',
  'habilitacao-concorrente': 'Outra empresa foi aceita ou habilitada sem cumprir o edital',
  'outro': 'Outra decisão',
}

const ROTULO_DOCUMENTO: Partial<Record<TipoPeca, { titulo: string; placeholder: string }>> = {
  recurso: {
    titulo: 'Decisão do pregoeiro',
    placeholder: 'Cole o trecho da ata ou a mensagem do pregoeiro com a decisão e o motivo…',
  },
  contrarrazoes: {
    titulo: 'Recurso do concorrente',
    placeholder: 'Cole o texto do recurso apresentado pela outra empresa…',
  },
}

const ROTULO_ARGUMENTOS: Record<TipoPeca, { titulo: string; placeholder: string }> = {
  esclarecimento: {
    titulo: 'Suas dúvidas (opcional)',
    placeholder: 'Ex.: o item 5.3 pede registro na ANVISA também para os acessórios? Se deixar em branco, a IA aponta os pontos ambíguos do edital.',
  },
  recurso: {
    titulo: 'O que só você sabe (opcional)',
    placeholder: 'Ex.: o atestado exigido está na página 34 dos documentos enviados; a certidão foi atualizada no dia seguinte…',
  },
  contrarrazoes: {
    titulo: 'O que só você sabe (opcional)',
    placeholder: 'Ex.: o equipamento ofertado tem o registro ANVISA nº…, enviado junto com a proposta…',
  },
}

/** Hoje no fuso de Brasília, em AAAA-MM-DD — o mesmo "hoje" que o servidor usa. */
function hojeIsoBR(): string {
  const p = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date()).split('/')
  return `${p[2]}-${p[1]}-${p[0]}`
}

/**
 * Impressão digital do edital: o rascunho das peças só volta para o MESMO edital.
 * SHA-256 do texto INTEIRO (revisão da #60): olhar só o começo e o fim confundia duas
 * versões do edital com o mesmo tamanho e mudança no meio, e trazia de volta a minuta
 * da versão anterior.
 */
async function digitalDoEdital(texto: string): Promise<string> {
  const bytes = new TextEncoder().encode(texto)
  if (globalThis.crypto?.subtle) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    return `sha256:${Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('')}`
  }
  // Sem crypto.subtle (página fora de HTTPS): hash de 64 bits do texto inteiro.
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (const b of bytes) {
    h1 = Math.imul(h1 ^ b, 2654435761)
    h2 = Math.imul(h2 ^ b, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `h64:${bytes.length}:${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}`
}

/** O que muda de sentido de uma peça para outra fica separado por peça: a data do
 *  recurso é a da ata, a do esclarecimento é a da abertura; o texto colado no recurso
 *  é a decisão, nas contrarrazões é o recurso do concorrente. */
interface Campos {
  dataBase: string
  documento: string
  argumentos: string
}

interface Formulario {
  tipo: TipoPeca
  alvo: AlvoRecurso
  intencao: boolean
  campos: Record<TipoPeca, Campos>
}

const CAMPOS_VAZIOS: Campos = { dataBase: '', documento: '', argumentos: '' }

const FORM_VAZIO: Formulario = {
  tipo: 'esclarecimento', alvo: 'minha-inabilitacao', intencao: false,
  campos: { esclarecimento: CAMPOS_VAZIOS, recurso: CAMPOS_VAZIOS, contrarrazoes: CAMPOS_VAZIOS },
}

interface Rascunho {
  digital: string
  form: Formulario
  pecas: Partial<Record<TipoPeca, PecaGerada>>
}

function lerRascunho(digital: string): Rascunho | null {
  try {
    const raw = localStorage.getItem(LS_PECAS)
    if (!raw) return null
    const o = JSON.parse(raw) as Rascunho
    if (o?.digital !== digital) return null
    // Rascunho num formato antigo: as peças valem, o formulário recomeça.
    return o.form?.campos ? o : { ...o, form: FORM_VAZIO }
  } catch { return null }
}

/**
 * Grava a peça no rascunho NA HORA em que ela chega, e não pelo efeito com atraso:
 * a redação leva 1 a 2 minutos, e quem saiu da tela nesse meio perdia a peça. Se o
 * rascunho guardado já é de outro edital, a pessoa seguiu adiante e ele fica.
 */
function gravarPeca(digital: string, formNoPedido: Formulario, peca: PecaGerada) {
  try {
    const raw = localStorage.getItem(LS_PECAS)
    const atual = raw ? JSON.parse(raw) as Rascunho : null
    if (atual && atual.digital !== digital) return
    localStorage.setItem(LS_PECAS, JSON.stringify({
      digital,
      form: atual?.form ?? formNoPedido,
      pecas: { ...atual?.pecas, [peca.tipo]: peca },
    } satisfies Rascunho))
  } catch { /* cota estourada: a peça segue na tela */ }
}

function baixarDoc(peca: PecaGerada) {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as Record<string, string>)[c])
  const corpo = peca.minuta.split('\n').map((l) => (l.trim() ? `<p>${esc(l)}</p>` : '<p>&nbsp;</p>')).join('')
  // HTML com o tipo do Word: abre no Word e no LibreOffice para editar, sem biblioteca nova.
  const html = `<html><head><meta charset="utf-8"><title>${esc(NOME_PECA[peca.tipo])}</title>
<style>body{font-family:'Times New Roman',serif;font-size:12pt;line-height:1.5}p{margin:0 0 6pt;text-align:justify}</style>
</head><body>${corpo}</body></html>`
  const blob = new Blob(['﻿', html], { type: 'application/msword' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${peca.tipo}.doc`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

interface Props {
  texto: string
  onFechar?: () => void
  /** Sobe a cada clique em "Outras peças": traz o painel à vista mesmo já aberto. */
  pedidoFoco?: number
}

/**
 * Um painel por edital: trocar o edital troca a `key`, e o painel nasce de novo com o
 * rascunho DAQUELE edital.
 */
export default function PecasJuridicas(props: Props) {
  // O digest é assíncrono. Enquanto o novo não sai, o painel do anterior continua na
  // tela (sem piscar a cada tecla no edital); a troca de `key` vem quando ele chegar.
  const [digital, setDigital] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    void digitalDoEdital(props.texto).then((d) => { if (vivo) setDigital(d) })
    return () => { vivo = false }
  }, [props.texto])
  if (!digital) return null
  return <Painel key={digital} digital={digital} {...props} />
}

function Painel({ texto, onFechar, pedidoFoco = 0, digital }: Props & { digital: string }) {
  // O painel só monta no navegador (abre por clique), então dá para ler o rascunho
  // já no estado inicial.
  const [form, setForm] = useState<Formulario>(() => lerRascunho(digital)?.form ?? FORM_VAZIO)
  const [pecas, setPecas] = useState<Partial<Record<TipoPeca, PecaGerada>>>(() => lerRascunho(digital)?.pecas ?? {})
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const caixaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(LS_PECAS, JSON.stringify({ digital, form, pecas } satisfies Rascunho)) } catch { /* cota */ }
    }, 400)
    return () => clearTimeout(t)
  }, [digital, form, pecas])

  useEffect(() => {
    if (pedidoFoco) caixaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [pedidoFoco])

  const c = form.campos[form.tipo]
  const prazo: PrazoPeca | { erro: string } | null = useMemo(
    () => (c.dataBase ? prazoDaPeca(form.tipo, c.dataBase, hojeIsoBR()) : null),
    [form.tipo, c.dataBase],
  )

  const set = <K extends keyof Formulario>(k: K, v: Formulario[K]) => setForm((f) => ({ ...f, [k]: v }))
  const setCampo = (k: keyof Campos, v: string) => setForm((f) => ({
    ...f, campos: { ...f.campos, [f.tipo]: { ...f.campos[f.tipo], [k]: v } },
  }))
  const doc = ROTULO_DOCUMENTO[form.tipo]
  const arg = ROTULO_ARGUMENTOS[form.tipo]
  const precisaDocumento = !!doc
  const podeGerar = !loading && (!precisaDocumento || c.documento.trim().length >= 80) && !(prazo && 'erro' in prazo)
  const peca = pecas[form.tipo]

  async function gerar() {
    if (!podeGerar) return
    setLoading(true)
    setErro(null)
    // O pedido NÃO é cancelado se a tela fechar: a IA já está escrevendo do lado do
    // servidor de qualquer jeito, e a peça que chegar vai para o rascunho.
    const tipo = form.tipo
    const formNoPedido = form
    try {
      const empresa = getEmpresa()
      const res = await fetch('/api/edital/peca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo,
          edital: texto,
          dataBase: c.dataBase || undefined,
          documento: precisaDocumento ? c.documento : undefined,
          argumentos: c.argumentos || undefined,
          alvo: tipo === 'recurso' ? form.alvo : undefined,
          intencaoManifestada: tipo === 'recurso' ? form.intencao : undefined,
          empresa: { razaoSocial: empresa.nomeEmpresa, cnpj: empresa.cnpj },
        }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.peca) throw new Error(j?.error ?? 'Não foi possível gerar a peça.')
      const nova = j.peca as PecaGerada
      gravarPeca(digital, formNoPedido, nova)
      setPecas((p) => ({ ...p, [tipo]: nova }))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível gerar a peça.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div ref={caixaRef} className="bg-bg2 border border-amber-500/30 rounded-xl p-4 mt-4 scroll-mt-6">
      <div className="flex items-center gap-2 mb-1">
        <Gavel size={14} className="text-amber-400" />
        <h3 className="font-heading font-bold text-[13px] text-strong">Outras peças</h3>
        {onFechar && (
          <button onClick={onFechar} title="Fechar (o rascunho fica salvo)" className="ml-auto text-faint hover:text-strong transition-colors">
            <X size={13} />
          </button>
        )}
      </div>
      <p className="text-[11px] text-faint mb-3">
        A impugnação sai junto com a análise. Aqui ficam as outras peças deste edital. O prazo é calculado
        pela Lei 14.133/2021, e a IA só cita os artigos de uma lista conferida.
      </p>

      {/* Escolha da peça */}
      <div role="radiogroup" aria-label="Peça" className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
        {(Object.keys(NOME_PECA) as TipoPeca[]).map((t) => (
          <button
            key={t}
            role="radio"
            aria-checked={form.tipo === t}
            onClick={() => { set('tipo', t); setErro(null) }}
            className={clsx(
              'text-left rounded-lg border px-3 py-2.5 transition-colors',
              form.tipo === t ? 'border-amber-500/60 bg-amber-500/10' : 'border-subtle bg-bg3/40 hover:border-subtle2',
            )}
          >
            <div className="text-[12px] font-semibold text-strong flex items-center gap-1.5">
              {NOME_PECA[t]}
              {pecas[t] && <Check size={12} className="text-accent" aria-label="já gerada" />}
            </div>
            <div className="text-[11px] text-faint leading-snug mt-0.5">{QUANDO_USAR[t]}</div>
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {form.tipo === 'recurso' && (
          <label className="block">
            <span className="text-[11px] font-mono-custom text-faint uppercase tracking-wider">Contra o quê</span>
            <select
              value={form.alvo}
              onChange={(e) => set('alvo', e.target.value as AlvoRecurso)}
              className="mt-1 w-full bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[12px] text-strong focus:outline-none focus:border-accent"
            >
              {(Object.keys(ALVO_LABEL) as AlvoRecurso[]).map((a) => <option key={a} value={a}>{ALVO_LABEL[a]}</option>)}
            </select>
          </label>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-[11px] font-mono-custom text-faint uppercase tracking-wider">{ROTULO_DATA_BASE[form.tipo]}</span>
            <input
              type="date"
              value={c.dataBase}
              onChange={(e) => setCampo('dataBase', e.target.value)}
              className="mt-1 block bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[12px] text-strong focus:outline-none focus:border-accent"
            />
          </label>
          {form.tipo === 'recurso' && (
            <label className="flex items-center gap-2 text-[12px] text-muted pb-2 cursor-pointer">
              <input type="checkbox" checked={form.intencao} onChange={(e) => set('intencao', e.target.checked)} className="accent-amber-500" />
              Manifestei a intenção de recorrer na sessão
            </label>
          )}
        </div>

        <PrazoResumo prazo={prazo} tipo={form.tipo} />

        {doc && (
          <label className="block">
            <span className="text-[11px] font-mono-custom text-faint uppercase tracking-wider">{doc.titulo}</span>
            <textarea
              value={c.documento}
              onChange={(e) => setCampo('documento', e.target.value)}
              placeholder={doc.placeholder}
              rows={5}
              className="mt-1 w-full bg-bg3 border border-subtle rounded-lg px-3 py-2.5 text-[12px] text-strong placeholder:text-faint focus:outline-none focus:border-accent resize-y leading-relaxed"
            />
          </label>
        )}

        <label className="block">
          <span className="text-[11px] font-mono-custom text-faint uppercase tracking-wider">{arg.titulo}</span>
          <textarea
            value={c.argumentos}
            onChange={(e) => setCampo('argumentos', e.target.value)}
            placeholder={arg.placeholder}
            rows={3}
            className="mt-1 w-full bg-bg3 border border-subtle rounded-lg px-3 py-2.5 text-[12px] text-strong placeholder:text-faint focus:outline-none focus:border-accent resize-y leading-relaxed"
          />
        </label>

        <div className="flex items-center justify-end gap-3">
          {precisaDocumento && c.documento.trim().length < 80 ? (
            <span className="text-[11px] text-faint">Cole {form.tipo === 'recurso' ? 'a decisão' : 'o recurso'} para gerar.</span>
          ) : loading ? (
            <span className="text-[11px] text-faint">A redação leva de 1 a 2 minutos.</span>
          ) : null}
          <button
            onClick={gerar}
            disabled={!podeGerar}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-black text-[13px] font-semibold hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Gavel size={14} />}
            {loading ? 'Redigindo…' : peca ? `Gerar de novo` : `Gerar ${NOME_PECA[form.tipo].toLowerCase()}`}
          </button>
        </div>
      </div>

      {erro && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5 mt-3 text-[12px] text-red-400">
          <AlertTriangle size={14} className="flex-shrink-0" /> {erro}
        </div>
      )}

      {peca && <Resultado peca={peca} />}
    </div>
  )
}

function PrazoResumo({ prazo, tipo }: { prazo: PrazoPeca | { erro: string } | null; tipo: TipoPeca }) {
  if (!prazo) {
    return (
      <p className="text-[11px] text-faint flex items-center gap-1.5">
        <CalendarClock size={12} /> Informe a data para ver até quando dá para protocolar.
        {tipo !== 'esclarecimento' && ' Sem ela, a peça sai com a tempestividade para você completar.'}
      </p>
    )
  }
  if ('erro' in prazo) {
    return <p className="text-[11px] text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {prazo.erro}</p>
  }
  const estilo = prazo.situacao === 'vencido'
    ? 'bg-red-500/15 text-red-400 border-red-500/30'
    : prazo.situacao === 'vence-hoje' || prazo.diasUteisRestantes <= 1
      ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
      : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
  const quando = prazo.situacao === 'vencido' ? 'prazo vencido'
    : prazo.situacao === 'vence-hoje' ? 'vence hoje'
    : `${prazo.diasUteisRestantes} dia${prazo.diasUteisRestantes === 1 ? '' : 's'} út${prazo.diasUteisRestantes === 1 ? 'il' : 'eis'}`
  return (
    <div className="border border-subtle rounded-lg p-3 bg-bg3/40">
      <div className="flex items-center gap-2 flex-wrap">
        <CalendarClock size={13} className="text-faint" />
        <span className="text-[12px] text-strong">
          Protocolar até <strong>{prazo.limiteBR}</strong> ({prazo.diaSemana})
        </span>
        <span className={clsx('text-[10px] font-mono-custom px-2 py-0.5 rounded-full border uppercase', estilo)}>{quando}</span>
      </div>
      <p className="text-[11px] text-faint leading-snug mt-1.5">{prazo.fundamento}</p>
      {prazo.situacao === 'vencido' && (
        <p className="text-[11px] text-red-400 leading-snug mt-1">Fora do prazo, a peça pode nem ser analisada. Confira a data no portal antes de protocolar.</p>
      )}
      <ul className="mt-1.5 space-y-0.5">
        {prazo.ressalvas.map((r) => <li key={r} className="text-[11px] text-faint leading-snug">• {r}</li>)}
      </ul>
    </div>
  )
}

function Resultado({ peca }: { peca: PecaGerada }) {
  const [copiado, setCopiado] = useState(false)
  return (
    <div className="mt-4 space-y-3">
      {(peca.alertas ?? []).length > 0 && (
        <div role="alert" className="border border-red-500/40 bg-red-500/10 rounded-lg p-3">
          <div className="text-[11px] font-mono-custom text-red-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <AlertTriangle size={12} /> Não protocole sem conferir
          </div>
          <ul className="space-y-1">
            {peca.alertas.map((a, i) => <li key={i} className="text-[12px] text-strong leading-snug">• {a}</li>)}
          </ul>
        </div>
      )}
      {peca.pendencias.length > 0 && (
        <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-3">
          <div className="text-[11px] font-mono-custom text-amber-400 uppercase tracking-wider mb-1.5">Antes de protocolar, complete</div>
          <ul className="space-y-1">
            {peca.pendencias.map((p, i) => <li key={i} className="text-[12px] text-muted leading-snug">• {p}</li>)}
          </ul>
        </div>
      )}
      {peca.teses.length > 0 && (
        <div>
          <div className="text-[11px] font-mono-custom text-faint uppercase tracking-wider mb-1.5">Argumentos usados</div>
          <div className="space-y-1.5">
            {peca.teses.map((t, i) => (
              <div key={i} className="border border-subtle rounded-lg px-3 py-2 bg-bg3/40">
                <div className="text-[12px] text-strong leading-snug">{t.tese}</div>
                {t.fundamento && <div className="text-[11px] text-faint leading-snug mt-0.5">{t.fundamento}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="flex items-center justify-between mb-1.5 gap-2">
          <span className="text-[11px] font-mono-custom text-faint uppercase tracking-wider">{NOME_PECA[peca.tipo]} — minuta</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigator.clipboard.writeText(peca.minuta).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2000) }).catch(() => {})}
              className="flex items-center gap-1 text-[11px] text-muted hover:text-accent transition-colors"
            >
              {copiado ? <><Check size={12} /> Copiado</> : <><Copy size={12} /> Copiar</>}
            </button>
            <button onClick={() => baixarDoc(peca)} className="flex items-center gap-1 text-[11px] text-muted hover:text-accent transition-colors">
              <Download size={12} /> Baixar para o Word
            </button>
          </div>
        </div>
        <pre className="text-[11.5px] text-muted leading-relaxed whitespace-pre-wrap bg-bg3/40 border border-subtle rounded-lg p-3 max-h-[480px] overflow-y-auto" style={{ fontFamily: 'inherit' }}>{peca.minuta}</pre>
      </div>
      <p className="text-[10px] text-faint font-mono-custom">Peça gerada por IA. Revise os fatos e o prazo no portal antes de protocolar.</p>
    </div>
  )
}
