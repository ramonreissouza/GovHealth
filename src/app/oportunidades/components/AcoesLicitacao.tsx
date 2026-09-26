'use client'
// src/app/oportunidades/components/AcoesLicitacao.tsx — barra "Ações:" do card de
// licitação: Baixar Edital · Ativar monitoramento de chat · Acessar local da disputa.
//
// "Ativar monitoramento de chat" cria um processo MANUAL no Radar (origem='manual'
// em radar_processos) — é o opt-in edital a edital que a ferramenta de benchmark
// tem, convivendo com a nossa seleção automática por perfil.
//
// NÃO existe "Ver detalhes do pregão". Existiu, e foi removido: das 10 informações
// do modal, 8 (objeto, situação, publicação, encerramento, órgão, município/UF,
// modalidade, valor) já estão no card expandido logo acima do botão. Um clique que
// abre o que a pessoa já está lendo custa atenção e não devolve nada.

import { useState } from 'react'
import { clsx } from 'clsx'
import { Download, Radar, ExternalLink, Check, Loader2 } from 'lucide-react'
import type { Licitacao } from '@/lib/types'
import { resolverPortal, nomePortal, ePortalDeDisputa } from '@/lib/portais'
import { CONECTORES } from '@/lib/radar/conectores'
import { portalSoVisualizacao } from '@/lib/radar/chat-externo.mjs'
import { lerLinkDoRadar } from '@/lib/radar/adicionar-pregao'

/** Página do edital no PNCP (onde ficam os arquivos p/ download). */
function paginaEditalPncp(lic: Licitacao): string | null {
  const cnpj = lic.orgaoEntidade?.cnpj
  const m = lic.numeroControlePNCP?.match(/-(\d+)\/(\d{4})$/)
  const seq = m?.[1], ano = m?.[2]
  if (!cnpj || !seq || !ano) return null
  return `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${Number(seq)}`
}

type Estado = 'idle' | 'enviando' | 'ok' | 'erro'

