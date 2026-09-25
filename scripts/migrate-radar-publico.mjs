import fs from 'node:fs/promises'
import { novoClient } from './lib/pg-ssl.mjs'
const banco = novoClient()
try {
  await banco.connect()
  await banco.query(await fs.readFile(new URL('../db/schema-radar-publico.sql', import.meta.url), 'utf8'))
  console.log('Coordenação do coletor público instalada.')
} finally { await banco.end() }
