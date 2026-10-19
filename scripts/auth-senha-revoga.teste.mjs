// scripts/auth-senha-revoga.teste.mjs — guarda: TODA troca de senha revoga as sessões.
//
// A revogação (src/lib/revogacao.ts) e o "lembrar este navegador" do 2FA
// (src/lib/dispositivo-confiavel.ts) valem enquanto usuarios.senha_alterada_em não mudar.
// Um UPDATE que grava senha_hash sem gravar senha_alterada_em troca a senha e deixa vivos
// os JWTs já emitidos e os navegadores lembrados — e a rotação feita depois de suspeita de
// vazamento (scripts/set-*-password.mjs) é justamente a que mais precisa derrubá-los.
// Foi o que a revisão da #68 encontrou em 4 scripts.
//
// A regra (scripts/lib/senha-revoga.mjs, com fixtures em senha-revoga.teste.mjs): a mesma
// cláusula SET que atribui senha_hash atribui senha_alterada_em. Roda no prebuild: quebra o
// build, não a revisão.
//
// Uso: node scripts/auth-senha-revoga.teste.mjs

import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { violacoesSenha } from './lib/senha-revoga.mjs'

const RAIZES = ['src', 'scripts']
const EXT = /\.(ts|tsx|js|mjs|mts|cjs)$/
// Os arquivos da própria guarda citam o padrão em exemplos e fixtures.
const DA_GUARDA = new Set(['scripts/auth-senha-revoga.teste.mjs', 'scripts/lib/senha-revoga.mjs', 'scripts/lib/senha-revoga.teste.mjs'].map((p) => path.normalize(p)))

function arquivos(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : arquivos(p)
    return EXT.test(e.name) && !DA_GUARDA.has(path.normalize(p)) ? [p] : []
  })
}

// Sanidade da regra: se ela deixar de pegar o caso da revisão, a guarda passaria calada.
assert.equal(violacoesSenha('q(`UPDATE usuarios SET senha_hash=$1 WHERE id=$2 AND senha_alterada_em IS NOT NULL`)').length, 1,
  'a regra parou de exigir a ATRIBUIÇÃO de senha_alterada_em')

const violacoes = []
let atribuicoes = 0
for (const arq of RAIZES.flatMap(arquivos)) {
  const txt = fs.readFileSync(arq, 'utf8')
  atribuicoes += [...txt.matchAll(/senha_hash\s*=(?!=)/g)].length
  for (const v of violacoesSenha(txt)) violacoes.push(`${arq}:${v.linha} — ${v.motivo}`)
}

// Sanidade da busca: se o regex parar de achar as atribuições conhecidas, idem.
assert.ok(atribuicoes >= 7, `esperava ao menos 7 atribuições de senha_hash no repositório, achei ${atribuicoes} — o regex quebrou?`)
assert.deepEqual(violacoes, [], `\n${violacoes.join('\n')}\n`)
console.log(`✓ auth-senha-revoga: ${atribuicoes} atribuições de senha_hash, todas revogam as sessões`)
