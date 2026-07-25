// scripts/lib/estados-ckan.mjs — utilidades para ingest de portais de transparência
// estaduais via CKAN (dados.<uf>.gov.br). Compartilhado pelos ingests da Bahia (piloto)
// e extensível a outros estados. Windows: usa Expand-Archive nativo p/ os .zip.
//
// Os portais estaduais publicam ZIPs grandes (centenas de MB) com CSVs (UTF-8, ';',
// campos entre aspas, decimal com vírgula). Por isso o parser é STREAMING e quote-aware
// (memória constante, aguenta campos com ';' e quebras de linha internas).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { Readable } from 'node:stream'

// O cert TLS de alguns portais estaduais (ex.: dados.ba.gov.br) não valida na cadeia
// padrão do Node. Como é download de dado público oficial, relaxamos só aqui.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

// Temp FORA do projeto: os ZIPs têm centenas de MB e o repo fica no OneDrive — baixar
// aqui dispararia upload de GB para a nuvem. Usa o %TEMP% do SO.
export const TMP = path.join(os.tmpdir(), 'govhealth-estados')

export async function ckanRecursoZip(ckanApi, datasetId, nameRe) {
  const j = await (await fetch(`${ckanApi}/package_show?id=${datasetId}`, { signal: AbortSignal.timeout(30000) })).json()
  const rs = (j.result?.resources || []).filter((x) => /zip/i.test(x.format || ''))
  const cand = nameRe ? rs.filter((x) => nameRe.test(x.name || '') || nameRe.test(x.url || '')) : rs
  cand.sort((a, b) => new Date(b.last_modified || b.created || 0) - new Date(a.last_modified || a.created || 0))
  return cand[0] || rs[0] || null
}

// Baixa (stream → arquivo) para não segurar centenas de MB em memória. RESUMÍVEL:
// arquivos de centenas de MB do portal caem no meio ("other side closed"); em cada
// tentativa retoma de onde parou via HTTP Range (bytes=<já baixado>-).
export async function baixar(url, destPath, { tentativas = 8 } = {}) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  // Já baixado por completo? (HEAD → Content-Length) evita rebaixar centenas de MB.
  if (fs.existsSync(destPath)) {
    try {
      const h = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30000) })
      const total = Number(h.headers.get('content-length') || 0)
      if (total > 0 && fs.statSync(destPath).size === total) { console.log('  [download] já completo em disco — pulando'); return destPath }
    } catch { /* segue p/ download/resume */ }
  }
  for (let t = 0; t < tentativas; t++) {
    let feito = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0
    try {
      const headers = feito > 0 ? { Range: `bytes=${feito}-` } : {}
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(900000) })
      // 206 = servidor honrou o Range (append); 200 = mandou tudo (recomeça o arquivo).
      if (res.status !== 200 && res.status !== 206) throw new Error(`download HTTP ${res.status}`)
      const append = res.status === 206 && feito > 0
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(destPath, { flags: append ? 'a' : 'w' })
        const rs = Readable.fromWeb(res.body)
        // Em erro, DESTRÓI ambos os streams — senão o handle de escrita fica pendurado
        // e trava o .zip para o unzip seguinte ("being used by another process").
        const falha = (e) => { rs.destroy(); out.destroy(); reject(e) }
        rs.on('error', falha); out.on('error', falha); out.on('finish', resolve)
        rs.pipe(out)
      })
      return destPath // concluiu sem erro
    } catch (e) {
      const agora = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0
      console.warn(`  [download] queda em ${(agora / 1048576).toFixed(1)}MB (tentativa ${t + 1}/${tentativas}) — retomando: ${e.message}`)
      if (t === tentativas - 1) throw e
      await new Promise((r) => setTimeout(r, 3000 * (t + 1)))
    }
  }
  return destPath
}

