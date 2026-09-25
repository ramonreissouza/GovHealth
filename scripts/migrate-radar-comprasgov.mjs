import fs from 'node:fs/promises'
import { novoClient } from './lib/pg-ssl.mjs'

const banco = novoClient()
try {
  await banco.connect()
  await banco.query(await fs.readFile(new URL('../db/schema-radar-comprasgov.sql', import.meta.url), 'utf8'))
  console.log('Migração Integra Compras concluída.')
} catch (error) {
  console.error('Falha na migração Integra Compras:', error.message)
  process.exitCode = 1
} finally { await banco.end() }
