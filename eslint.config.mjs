// eslint.config.mjs — configuração do ESLint (flat config, ESLint 9).
//
// POR QUE ISSO EXISTE: o projeto rodava SEM lint nenhum. O script `next lint` foi
// removido no Next 16 (ele passou a interpretar "lint" como diretório e falhava com
// "no such directory: .../lint"), e não havia arquivo de configuração — então
// `npx eslint` também não rodava. Resultado prático: um `useMemo` com dependência
// faltando (`portalFiltro`, em src/app/radar/page.tsx) foi para produção e virou
// "o filtro demora dois minutos para aplicar". A regra que pega isso de graça é
// react-hooks/exhaustive-deps, e por isso ela é ERRO aqui, não aviso.
//
// `eslint-config-next` 16 JÁ é flat config (array pronto) — não precisa de FlatCompat.
//
// Rodar: npm run lint   (ou npm run lint:fix)

import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescriptCfg from 'eslint-config-next/typescript'

export default [
  {
    ignores: [
      '.next/**', 'node_modules/**', 'public/**', 'next-env.d.ts',
      // Scripts de ETL/worker: Node puro, sem JSX, com console e await em laço de
      // propósito. Ficam de fora por ora — entram numa etapa própria se valer a pena.
      'scripts/**', 'audit/**',
    ],
  },
  ...coreWebVitals,
  ...typescriptCfg,
  {
    rules: {
      // ── ERRO: pega bug de verdade, e o código está limpo nessas regras hoje ──────
      // O motivo desta configuração existir (ver cabeçalho): dependência faltando ou
      // instável em hook não é estilo, é bug silencioso — a tela para de reagir ao
      // estado (foi o filtro de portal do Radar) ou o efeito roda a cada render.
      'react-hooks/exhaustive-deps': 'error',
      // Ordem dos hooks: isto pegou 7 `useState` DEPOIS de um early-return em
      // /assinar, que derruba o React ao trocar de plano na mesma tela.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/refs': 'error',
      'react-hooks/immutability': 'error',
      // `catch {}` vazio é o padrão da casa em "melhor esforço" (a próxima carga
      // reconcilia); o que interessa é variável/import morto.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none',
      }],

      // ── AVISO: dívida real, volume grande, não trava ninguém hoje ───────────────
      // Estas vêm das regras novas do React Compiler no eslint-config-next 16 e
      // acusam ~75 pontos espalhados pelo produto. Ficam como AVISO de propósito:
      // virar erro agora reprovaria o lint em quase toda tela e o comando deixaria de
      // ser útil. Baixar uma a uma para 'error' conforme forem sendo limpas:
      //  • set-state-in-effect (~60): setState direto no corpo do efeito — causa
      //    render extra e, em alguns casos, laço. É a maior fatia da dívida.
      //  • static-components: componente declarado dentro de outro (remonta a cada
      //    render e perde estado interno).
      //  • purity: Date.now()/leitura impura durante o render.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/purity': 'warn',
      // Cosméticas: aspas/apóstrofos em texto JSX e `any` remanescente.
      'react/no-unescaped-entities': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
    },
  },
]
