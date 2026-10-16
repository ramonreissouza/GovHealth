// scripts/auth-senha-revoga.teste.mjs — guarda: TODA troca de senha revoga as sessões.
//
// A revogação (src/lib/users.ts sessaoRevogada) e o "lembrar este navegador" do 2FA
// (src/lib/dispositivo-confiavel.ts) valem enquanto usuarios.senha_alterada_em não mudar.
// Um UPDATE que grava senha_hash sem gravar senha_alterada_em troca a senha e deixa vivos
// os JWTs já emitidos e os navegadores lembrados — e a rotação feita depois de suspeita de
// vazamento (scripts/set-*-password.mjs) é justamente a que mais precisa derrubá-los.
// Foi o que a revisão da #68 encontrou em 4 scripts.
//
// Regra: cada literal SQL (entre crases) que ATRIBUI senha_hash (`senha_hash=`, inclusive
// no ON CONFLICT ... DO UPDATE) também cita senha_alterada_em. INSERT de conta nova não
// atribui (a coluna vai na lista) e passa. Roda no prebuild: quebra o build, não a revisão.
//
// Uso: node scripts/auth-senha-revoga.teste.mjs

import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

const RAIZES = ['src', 'scripts']
const EXT = /\.(ts|tsx|js|mjs|mts|cjs)$/
const ESTE = path.normalize('scripts/auth-senha-revoga.teste.mjs')

function arquivos(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : arquivos(p)
    return EXT.test(e.name) && path.normalize(p) !== ESTE ? [p] : []
  })
}

const violacoes = []
let atribuicoes = 0
for (const arq of RAIZES.flatMap(arquivos)) {
  const txt = fs.readFileSync(arq, 'utf8')
  for (const m of txt.matchAll(/senha_hash\s*=/g)) {
    atribuicoes++
    const ini = txt.lastIndexOf('`', m.index)
    const fim = txt.indexOf('`', m.index)
    const linha = txt.slice(0, m.index).split('\n').length
    if (ini < 0 || fim < 0) { violacoes.push(`${arq}:${linha} — senha_hash= fora de um literal SQL entre crases; revise à mão`); continue }
    if (!txt.slice(ini, fim).includes('senha_alterada_em')) {
      violacoes.push(`${arq}:${linha} — grava senha_hash sem senha_alterada_em=now() (as sessões abertas sobreviveriam)`)
    }
  }
}

// Sanidade: se o regex parar de achar as atribuições conhecidas, a guarda passaria calada.
assert.ok(atribuicoes >= 7, `esperava ao menos 7 atribuições de senha_hash no repositório, achei ${atribuicoes} — o regex quebrou?`)
assert.deepEqual(violacoes, [], `\n${violacoes.join('\n')}\n`)
console.log(`✓ auth-senha-revoga: ${atribuicoes} atribuições de senha_hash, todas revogam as sessões`)
