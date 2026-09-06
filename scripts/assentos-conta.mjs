// scripts/assentos-conta.mjs — quantos usuários uma conta tem direito.
//
// A coluna `assentos` é o número NEGOCIADO daquela conta e vale nos dois sentidos:
// NULO = "use o que o plano inclui" (ASSENTOS_DO_PLANO em src/lib/users.ts),
// preenchido = "foi negociado, respeite" — acima OU abaixo do plano-padrão.
//
// Existe como script e não como SQL solto por dois motivos que já custaram caro aqui:
//   1) baixar assento sem olhar quem está dentro tranca gente de fora em silêncio —
//      este script RECUSA descer abaixo do número de pessoas ativas na conta;
//   2) `UPDATE ... WHERE assentos = 1` numa migração que roda de novo apagaria a conta
//      negociada para 1. A conversão do default antigo mora aqui, com trava, e não no
//      schema-equipe.sql, que é reaplicado.
//
// Uso:
//   npm run assentos                                       (mostra todas as contas)
//   npm run assentos -- --conta=x@y.com --assentos=1        (número negociado)
//   npm run assentos -- --conta=x@y.com --plano             (volta ao que o plano inclui)
//   npm run assentos -- --converter-default                 (uma vez: default antigo → NULO)
//   ...com --ensaio em qualquer um deles para só relatar.

import fs from 'node:fs'
import pg from 'pg'

if (!process.env.DATABASE_URL) {
  try {
    const m = fs.readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m)
    if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* sem .env.local */ }
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const arg = (n, d) => { const m = process.argv.find((a) => a.startsWith(`--${n}=`)); return m ? m.slice(n.length + 3) : d }
const CONTA = arg('conta', null)
const ASSENTOS = arg('assentos', null)
const AO_PLANO = process.argv.includes('--plano')
const CONVERTER = process.argv.includes('--converter-default')
const ENSAIO = process.argv.includes('--ensaio')

// Espelha ASSENTOS_DO_PLANO de src/lib/users.ts. Duplicar um mapa de 1 linha é melhor
// que puxar TypeScript para dentro de um script .mjs; se divergir, o relatório abaixo
// mostra o número efetivo e a divergência aparece na hora.
const ASSENTOS_DO_PLANO = { empresa: 3 }
const efetivos = (assentos, plano) => assentos ?? ASSENTOS_DO_PLANO[plano ?? ''] ?? 1

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
client.on('error', (e) => console.warn(`[assentos] conexão: ${e.message}`))
await client.connect()

async function panorama() {
  const { rows } = await client.query(
    `SELECT u.email, u.plano, u.assentos,
            (SELECT count(*)::int FROM usuarios m
              WHERE (m.id = u.id OR m.titular_id = u.id) AND m.deleted_at IS NULL) pessoas
       FROM usuarios u WHERE u.titular_id IS NULL AND u.deleted_at IS NULL
      ORDER BY u.plano, u.email`)
  console.table(rows.map((r) => ({
    conta: r.email,
    plano: r.plano,
    negociado: r.assentos ?? '— (usa o plano)',
    efetivo: efetivos(r.assentos, r.plano),
    pessoas: r.pessoas,
    vagas: Math.max(efetivos(r.assentos, r.plano) - r.pessoas, 0),
  })))
  return rows
}

console.log('\n### antes')
const antes = await panorama()

if (CONVERTER) {
  // TRAVA: só converte enquanto NENHUM titular tem NULO. Depois da primeira vez, quem
  // está em 1 está em 1 porque alguém decidiu — e apagar isso seria o bug.
  const jaConvertido = antes.some((r) => r.assentos === null)
  if (jaConvertido) {
    console.log('\n! conversão já foi feita (há conta com assentos NULO) — não repito,'
      + ' senão apagaria número negociado para 1.')
  } else {
    const alvo = antes.filter((r) => r.assentos === 1)
    console.log(`\n→ ${alvo.length} conta(s) no default antigo (1) voltam a "usa o plano":`
      + ` ${alvo.map((r) => r.email).join(', ') || '(nenhuma)'}`)
    if (!ENSAIO && alvo.length) {
      const r = await client.query(
        `UPDATE usuarios SET assentos = NULL WHERE titular_id IS NULL AND assentos = 1`)
      console.log(`✓ ${r.rowCount} convertida(s)`)
    }
  }
}

if (CONTA) {
  if (ASSENTOS === null && !AO_PLANO) {
    console.error('\nERRO: com --conta, informe --assentos=N ou --plano')
    await client.end(); process.exit(1)
  }
  const linha = antes.find((r) => r.email === CONTA.toLowerCase().trim())
  if (!linha) {
    console.error(`\nERRO: não achei titular com e-mail "${CONTA}" (conta de membro não detém assentos)`)
    await client.end(); process.exit(1)
  }
  const novo = AO_PLANO ? null : Number(ASSENTOS)
  if (novo !== null && (!Number.isInteger(novo) || novo < 1)) {
    console.error(`\nERRO: --assentos precisa ser inteiro >= 1 (recebi "${ASSENTOS}")`)
    await client.end(); process.exit(1)
  }
  const efetivoNovo = efetivos(novo, linha.plano)
  // A trava que importa: ninguém fica trancado de fora por uma mudança de contrato.
  if (efetivoNovo < linha.pessoas) {
    console.error(`\nERRO: ${CONTA} tem ${linha.pessoas} pessoa(s) ativa(s) e o novo teto seria`
      + ` ${efetivoNovo}. Remova membro(s) primeiro (a tela Equipe faz isso) — não vou`
      + ` deixar conta ativa sem assento.`)
    await client.end(); process.exit(1)
  }
  console.log(`\n→ ${CONTA}: ${linha.assentos ?? '—'} → ${novo ?? '— (usa o plano)'}`
    + ` · efetivo ${efetivos(linha.assentos, linha.plano)} → ${efetivoNovo}`
    + ` · ${linha.pessoas} pessoa(s) dentro`)
  if (!ENSAIO) {
    const r = await client.query(`UPDATE usuarios SET assentos = $2 WHERE id = $1 AND titular_id IS NULL`,
      [linha.email, novo])
    console.log(`✓ ${r.rowCount} conta atualizada`)
  }
}

if (!ENSAIO && (CONTA || CONVERTER)) {
  console.log('\n### depois')
  await panorama()
} else if (ENSAIO) {
  console.log('\n(ensaio — nada foi gravado)')
}
await client.end()
