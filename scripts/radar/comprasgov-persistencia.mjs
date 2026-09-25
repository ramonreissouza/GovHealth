import { hashMensagem } from './connector-comprasgov-api.mjs'

export async function tomarProximo(banco, ambiente, lease) {
  const { rows: [job] } = await banco.query(
    `WITH candidato AS (
       SELECT s.processo_id,s.canal FROM radar_comprasgov_canais s
       JOIN radar_processos p ON p.id=s.processo_id
       WHERE s.ambiente=$1 AND s.proxima_consulta<=now()
         AND (s.lease_ate IS NULL OR s.lease_ate<now()) AND p.status='ativo' AND NOT p.mutado
       ORDER BY s.proxima_consulta,s.processo_id,s.canal FOR UPDATE OF s SKIP LOCKED LIMIT 1
     ), tomado AS (
       UPDATE radar_comprasgov_canais s SET lease_id=$2,lease_ate=now()+interval '3 minutes',tentado_em=now()
       FROM candidato c WHERE s.processo_id=c.processo_id AND s.canal=c.canal RETURNING s.*
     ) SELECT t.*,p.titular_id,p.user_id,p.cnpj,p.licitacao_id,p.titulo,p.link_portal
       FROM tomado t JOIN radar_processos p ON p.id=t.processo_id`, [ambiente, lease])
  return job ?? null
}

// Uma página e seu checkpoint são uma transação. O lease é no banco e funciona
// também em PgBouncer transaction pooling (não usa advisory lock de sessão).
export async function gravarPagina(banco, job, resultado, { intervalo = 300, emailsRestantes = 5 } = {}) {
  await banco.query('BEGIN')
  try {
    const { rows: [atual] } = await banco.query(
      `SELECT s.*, p.status AS processo_status, p.mutado FROM radar_comprasgov_canais s
       JOIN radar_processos p ON p.id = s.processo_id
       WHERE s.processo_id=$1 AND s.canal=$2 AND s.lease_id=$3 AND s.lease_ate > now()
       FOR UPDATE OF s, p`, [job.processo_id, job.canal, job.lease_id])
    if (!atual) throw new Error('Lease expirado; página não gravada.')
    if (atual.processo_status !== 'ativo' || atual.mutado) throw new Error('Monitoramento pausado durante a consulta.')
    const vazioConhecido = resultado.naoEncontrado && atual.inicializado && atual.desde && atual.proxima_pagina === 0
    const ambiguo = resultado.naoEncontrado && !vazioConhecido
    let novas = 0, emails = 0
    let maior = atual.maior_data ? new Date(atual.maior_data).toISOString() : null
    for (const m of resultado.mensagens) {
      if (!maior || m.horario > maior) maior = m.horario
      const { rows: [ins] } = await banco.query(
        `INSERT INTO radar_mensagens
         (msg_hash,titular_id,processo_id,conector_id,cnpj,licitacao_id,autor,texto,horario_origem,raw,categorias,prioridade,lote)
         VALUES ($1,$2,$3,'comprasgov',$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
         ON CONFLICT (msg_hash) DO NOTHING RETURNING id`,
        [hashMensagem(job.titular_id, job.processo_id, job.canal, m.id), job.titular_id, job.processo_id,
          job.cnpj, job.licitacao_id, m.autor, m.texto, m.horario,
          JSON.stringify({ ...m.raw, fonte: 'integra-compras', canal: job.canal }), m.categorias, m.prioridade, m.lote])
      if (!ins) continue
      novas++
      await banco.query(
        `INSERT INTO radar_notificacoes
         (id,titular_id,evento,mensagem_id,processo_id,destinatario,canal,assunto,link,status)
         VALUES ($1,$2,'nova_mensagem',$3,$4,$5,'in_app',$6,$7,'entregue') ON CONFLICT DO NOTHING`,
        [`nm:${ins.id}:app`, job.titular_id, ins.id, job.processo_id, job.user_id, job.titulo, job.link_portal])
      // Bootstrap inteiro fica no Radar. Não dispara e-mails retroativos.
      const idade = Date.now() - Date.parse(m.horario)
      if (atual.inicializado && idade >= -60_000 && idade <= 48 * 3600_000 && emails < emailsRestantes) {
        await banco.query(
          `INSERT INTO radar_notificacoes
           (id,titular_id,evento,mensagem_id,processo_id,destinatario,canal,assunto,link)
           VALUES ($1,$2,'nova_mensagem',$3,$4,$5,'email',$6,$7) ON CONFLICT DO NOTHING`,
          [`nm:${ins.id}:email`, job.titular_id, ins.id, job.processo_id, job.user_id, job.titulo, job.link_portal])
        emails++
      }
    }
    const terminou = !resultado.parcial && !ambiguo
    // Sobreposição cobre a fronteira de datas iguais. Não avança até "agora" em
    // resposta vazia: o próximo ciclo começa a partir da última mensagem observada.
    const desde = terminou && maior ? new Date(Date.parse(maior) - 120_000).toISOString() : atual.desde
    const status = ambiguo ? 'nao_encontrado' : resultado.parcial ? 'paginando' : 'ok'
    const detalhe = ambiguo ? 'Compra não encontrada ou sem mensagens para este filtro. Leitura ainda não confirmada.' :
      resultado.parcial ? 'Histórico parcial; há páginas pendentes.' : vazioConhecido ? 'Consulta incremental sem novas mensagens.' : 'Leitura concluída pela integração oficial.'
    await banco.query(
      `UPDATE radar_comprasgov_canais SET desde=$4, maior_data=$5,
       proxima_pagina=$6, inicializado=inicializado OR $7, status=$8, detalhe=$9,
       verificado_em=CASE WHEN $7 THEN now() ELSE verificado_em END,
       proxima_consulta=now()+($10 * interval '1 second'), lease_id=NULL, lease_ate=NULL
       WHERE processo_id=$1 AND canal=$2 AND lease_id=$3`,
      [job.processo_id, job.canal, job.lease_id, desde, maior,
        resultado.parcial ? atual.proxima_pagina + 1 : terminou ? 0 : atual.proxima_pagina,
        terminou, status, detalhe, resultado.parcial ? 0 : ambiguo ? Math.max(intervalo, 3600) : intervalo])
    await banco.query('COMMIT')
    return { novas, emails }
  } catch (error) { await banco.query('ROLLBACK'); throw error }
}