// Descompacta um .zip (Windows PowerShell Expand-Archive). Retorna o diretório destino.
export function expandir(zipPath, destDir) {
  fs.rmSync(destDir, { recursive: true, force: true })
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Expand-Archive -Path '${path.resolve(zipPath)}' -DestinationPath '${path.resolve(destDir)}' -Force`],
    { stdio: 'ignore' })
  return destDir
}

export function csvsEm(dir) {
  return fs.readdirSync(dir).filter((f) => /\.csv$/i.test(f)).map((f) => path.join(dir, f))
}

// Extrai ENTRADAS específicas de um .zip (via System.IO.Compression, robusto p/ arquivos
// grandes — o Expand-Archive engasga em entradas de ~1GB). `nomes` = regexes; retorna os
// caminhos extraídos. Evita descompactar entradas gigantes desnecessárias.
export function extrairEntradas(zipPath, nomesRe, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  const zp = path.resolve(zipPath).replace(/'/g, "''")
  const dd = path.resolve(destDir).replace(/'/g, "''")
  const res = nomesRe.map((r) => r.source).join('|')
  const ps = `Add-Type -AssemblyName System.IO.Compression.FileSystem;` +
    `$z=[System.IO.Compression.ZipFile]::OpenRead('${zp}');` +
    `foreach($e in $z.Entries){ if($e.Name -match '${res}'){ ` +
    `[System.IO.Compression.ZipFileExtensions]::ExtractToFile($e,(Join-Path '${dd}' $e.Name),$true); Write-Output $e.Name } };` +
    `$z.Dispose()`
  const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return out.split(/\r?\n/).filter(Boolean).map((n) => path.join(destDir, n))
}

// Parser CSV STREAMING quote-aware. Chama onRegistro(obj, i) por linha (memória
// constante). Delimitador ';', aspas '"' ("" = aspa escapada), UTF-8 com BOM.
export async function processarCsv(csvPath, onRegistro) {
  const stream = fs.createReadStream(csvPath, { encoding: 'utf8' })
  let header = null
  let i = 0
  let campo = ''
  let campos = []
  let emAspas = false
  let anteriorAspa = false // p/ detectar "" dentro de campo aspeado

  function fechaRegistro() {
    campos.push(campo); campo = ''
    const arr = campos; campos = []
    if (arr.length === 1 && arr[0] === '') return // linha vazia
    if (!header) { header = arr.map((h) => h.replace(/^﻿/, '').trim()); return }
    const obj = {}
    for (let k = 0; k < header.length; k++) obj[header[k]] = arr[k] ?? ''
    onRegistro(obj, i++)
  }

  for await (const chunk of stream) {
    for (let p = 0; p < chunk.length; p++) {
      const c = chunk[p]
      if (emAspas) {
        if (anteriorAspa) { // vimos uma aspa; decide se fecha ou é escape
          anteriorAspa = false
          if (c === '"') { campo += '"'; continue }
          emAspas = false // aspa isolada fechou o campo; reprocessa c fora de aspas
        } else if (c === '"') { anteriorAspa = true; continue }
        else { campo += c; continue }
      }
      if (c === '"') { emAspas = true }
      else if (c === ';') { campos.push(campo); campo = '' }
      else if (c === '\n') { fechaRegistro() }
      else if (c === '\r') { /* ignora */ }
      else { campo += c }
    }
  }
  if (campo !== '' || campos.length) fechaRegistro() // último registro sem \n final
}

export function parseBR(v) {
  if (v == null) return 0
  const s = String(v).trim().replace(/\./g, '').replace(',', '.')
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

export function normKey(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
}

// Cliente pg resiliente (Neon derruba conexões ociosas em ingests longos).
export function novoPg(pg) {
  let db = null
  const conectar = () => { db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); db.on('error', () => { db = null }); return db }
  return {
    async query(text, params, tent = 0) {
      try { if (!db) { db = conectar(); await db.connect() } return await db.query(text, params) }
      catch (e) { try { await db?.end() } catch {} ; db = null; if (tent < 5) { await new Promise((r) => setTimeout(r, 1000 * (tent + 1))); return this.query(text, params, tent + 1) } throw e }
    },
    async end() { try { await db?.end() } catch {} },
  }
}
