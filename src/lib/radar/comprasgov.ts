import { query, queryOne } from '@/lib/db'

/**
 * QUAL coletor lê o Compras.gov.br agora — e, portanto, por qual porta uma compra tem
 * de entrar. São dois modos com cadastros incompatíveis:
 *
 *   publico → `/api/radar/processos`, licitacao_id `comprasgov:publico:<chave>`, lido
 *             pelo coletor público (run.mjs). Padrão, sem tarifa.
 *   api     → `/api/radar/comprasgov`, licitacao_id `comprasgov:<ambiente>:<chave>` e
 *             linhas em radar_comprasgov_canais, lido por run-comprasgov-api.mjs.
 *
 * As duas portas ficavam abertas ao mesmo tempo, e a compra que entrasse pela errada
 * ficava invisível ao coletor ativo — cadastrada, e nunca lida (revisão da #39). Agora
 * esta função é a única que decide, com o MESMO critério que `saudeComprasgov` e os
 * coletores já usavam (`RADAR_COMPRASGOV_ENABLED`), e cada rota recusa o outro modo.
 */
export function modoComprasgov(env: Record<string, string | undefined> = process.env): 'publico' | 'api' {
  return env.RADAR_COMPRASGOV_ENABLED === '1' ? 'api' : 'publico'
}

export function configuracaoComprasgov() {
  const ambiente = process.env.RADAR_COMPRASGOV_AMBIENTE || 'producao'
  const intervalo = Number(process.env.RADAR_COMPRASGOV_INTERVAL_SECONDS || 300)
  const limite = Number(process.env.RADAR_COMPRASGOV_MAX_REQUESTS || 20)
  const configurado = process.env.RADAR_COMPRASGOV_ENABLED === '1' &&
    !!process.env.SERPRO_CONSUMER_KEY && !!process.env.SERPRO_CONSUMER_SECRET &&
    ['producao', 'homologacao'].includes(ambiente) &&
    Number.isInteger(intervalo) && intervalo >= 60 && intervalo <= 86400 &&
    Number.isInteger(limite) && limite >= 1 && limite <= 1000
  return { configurado, ambiente, intervalo }
}

export async function schemaComprasgovPronto() {
  return !!(await queryOne<{ pronto: boolean }>(
    `SELECT to_regclass('radar_comprasgov_canais') IS NOT NULL AS pronto`,
  ))?.pronto
}

export async function comprasgovDoTenant(titularId: string) {
  const config = configuracaoComprasgov()
  const schemaPronto = await schemaComprasgovPronto()
  const compras = schemaPronto ? await query<{
    processo_id: string; chave_compra: string; canal: string; status: string; detalhe: string | null
    verificado_em: string | null; tentado_em: string | null; titulo: string; mutado: boolean; processo_status: string
  }>(
    `SELECT s.processo_id,s.chave_compra,s.canal,s.status,s.detalhe,s.verificado_em,s.tentado_em,
            p.titulo,p.mutado,p.status AS processo_status
     FROM radar_comprasgov_canais s JOIN radar_processos p ON p.id=s.processo_id
     WHERE p.titular_id=$1 AND s.ambiente=$2 ORDER BY p.criado_em DESC,s.canal`, [titularId, config.ambiente],
  ) : []
  return { ...config, schemaPronto, compras }
}

