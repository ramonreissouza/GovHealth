import type { Config } from 'tailwindcss'
import paleta from 'tailwindcss/colors'

/**
 * Cor do tema que ACEITA modificador de opacidade (`bg-accent/10`).
 *
 * POR QUE NÃO É SÓ `'var(--accent)'`
 * Com a cor escrita como string `var(...)`, o Tailwind 3 não consegue separar os canais
 * para aplicar alfa e **simplesmente não gera a classe** — `bg-accent/10` não existe no
 * CSS, o elemento fica sem fundo e ninguém percebe, porque a tela continua funcionando,
 * só mais apagada do que o código promete. Medido antes deste conserto: 94 classes
 * distintas mortas, 456 usos, entre eles 27 `hover:bg-accent/90` (o hover dos botões
 * primários não fazia nada).
 *
 * A forma de função recebe `opacityValue` e devolve `color-mix`, que compõe o alfa sem
 * precisar dos canais soltos. A alternativa canônica (`<alpha-value>`) exigiria trocar
 * todas as CSS vars para tripla RGB — o que quebraria cada `var(--accent)` usado direto
 * no globals.css.
 */
const tema = (nome: string) =>
  // O cast é necessário e fica só aqui: o Tailwind ACEITA função de cor em tempo de
  // execução, mas o tipo `Config` declara os valores de cor apenas como string —
  // sem isto o `next build` falha na checagem de tipos.
  ((({ opacityValue }: { opacityValue?: string }) =>
    opacityValue === undefined
      ? `var(${nome})`
      : `color-mix(in srgb, var(${nome}) calc(${opacityValue} * 100%), transparent)`) as unknown as string)

const config: Config = {
  // `src/**`, e não só pages/components/app: havia classe de cor em `src/lib` (crm.ts,
  // edital-workspace.ts) que o Tailwind nunca via, então nem sem opacidade ela existia.
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-dm-sans)', 'sans-serif'],
        heading: ['var(--font-syne)', 'sans-serif'],
        mono: ['var(--font-dm-mono)', 'monospace'],
      },
      colors: {
        // Tudo referencia as CSS variables em globals.css (fonte única do tema).
        // Chaves PLANAS, não aninhadas: `bg: { 2: … }` gera `bg-bg-2`, e o nome que o
        // código usa (595 vezes) é `bg-bg2`. Aninhado, `bg-bg2` só existia como classe
        // manual no globals.css — por isso `bg-bg3/40` nunca saía.
        bg: tema('--bg'),
        bg2: tema('--bg2'),
        bg3: tema('--bg3'),
        bg4: tema('--bg4'),
        accent: {
          DEFAULT: tema('--accent'),
          2: tema('--accent2'),   // `accent-2` (1 uso)
        },
        accent2: tema('--accent2'), // `accent2`, o nome de verdade (11 usos)
        brand: {
          amber: tema('--amber'),
          red: tema('--red'),
          blue: tema('--blue'),
          purple: tema('--purple'),
        },
        // Nomes curtos que o código já usava (`bg-amber/15`, `border-red/30`) mas que só
        // existiam como classe escrita à mão no globals.css — e só na variante `text-`.
        // A paleta padrão é espalhada ANTES do DEFAULT: sem isso, declarar `red` aqui
        // apagaria a escala inteira do Tailwind e mataria os `bg-red-500` que funcionam.
        amber: { ...paleta.amber, DEFAULT: tema('--amber') },
        red: { ...paleta.red, DEFAULT: tema('--red') },
        blue: { ...paleta.blue, DEFAULT: tema('--blue') },
        purple: { ...paleta.purple, DEFAULT: tema('--purple') },
        teal: { ...paleta.teal, DEFAULT: tema('--teal') },
        orange: { ...paleta.orange, DEFAULT: tema('--orange') },
        // Texto e bordas do tema, idem: existiam só como .text-faint / .border-subtle
        // manuais, então `text-faint/70` e `border-subtle/50` não saíam.
        strong: tema('--text'),
        muted: tema('--text2'),
        faint: tema('--text3'),
        subtle: tema('--border'),
        subtle2: tema('--border2'),
      },
      borderColor: {
        DEFAULT: 'var(--border)',
        2: tema('--border2'),
      },
    },
  },
  plugins: [],
}
export default config
