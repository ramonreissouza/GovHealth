// Prova real e somente leitura: não abre conexão com o banco, nem carrega .env.
import fs from 'node:fs/promises'
import { sync } from './connector-comprasgov-publico.mjs'
import { compraPublica } from '../../src/lib/radar/comprasgov-publico.mjs'

const compra = compraPublica(process.argv[2])
if (!compra) {
  console.error('Informe o link oficial da consulta pública da compra.')
  process.exit(1)
}
const pasta = new URL('./.calibra/', import.meta.url)
await fs.mkdir(pasta, { recursive: true })
const base = new URL(`comprasgov-publico-${Date.now()}`, pasta)
const { fileURLToPath } = await import('node:url')
const resultado = await sync({
  assistido: process.argv.includes('--assistido'),
  viaPesquisa: process.argv.includes('--pela-pesquisa'),
  processos: [{ licitacaoId: `comprasgov:publico:${compra.chave}`, urlPublica: compra.url }],
  diagnosticar: async ({ page, etapa, rede, errosPagina, erroLeitura }) => {
    await page.screenshot({ path: fileURLToPath(base) + '.png', fullPage: true })
    await fs.writeFile(fileURLToPath(base) + '.txt', `${etapa}\n${await page.locator('body').innerText()}`)
    await fs.writeFile(fileURLToPath(base) + '-rede.json', JSON.stringify({ rede, errosPagina, erroLeitura }, null, 2))
  },
})
await fs.writeFile(fileURLToPath(base) + '.json', JSON.stringify({ observadoEm: new Date().toISOString(), compra: compra.chave, ...resultado }, null, 2))
console.log(JSON.stringify({ status: resultado.status, detalhe: resultado.detalhe, mensagens: resultado.mensagens.length, evidencia: fileURLToPath(base) + '.json' }))
if (resultado.status !== 'ok') process.exitCode = 1
