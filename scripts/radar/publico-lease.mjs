import { randomUUID } from 'node:crypto'

export async function transacaoPublica(pool, lease, executar) {
  if (!lease) return executar(pool)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await lease.conferir(client)
    const resultado = await executar(client)
    await client.query('COMMIT')
    return resultado
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally { client.release() }
}

export async function tomarLease(banco, portal, dono = randomUUID()) {
  const { rows } = await banco.query(`
    INSERT INTO radar_coletor_leases(portal,lease_id,lease_ate)
    VALUES ($1,$2,now()+interval '3 minutes')
    ON CONFLICT(portal) DO UPDATE SET lease_id=$2,lease_ate=now()+interval '3 minutes'
    WHERE (radar_coletor_leases.lease_ate IS NULL OR radar_coletor_leases.lease_ate<now())
      AND radar_coletor_leases.proxima_tentativa<=now()
    RETURNING lease_id`, [portal,dono])
  return rows.length ? dono : null
}
export async function renovarLease(banco, portal, dono) {
  const { rowCount } = await banco.query(`UPDATE radar_coletor_leases SET lease_ate=now()+interval '3 minutes'
    WHERE portal=$1 AND lease_id=$2 AND lease_ate>now()`, [portal,dono])
  if (!rowCount) throw new Error('Lease do coletor público perdido; gravação suspensa.')
}
// Chamar dentro da mesma transação que grava mensagens e saúde.
export async function conferirLease(banco, portal, dono) {
  const { rowCount } = await banco.query(`SELECT portal FROM radar_coletor_leases
    WHERE portal=$1 AND lease_id=$2 AND lease_ate>now() FOR UPDATE`, [portal,dono])
  if (!rowCount) throw new Error('Lease do coletor público perdido; gravação suspensa.')
}
export async function liberarLease(banco, portal, dono, espera = 300) {
  if (!Number.isFinite(espera) || espera < 0 || espera > 604800) throw new Error('Intervalo de espera inválido.')
  await banco.query(`UPDATE radar_coletor_leases SET lease_id=NULL,lease_ate=NULL,
    proxima_tentativa=greatest(proxima_tentativa,now()+$3*interval '1 second')
    WHERE portal=$1 AND lease_id=$2`, [portal,dono,espera])
}

export async function coordenarColeta(banco, portal) {
  const dono = await tomarLease(banco, portal)
  if (!dono) return null
  let erro = null, renovando = Promise.resolve()
  const timer = setInterval(() => {
    renovando = renovando.then(() => renovarLease(banco,portal,dono)).catch((e) => { erro = e })
  }, 30_000)
  timer.unref()
  return {
    conferir: async (client) => {
      if (erro) throw erro
      await conferirLease(client,portal,dono)
    },
    fechar: async (espera) => {
      clearInterval(timer)
      await renovando
      await liberarLease(banco,portal,dono,espera)
    },
  }
}