export default function AcoesLicitacao({ lic, uf }: { lic: Licitacao; uf?: string }) {
  const [monitor, setMonitor] = useState<Estado>('idle')
  const [erro, setErro] = useState<string | null>(null)

  // `usuarioNome` entra aqui porque é o único sinal de portal dos ~190 mil
  // registros sem link próprio (a API já trocou o link deles pela URL canônica do
  // PNCP). `resolverPortal` prefere a URL e só cai no nome do sistema depois, que
  // é a ordem de confiança certa.
  const portal = resolverPortal({
    linkExterno: lic.linkSistemaOrigem,
    usuarioNome: lic.usuarioNome,
    objeto: lic.objetoCompra,
  })
  // Só quem é de disputa pode virar "Disputa no X". O catálogo tem portal de
  // transparência municipal (o PNCP manda essa URL em linkSistemaOrigem igual),
  // e ali o link leva à leitura do edital, não à sessão.
  const eDisputa = ePortalDeDisputa(portal)
  const pagEdital = paginaEditalPncp(lic)

  // O RÓTULO DIZ O QUE ACONTECE DEPOIS DO CLIQUE (requisito 4.2). Dizia "Monitorando o
  // chat" para qualquer licitação, e só alguns portais são lidos. O Compras.gov.br recusa
  // navegador automatizado: o Radar só MOSTRA o chat oficial dentro do pregão (ver
  // lib/radar/chat-externo.mjs). Esta tela não carrega a saúde dos conectores; sem ela,
  // `portalSoVisualizacao` responde "só visualização", porque não saber que lê não é ler.
  //
  // O conector sai do LINK, pela mesma regra que a rota aplica (lerLinkDoRadar, a do
  // coletor). Era `link.includes(dominio)`: "https://licitanet.com.br/" (sem /sessao/N)
  // habilitava o botão, a rota gravava sem link e a tela dizia "Monitorando o chat" num
  // pregão que o coletor descarta. O PCP é a exceção: sem link, o coletor acha a página
  // pelo objeto e pela UF.
  const link = lic.linkSistemaOrigem ?? ''
  const lidoLink = link ? lerLinkDoRadar(link) : null
  const conectorId = !eDisputa ? null
    : lidoLink?.tipo === 'portal' ? lidoLink.conectorId
    : portal === 'pcp' ? 'pcp' : null
  const conector = conectorId ? CONECTORES.find((c) => c.disponivel && c.id === conectorId) : undefined
  // O botão só existe quando o cadastro TEM como dar certo: a pessoa não vê "Tente de
  // novo" num clique que nunca ia passar.
  const cadastravel = !!conector
  const leitura = !conector || portalSoVisualizacao(conector.id, []) ? 'nenhuma' : conector.leitura
  const rotulo = leitura === 'chat'
    ? { antes: 'Ativar monitoramento de chat', depois: 'Monitorando o chat' }
    : leitura === 'dossie'
      ? { antes: 'Ativar monitoramento', depois: 'Monitorando o andamento' }
      : { antes: 'Acompanhar no Radar', depois: 'No Radar · chat oficial, sem alerta' }
  const dica = leitura === 'nenhuma'
    ? 'O pregão entra na sua lista do Radar e o chat oficial abre lá dentro. O Radar não lê as mensagens nem avisa sobre elas: o Compras.gov.br exige captcha e recusa navegador automatizado.'
    : undefined

  async function ativarMonitoramento() {
    setMonitor('enviando'); setErro(null)
    try {
      const r = await fetch('/api/radar/processos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // O id do CONECTOR, não o do portal (ver `conector` acima). O botão só
          // aparece com conector achado, então aqui ele sempre existe.
          conectorId: conector?.id ?? portal,
          licitacaoId: lic.numeroControlePNCP,
          titulo: (lic.objetoCompra ?? '').slice(0, 240),
          uf: uf ?? lic.orgaoEntidade?.uf ?? '',
          linkPortal: lic.linkSistemaOrigem || undefined,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || '')
      setMonitor('ok')
    } catch (e) {
      // A rota explica o motivo ("cole o link público…", integração oficial ligada…);
      // "Tente de novo" só quando não há motivo, como numa falha de rede.
      setMonitor('erro'); setErro((e instanceof Error && e.message) || 'Não foi possível ativar. Tente de novo.')
    }
  }

  const btn = 'inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border transition-colors'

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
        {pagEdital && (
          <a href={pagEdital} target="_blank" rel="noopener noreferrer"
            className={clsx(btn, 'border-subtle2 bg-bg3 text-muted hover:text-strong hover:border-subtle')}>
            <Download size={12} /> Baixar Edital
          </a>
        )}

        {!cadastravel ? (
          // Sem leitor, ou Compras.gov.br sem o link de acompanhamento: diz por que não há
          // botão, em vez de oferecer um clique que a rota recusa.
          <span className="text-[10.5px] text-faint"
            title={portal === 'comprasgov'
              ? 'Sem o link público de acompanhamento desta compra, o chat oficial não abre no Radar.'
              : lidoLink?.tipo === 'erro' ? lidoLink.mensagem : 'Nenhum coletor do Radar lê este portal.'}>
            {portal === 'comprasgov' ? 'Radar: sem link público desta compra' : 'Radar: sem leitura deste link'}
          </span>
        ) : (
        <button onClick={ativarMonitoramento} disabled={monitor === 'enviando' || monitor === 'ok'} title={dica}
          className={clsx(btn, monitor === 'ok'
            // Verde só quando há leitura de verdade: "No Radar, sem alerta" em verde
            // voltaria a parecer proteção.
            ? leitura === 'nenhuma' ? 'border-subtle2 bg-bg3 text-muted' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            : 'border-accent/40 bg-accent/10 text-accent hover:bg-accent/20')}>
          {monitor === 'enviando' ? <Loader2 size={12} className="animate-spin" />
            : monitor === 'ok' ? <Check size={12} /> : <Radar size={12} />}
          {monitor === 'ok' ? rotulo.depois : rotulo.antes}
        </button>
        )}

        {/* O NOME DO PORTAL vem no rótulo do botão, não num modal. Saber que a
            disputa é no Licitanet e não no Compras.gov muda o que o fornecedor
            precisa ter (cadastro, certificado, taxa) — é informação de decisão, e
            informação de decisão não fica escondida atrás de um clique. */}
        {lic.linkSistemaOrigem && (
          <a href={lic.linkSistemaOrigem} target="_blank" rel="noopener noreferrer"
            className={clsx(btn, 'border-subtle2 bg-bg3 text-muted hover:text-accent hover:border-subtle')}>
            <ExternalLink size={12} />
            {eDisputa ? `Disputa no ${nomePortal(portal)}`
              // Reconhecido, mas é transparência (ou não verificado): o link leva ao
              // edital. Nomear ainda ajuda — "Ver no GeoSIAP" diz o que vem depois
              // do clique. O que não pode é prometer sessão de disputa.
              : portal !== 'desconhecido' ? `Ver no ${nomePortal(portal)}`
              : 'Acessar local da disputa'}
          </a>
        )}

        {/* Portal reconhecido pelo marcador "[PORTAL] - ..." do objeto, mas sem URL
            para levar a pessoa. Dizer onde é continua valendo mais que silêncio —
            e só vale dizer "disputa" se for portal de disputa. */}
        {!lic.linkSistemaOrigem && eDisputa && (
          <span className="text-[10.5px] text-faint">Disputa no {nomePortal(portal)}</span>
        )}

        {erro && <span className="text-[10.5px] text-red">{erro}</span>}
      </div>
    </>
  )
}
