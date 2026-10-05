// marketing/instagram/render.mjs
// Transforma o slides.html de um post em PNGs 1080x1350 prontos para o Instagram.
//
// Uso (da raiz do repo):
//   node marketing/instagram/render.mjs marketing/instagram/fila/<pasta-do-post>
//
// Cada <section class="slide"> do slides.html vira 01.png, 02.png... na mesma pasta.
// Usa o Playwright que o projeto já tem (scripts/shots/capture.mjs).
//
// ATÔMICO: renderiza tudo numa pasta temporária, valida quantidade e dimensões e
// só então troca os PNGs da pasta do post. Antes os PNGs antigos eram apagados
// primeiro, e uma falha no meio (Chromium caiu, slide quebrou) deixava a pasta
// vazia ou com metade de uma versão e metade de outra.
import { chromium } from 'playwright'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { pathToFileURL } from 'url'

const LARGURA = 1080
const ALTURA = 1350
// Precisam carregar das fontes locais (template/fonts). Se uma faltar, o PNG
// sairia com fonte de sistema sem ninguém perceber.
const FONTES = ['600 40px Fraunces', 'italic 400 40px Fraunces', '700 40px Archivo', '400 40px "IBM Plex Mono"']
const FAMILIAS = ['Fraunces', 'Archivo', 'IBM Plex Mono']

const dir = process.argv[2]
if (!dir) {
  console.error('Uso: node marketing/instagram/render.mjs <pasta-do-post>')
  process.exit(1)
}
const html = path.resolve(dir, 'slides.html')
if (!fs.existsSync(html)) {
  console.error(`Não achei ${html}`)
  process.exit(1)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-render-'))
let browser
try {
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1180, height: 1400 }, deviceScaleFactor: 1 })
  // Tudo é local (CSS, fontes, imagens): 'load' basta, e não depende de rede.
  await page.goto(pathToFileURL(html).href, { waitUntil: 'load' })
  await page.evaluate(async (fontes) => { await Promise.all(fontes.map((f) => document.fonts.load(f))); await document.fonts.ready }, FONTES)

  // document.fonts.check() devolve true quando a página nem declara a fonte, então
  // não serve: confere se cada família tem um FontFace de fato carregado.
  const carregadas = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, '')))
  const faltando = FAMILIAS.filter((f) => !carregadas.includes(f))
  if (faltando.length) throw new Error(`Fontes que não carregaram: ${faltando.join(', ')}`)

  // Imagem quebrada vira PNG com buraco e ninguém percebe até postar.
  const quebradas = await page.$$eval('img', (imgs) => imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')))
  if (quebradas.length) throw new Error(`Imagens que não carregaram: ${quebradas.join(', ')}`)

  const slides = await page.$$('section.slide')
  if (!slides.length) throw new Error('Nenhum <section class="slide"> no slides.html')

  for (let i = 0; i < slides.length; i++) {
    const box = await slides[i].boundingBox()
    if (!box || Math.round(box.width) !== LARGURA || Math.round(box.height) !== ALTURA) {
      throw new Error(`Slide ${i + 1} tem ${box ? `${box.width}x${box.height}` : 'tamanho desconhecido'}, esperado ${LARGURA}x${ALTURA}`)
    }
    await slides[i].screenshot({ path: path.join(tmp, `${String(i + 1).padStart(2, '0')}.png`) })
  }

  const novos = fs.readdirSync(tmp).filter((f) => /^\d{2}\.png$/.test(f)).sort()
  if (novos.length !== slides.length) throw new Error(`Gerei ${novos.length} de ${slides.length} slides`)

  // Só agora mexe na pasta do post: remove os PNGs velhos e copia os novos.
  for (const f of fs.readdirSync(dir)) if (/^\d{2}\.png$/.test(f)) fs.unlinkSync(path.join(dir, f))
  for (const f of novos) {
    fs.copyFileSync(path.join(tmp, f), path.join(dir, f))
    console.log('✓', path.relative(process.cwd(), path.join(dir, f)))
  }
  console.log(`${novos.length} slide(s) gerado(s).`)
} catch (e) {
  console.error('Render falhou, os PNGs anteriores foram mantidos:', e.message)
  process.exitCode = 1
} finally {
  await browser?.close()
  fs.rmSync(tmp, { recursive: true, force: true })
}
