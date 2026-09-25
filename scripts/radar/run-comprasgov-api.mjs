import { randomUUID } from 'node:crypto'
import { novoPool } from '../lib/pg-ssl.mjs'
import { ClienteComprasgov } from './connector-comprasgov-api.mjs'
import { gravarPagina, tomarProximo } from './comprasgov-persistencia.mjs'

// Credenciais carregadas pelo ambiente do serviço / --env-file, nunca impressas.
const env = process.env
if (env.RADAR_COMPRASGOV_ENABLED !== '1') {
  console.log('Integra Compras desativado. Nenhuma consulta realizada.')
  process.exit(0)
}
const ambiente = env.RADAR_COMPRASGOV_AMBIENTE || 'producao'
const intervalo = Number(env.RADAR_COMPRASGOV_INTERVAL_SECONDS || 300)
if (!Number.isInteger(intervalo) || intervalo < 60 || intervalo > 86400) throw new Error('Intervalo inválido (60 a 86400 segundos).')
const cliente = new ClienteComprasgov({
  key: env.SERPRO_CONSUMER_KEY, secret: env.SERPRO_CONSUMER_SECRET, ambiente,
  maxRequests: Number(env.RADAR_COMPRASGOV_MAX_REQUESTS || 20),
})
const banco = novoPool(undefined, { max: 2, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000, query_timeout: 30_000, statement_timeout: 25_000 })
banco.on('error', () => { console.error('Conexão ociosa descartada. O pool abrirá outra conexão.'); process.exitCode = 1 })
const emailsPorProcesso = new Map()
try {
  while (cliente.requests < cliente.maxRequests) {
    const lease = randomUUID()
    const job = await tomarProximo(banco, ambiente, lease)
    if (!job) break
    try {
      const resultado = await cliente.pagina({ chave: job.chave_compra, canal: job.canal, desde: job.desde, pagina: job.proxima_pagina })
      const usados = emailsPorProcesso.get(job.processo_id) || 0
      // Só reserva uma conexão depois do HTTP; BEGIN/COMMIT usam o mesmo client.
      const conexao = await banco.connect()
      let gravado
      try { gravado = await gravarPagina(conexao, job, resultado, { intervalo, emailsRestantes: Math.max(0, 5 - usados) }) }
      finally { conexao.release() }
      emailsPorProcesso.set(job.processo_id, usados + gravado.emails)
      console.log(`Integra Compras: ${job.canal}, página ${job.proxima_pagina}, ${gravado.novas} novas, ${resultado.parcial ? 'continua' : resultado.naoEncontrado ? '404 (verificar status)' : 'concluída'}.`)
    } catch (error) {
      // Não imprime corpo do provedor, URL de banco, chave, token ou mensagens.
      const detalhe = error.name === 'Error' && !('status' in error) ? 'Falha ao gravar página; checkpoint preservado.' : error.message
      const espera = Math.max(intervalo, error.retryAfter || 300)
      await banco.query(
        `UPDATE radar_comprasgov_canais SET status='falha',detalhe=$4,
         proxima_consulta=now()+($5 * interval '1 second'),lease_id=NULL,lease_ate=NULL
         WHERE processo_id=$1 AND canal=$2 AND lease_id=$3`, [job.processo_id, job.canal, lease, detalhe, espera])
      console.error(`Integra Compras: ${detalhe}`)
      process.exitCode = 1
      // Falha sistêmica: não cobrar uma tentativa por compra do mesmo contrato.
      if (!error.status || [401, 403, 429].includes(error.status) || error.status >= 500) {
        await banco.query(
          `UPDATE radar_comprasgov_canais SET proxima_consulta=GREATEST(proxima_consulta,now()+($2 * interval '1 second')) WHERE ambiente=$1`,
          [ambiente, espera])
        break
      }
    }
  }
  console.log(`Integra Compras: ${cliente.requests} requisições de dados nesta rodada (limite ${cliente.maxRequests}).`)
} catch {
  console.error('Integra Compras: falha no banco. Verifique a migração e a conectividade.'); process.exitCode = 1
} finally { await banco.end() }
