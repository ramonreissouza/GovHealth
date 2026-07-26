// scripts/geo/gen-municipios.mjs — gera a base de coordenadas por município do Brasil
// para o mapa de calor. Fonte pública (IBGE via kelvins/municipios-brasileiros).
// Saída: src/lib/geo/municipios-br.json — { "UF|NOME_NORMALIZADO": [lat, lng] }.
//
// Uso: npm run geo:municipios   (one-off; commitar o JSON gerado)

import fs from 'node:fs'
import path from 'node:path'

const BASE = 'https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/json'

// Mesma normalização usada no servidor p/ casar o nome do PNCP: sem acento, maiúsculas,
// sem pontuação, espaços colapsados.
function norm(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

const [rm, re] = await Promise.all([fetch(`${BASE}/municipios.json`), fetch(`${BASE}/estados.json`)])
if (!rm.ok || !re.ok) { console.error('Falha ao baixar datasets IBGE:', rm.status, re.status); process.exit(1) }
const municipios = await rm.json()
const estados = await re.json()

const ufPorCodigo = new Map(estados.map((e) => [e.codigo_uf, e.uf]))
const out = {}
let n = 0
for (const m of municipios) {
  const uf = ufPorCodigo.get(m.codigo_uf)
  if (!uf || m.latitude == null || m.longitude == null) continue
  out[`${uf}|${norm(m.nome)}`] = [Math.round(m.latitude * 1e4) / 1e4, Math.round(m.longitude * 1e4) / 1e4]
  n++
}

const dest = path.join('src', 'lib', 'geo', 'municipios-br.json')
fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.writeFileSync(dest, JSON.stringify(out))
console.log(`✓ ${n} municípios gravados em ${dest} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`)