export async function saudeComprasgov(titularId: string) {
  // Padrão gratuito: a saúde vem da coleta pública, não de cookies antigos.
  if (modoComprasgov() === 'publico') {
    const publico = await queryOne<{
      credencial_id: null; conector_id: string; cnpj: null; status: string
      verificado_em: string | null; tentado_em: string | null; detalhe: string | null
    }>(`SELECT credencial_id,conector_id,NULL::text AS cnpj,status,verificado_em,tentado_em,detalhe
        FROM radar_saude WHERE titular_id=$1 AND conector_id='comprasgov' AND credencial_id IS NULL`, [titularId])
    if (publico?.status === 'ok') {
      const cobertura = await queryOne<{ total: number; pendentes: number }>(
        `SELECT count(*)::int AS total,
         count(*) FILTER (WHERE criado_em > $2::timestamptz OR $2::timestamptz IS NULL)::int AS pendentes
         FROM radar_processos WHERE titular_id=$1 AND conector_id='comprasgov'
           AND status='ativo' AND NOT mutado AND origem='manual' AND licitacao_id LIKE 'comprasgov:publico:%'`,
        [titularId, publico.verificado_em],
      )
      const intervalo = Number(process.env.RADAR_PUBLICO_INTERVAL_SECONDS || 300)
      const limite = Number.isFinite(intervalo) ? Math.max(900, intervalo * 3) : 900
      const atrasado = !publico.verificado_em || Date.now() - new Date(publico.verificado_em).getTime() > limite * 1000
      if (atrasado || !cobertura?.total || cobertura.pendentes) return {
        ...publico, status: 'falha',
        detalhe: 'A leitura pública precisa ser atualizada: há compra ainda não verificada ou o coletor está atrasado. Execute o coletor; se solicitado, resolva o CAPTCHA no modo assistido.',
      }
      return publico
    }
    // Sem leitura OK, o Compras.gov.br é portal que o Radar só MOSTRA (25/09/2026): a
    // consulta pública pede captcha e recusa navegador automatizado, então nenhuma
    // passada vai verificá-lo. Dizer "aguardando primeira verificação", com o ícone
    // girando, prometia uma leitura que não vem; e o `captcha_2fa` que o coletor grava
    // numa compra cadastrada pedia ao cliente uma ação que ele não tem como fazer.
    // Ver lib/radar/chat-externo.mjs.
    return {
      credencial_id: null, conector_id: 'comprasgov', cnpj: null, status: 'nao_monitorado',
      verificado_em: null, tentado_em: publico?.tentado_em ?? null,
      detalhe: 'O chat oficial abre dentro do pregão quando há o link público de acompanhamento. Sem leitura automática nem alerta: o portal exige captcha e recusa navegador automatizado.',
    }
  }
  const { configurado, intervalo, compras, ambiente } = await comprasgovDoTenant(titularId)
  const ativos = compras.filter((c) => c.processo_status === 'ativo' && !c.mutado)
  const recentes = ativos.filter((c) => c.status === 'ok' && c.verificado_em &&
    Date.now() - new Date(c.verificado_em).getTime() < Math.max(intervalo * 3, 300) * 1000)
  const datas = ativos.map((c) => c.verificado_em).filter((v): v is string => !!v)
    .map((v) => new Date(v).toISOString()).sort()
  const tentativas = ativos.map((c) => c.tentado_em).filter((v): v is string => !!v)
    .map((v) => new Date(v).toISOString()).sort()
  const completo = configurado && ativos.length > 0 && recentes.length === ativos.length
  const status = completo ? 'ok' : !configurado || !ativos.length || ativos.every((c) => c.status === 'pendente') ? 'nunca_verificado' : 'falha'
  const detalhe = !configurado ? 'Integração oficial aguardando ativação do serviço.' : !ativos.length ? 'Cadastre uma compra para iniciar a leitura pela integração oficial.' :
    completo ? `Integração oficial: chat e diligências verificados para ${ativos.length / 2} compra(s).` :
      `Integração oficial: ${recentes.length}/${ativos.length} canais com leitura recente. Há leitura pendente, falha ou coletor atrasado. Consulte as compras em Conectar portal.`
  return {
    credencial_id: null, conector_id: 'comprasgov', cnpj: null, status,
    verificado_em: datas.length === ativos.length ? datas[0] : null,
    tentado_em: tentativas.at(-1) ?? null,
    detalhe: `${ambiente === 'homologacao' ? 'Ambiente de testes. ' : ''}${detalhe}`,
  }
}
