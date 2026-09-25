'use client'

import { useCallback, useEffect, useState } from 'react'

interface Estado {
  configurado: boolean; schemaPronto: boolean; ambiente: string; intervalo: number
  compras: { processo_id: string; chave_compra: string; canal: string; status: string; detalhe: string | null
    titulo: string; mutado: boolean; processo_status: string; verificado_em: string | null }[]
}

export default function ComprasgovConexao({ onSaved }: { onSaved: () => void }) {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [form, setForm] = useState({ cnpj: '', chaveCompra: '', titulo: '', linkPortal: '' })
  const carregar = useCallback(async () => {
    try {
      const res = await fetch('/api/radar/comprasgov', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Não foi possível consultar a conexão.')
      setEstado(json)
    } catch (e) { setErro((e as Error).message) }
  }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => { void carregar() }, 0)
    return () => window.clearTimeout(timer)
  }, [carregar])

  async function salvar() {
    setSalvando(true); setErro(''); setAviso('')
    try {
      const res = await fetch('/api/radar/comprasgov', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Não foi possível cadastrar a compra.')
      setAviso(json.mensagem); await carregar(); onSaved()
    } catch (e) { setErro((e as Error).message) } finally { setSalvando(false) }
  }

  const rotulos: Record<string, string> = { pendente: 'Aguardando primeira leitura', paginando: 'Carregando histórico', ok: 'Leitura concluída', falha: 'Precisa de atenção', nao_encontrado: 'Leitura não confirmada' }
  return (
    <div className="space-y-3 text-[12px]">
      <p className="text-muted">O Radar lê o chat e as diligências pela integração oficial do Compras.gov.br. Cadastre a compra que deseja acompanhar. Este caminho não exige login nem CAPTCHA do gov.br.</p>
      {!estado ? <p className="text-muted">Consultando disponibilidade…</p> : !estado.configurado || !estado.schemaPronto ? (
        <p className="rounded-md bg-amber/10 border border-amber/30 p-3 text-amber">O serviço de integração oficial ainda aguarda ativação pelo administrador. {estado.schemaPronto ? 'Você já pode cadastrar as compras; elas ficarão aguardando a ativação e a primeira leitura.' : 'O cadastro será liberado após a atualização do serviço.'}</p>
      ) : <p className="text-muted">Serviço configurado. A primeira leitura confirmará a conexão de cada compra.</p>}
      {estado?.ambiente === 'homologacao' && <p className="text-amber">Ambiente de testes: estes dados não confirmam monitoramento em produção.</p>}
      {([
        ['cnpj', 'CNPJ do fornecedor', '00.000.000/0000-00'],
        ['chaveCompra', 'Chave da compra no Compras.gov.br', '17 dígitos, ex.: 07000505000032026'],
        ['titulo', 'Título da compra', 'Aquisição de medicamentos'],
        ['linkPortal', 'Link da compra no Compras.gov.br', 'https://…'],
      ] as const).map(([campo, label, placeholder]) => (
        <label key={campo} className="block text-muted">{label}
          <input value={form[campo]} onChange={(e) => setForm({ ...form, [campo]: e.target.value })} placeholder={placeholder}
            maxLength={campo === 'titulo' ? 240 : campo === 'linkPortal' ? 2000 : 30}
            className="mt-1 w-full text-[13px] bg-bg3 border border-subtle rounded-md px-3 py-2 text-strong focus:border-accent outline-none" />
        </label>
      ))}
      <p className="text-faint">A chave combina UASG (6 dígitos), modalidade SIASG (03 concorrência, 05 pregão, 06 dispensa ou 20 concurso), número da compra (5) e ano (4). Use os dados do Compras.gov.br; o número do PNCP é diferente.</p>
      {erro && <p role="alert" className="text-red">{erro}</p>}
      {aviso && <p role="status" className="text-muted">{aviso}</p>}
      <button onClick={salvar} disabled={salvando || !estado?.schemaPronto || Object.values(form).some((v) => !v.trim())}
        className="text-[12px] px-4 py-2 rounded-md bg-accent text-black font-semibold disabled:opacity-50">{salvando ? 'Cadastrando…' : 'Cadastrar compra para monitorar'}</button>
      {!!estado?.compras.length && <div className="border-t border-subtle pt-3 space-y-2">
        <div className="flex justify-between"><span className="font-semibold text-strong">Compras cadastradas</span><button onClick={carregar} className="text-accent">Atualizar situação</button></div>
        {estado.compras.map((c) => <div key={`${c.processo_id}:${c.canal}`} className="rounded border border-subtle p-2 text-muted">
          <div className="text-strong">{c.titulo} · {c.canal === 'chat' ? 'Chat' : 'Diligências'}</div>
          <div>{c.chave_compra} · {c.mutado || c.processo_status !== 'ativo' ? 'Pausado' : rotulos[c.status] || c.status}</div>
          {c.detalhe && <div>{c.detalhe}</div>}
          <div>Última leitura completa: {c.verificado_em ? new Date(c.verificado_em).toLocaleString('pt-BR') : 'ainda não realizada'}</div>
        </div>)}
      </div>}
    </div>
  )
}
