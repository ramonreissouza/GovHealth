// scripts/harvest-noite.mjs — deixa o coletor de portais rodando sozinho a noite toda.
//
// Faz o que foi pedido, na ordem pedida: primeiro TODAS as abertas (é o que as
// telas mostram), e só quando essa fila zerar começa o histórico.
//
// O harvest-portais.mjs encerra de propósito quando o PNCP entra em recusa
// sustentada — isso é bom (não insiste em vão), mas significa que ele precisa
// ser rechamado. Este executor faz isso: rodada, espera, rodada, até zerar.
//
// Uso:
//   node scripts/harvest-noite.mjs
//   npm run portais:noite
//
// Interromper com Ctrl+C é seguro em qualquer momento — o cursor fica no banco.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import pg from 'pg'

const ESPERA_RECUSA = 15 * 60 * 1000   // PNCP recusando: espera longa
const ESPERA_NORMAL = 60 * 1000        // rodada produtiva que parou por outro motivo

if (!process.env.DATABASE_URL) {
  const env = fs.readFileSync('.env.local', 'utf8')
  process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// A contagem tem que ser TOLERANTE a falha de conexão. A primeira noite morreu
// exatamente aqui: depois da espera de 15min, o `connect()` devolveu ECONNABORTED
// (o PgBouncer da VM derruba conexão ociosa/em excesso) e a exceção não tratada
// encerrou o executor às 23:41 — restaram ~7h de máquina ligada sem coletar nada.
// Perder a noite por um blip de rede de 1s é o pior desperdício possível aqui.
async function pendentes(tentativas = 6) {
  let ultimoErro
  for (let t = 1; t <= tentativas; t++) {
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
    try {
      await db.connect()
      const { rows: [r] } = await db.query(`
        SELECT count(*) FILTER (WHERE portal_backfill_em IS NULL) total,
               count(*) FILTER (WHERE portal_backfill_em IS NULL AND NOT EXISTS (
                 SELECT 1 FROM resultados r WHERE r.numero_controle_pncp = c.numero_controle_pncp)) abertas,
               count(usuario_nome) com_sistema
          FROM contratacoes c`)
      return { total: Number(r.total), abertas: Number(r.abertas), comSistema: Number(r.com_sistema) }
    } catch (e) {
      ultimoErro = e
      console.log(`[noite] ${hora()} banco recusou (${e.code ?? e.message}) — tentativa ${t}/${tentativas}`)
      await sleep(Math.min(30000, 2000 * t))
    } finally {
      // `end()` sobre conexão já morta também lança; engolir de propósito.
      try { await db.end() } catch {}
    }
  }
  throw ultimoErro
}

function rodada(soAbertas) {
  return new Promise((resolve) => {
    const argv = ['./scripts/harvest-portais.mjs']
    if (soAbertas) argv.push('--abertas')
    const p = spawn(process.execPath, argv, { stdio: 'inherit', env: process.env })
    p.on('exit', (code) => resolve(code ?? 0))
  })
}

const hora = () => new Date().toISOString().slice(11, 19)

let fase = 'abertas'
let rodadas = 0

console.log(`[noite] ${hora()} iniciando — fase 1: abertas, depois histórico.`)

for (;;) {
  // Rede de segurança final: se nem as 6 tentativas resolverem (VM reiniciando,
  // internet caiu), o executor ESPERA e tenta de novo — nunca encerra. A noite
  // toda ligada só rende se o processo sobreviver ao que der errado nela.
  let antes
  try {
    antes = await pendentes()
  } catch (e) {
    console.log(`[noite] ${hora()} banco inacessível (${e?.code ?? e?.message}) — esperando 10min e tentando de novo`)
    await sleep(10 * 60 * 1000)
    continue
  }

  if (fase === 'abertas' && antes.abertas === 0) {
    console.log(`[noite] ${hora()} abertas ZERADAS (${antes.comSistema} com portal). Passando ao histórico.`)
    fase = 'historico'
  }
  if (fase === 'historico' && antes.total === 0) {
    console.log(`[noite] ${hora()} FIM — nada pendente. ${antes.comSistema} contratações com portal identificado.`)
    break
  }

  rodadas++
  const alvo = fase === 'abertas' ? antes.abertas : antes.total
  console.log(`[noite] ${hora()} rodada ${rodadas} (${fase}) — ${alvo} pendentes`)
  await rodada(fase === 'abertas')

  // Se a contagem do fim da rodada falhar, assume "não andou" e faz a espera longa
  // em vez de morrer: perder a MEDIÇÃO de uma rodada é barato, perder a noite não.
  let depois
  try { depois = await pendentes() } catch { depois = { ...antes } }
  const avanco = antes.total - depois.total
  // Rodada que não andou nada = PNCP recusando. Insistir em seguida só queima
  // mais o limite; a espera longa é o que faz a noite toda render.
  const espera = avanco > 0 ? ESPERA_NORMAL : ESPERA_RECUSA
  console.log(`[noite] ${hora()} rodada ${rodadas}: +${avanco} resolvidos `
    + `| restam ${depois.total} (${depois.abertas} abertas) | esperando ${espera / 60000}min`)
  await sleep(espera)
}
