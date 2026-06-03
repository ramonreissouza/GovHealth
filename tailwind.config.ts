import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-dm-sans)', 'sans-serif'],
        heading: ['var(--font-syne)', 'sans-serif'],
        mono: ['var(--font-dm-mono)', 'monospace'],
      },
      colors: {
        // Tudo referencia as CSS variables em globals.css (fonte única do tema).
        bg: {
          DEFAULT: 'var(--bg)',
          2: 'var(--bg2)',
          3: 'var(--bg3)',
          4: 'var(--bg4)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          2: 'var(--accent2)',
        },
        brand: {
          amber: 'var(--amber)',
          red: 'var(--red)',
          blue: 'var(--blue)',
          purple: 'var(--purple)',
        },
      },
      borderColor: {
        DEFAULT: 'var(--border)',
        2: 'var(--border2)',
      },
    },
  },
  plugins: [],
}
export default config
