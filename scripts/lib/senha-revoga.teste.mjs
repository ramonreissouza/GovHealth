// scripts/lib/senha-revoga.teste.mjs — fixtures da regra da guarda auth-senha-revoga.
// Uso: npm run auth:senha-revoga:teste
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { violacoesSenha } from './senha-revoga.mjs'

const sql = (s) => `await query(\`${s}\`, [hash, id])`
const viola = (s) => violacoesSenha(sql(s)).length

test('UPDATE que grava senha_hash e senha_alterada_em no SET: passa', () => {
  assert.equal(viola('UPDATE usuarios SET senha_hash=$1, senha_alterada_em=now(), atualizado_em=now() WHERE id=$2'), 0)
  assert.equal(viola('UPDATE usuarios SET senha_alterada_em = now(), senha_hash = $1 WHERE id = $2'), 0)
})

test('regressão da revisão: senha_alterada_em só no WHERE não revoga', () => {
  assert.equal(viola('UPDATE usuarios SET senha_hash=$1 WHERE id=$2 AND senha_alterada_em IS NOT NULL'), 1)
})

test('senha_alterada_em só no RETURNING, numa comparação ou num comentário: falha', () => {
  assert.equal(viola('UPDATE usuarios SET senha_hash=$1 WHERE id=$2 RETURNING senha_alterada_em'), 1)
  assert.equal(viola('UPDATE usuarios SET senha_hash=$1 WHERE id=$2 AND senha_alterada_em = $3'), 1)
  assert.equal(viola('UPDATE usuarios SET senha_hash=$1 -- senha_alterada_em = now()\n WHERE id=$2'), 1)
  assert.equal(viola('UPDATE usuarios SET senha_hash=$1 /* senha_alterada_em = now() */ WHERE id=$2'), 1)
})

test('maiúsculas, caixa mista e aspas: a mesma coluna para o Postgres (revisão da #68)', () => {
  assert.equal(viola('UPDATE usuarios SET SENHA_HASH = $1 WHERE id = $2'), 1)
  assert.equal(viola('UPDATE usuarios SET Senha_Hash = $1 WHERE id = $2'), 1)
  assert.equal(viola('UPDATE usuarios SET "senha_hash" = $1 WHERE id = $2'), 1)
  assert.equal(viola('update usuarios set senha_hash = $1 where id = $2'), 1, 'palavras-chave em minúsculas')
  assert.equal(viola('UPDATE usuarios SET SENHA_HASH = $1, SENHA_ALTERADA_EM = now() WHERE id = $2'), 0)
  assert.equal(viola('UPDATE usuarios SET "senha_hash" = $1, "senha_alterada_em" = now() WHERE id = $2'), 0)
  assert.equal(viola('UPDATE usuarios SET Senha_Hash = $1 WHERE id = $2 AND SENHA_ALTERADA_EM IS NOT NULL'), 1)
  assert.equal(viola('UPDATE usuarios u SET u.senha_hash = $1 WHERE u.id = $2'), 1, 'qualificado pela tabela')
})

test('upsert: o DO UPDATE SET também precisa atribuir', () => {
  const base = 'INSERT INTO usuarios (id,senha_hash) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET '
  assert.equal(viola(base + 'senha_hash=EXCLUDED.senha_hash, senha_alterada_em=now(), nome=EXCLUDED.nome'), 0)
  assert.equal(viola(base + 'senha_hash=EXCLUDED.senha_hash, nome=EXCLUDED.nome'), 1)
})

test('INSERT de conta nova e comparação num SELECT não são atribuições', () => {
  assert.equal(viola('INSERT INTO usuarios (id,email,senha_hash) VALUES ($1,$1,$2)'), 0)
  assert.equal(viola('SELECT id FROM usuarios WHERE senha_hash = $1'), 0)
  assert.equal(viola('UPDATE usuarios SET nome=$1 WHERE senha_hash = $2'), 0)
})

test('atribuição fora de crases não passa calada', () => {
  assert.equal(violacoesSenha(`query('UPDATE usuarios SET senha_hash=$1 WHERE id=$2')`).length, 1)
})

test('a linha informada é a da atribuição', () => {
  const v = violacoesSenha('// a\n// b\nawait q(`UPDATE usuarios\n  SET senha_hash=$1\n  WHERE id=$2`)')
  assert.deepEqual(v.map((x) => x.linha), [4]) // a "  SET senha_hash=$1"
})
