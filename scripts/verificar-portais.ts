// scripts/verificar-portais.ts — casos de resolução de portal.
//
// Rodar: npm run portais:verificar
//
// POR QUE EXISTE: em 13/08/2026 a expansão do catálogo de 14 para 38 entradas
// introduziu TRÊS regressões seguidas que nenhum typecheck pega, porque todas
// eram de precedência entre sinais:
//   1) portal de transparência virava "Disputa no X" — promessa falsa, o link
//      leva à leitura do edital;
//   2) a URL canônica do PNCP e o curinga `.gov.br` calavam o `usuarioNome`, que
//      é o único sinal de portal de ~190 mil registros;
//   3) os 13 portais originais ficaram sem `tipo: 'disputa'`, e a UI passou a
//      dizer "Ver no Licitanet" em vez de "Disputa no Licitanet".
// Cada caso abaixo trava uma dessas. Mexeu no catálogo, rode isto.

import { resolverPortal, nomePortal, ePortalDeDisputa } from '../src/lib/portais'

const casos: [string, Parameters<typeof resolverPortal>[0], string, boolean][] = [
  ['URL de disputa vence tudo',
    { linkExterno: 'https://portal.licitanet.com.br/x', usuarioNome: 'IPM Sistemas' }, 'licitanet', true],
  ['URL canonica do PNCP NAO cala o usuarioNome',
    { linkExterno: 'https://pncp.gov.br/app/editais/123/2026/4', usuarioNome: 'BLL Compras' }, 'bll', true],
  ['curinga .gov.br NAO cala o usuarioNome',
    { linkExterno: 'https://compras.barueri.sp.gov.br/x', usuarioNome: 'Licitanet Licitacoes Eletronicas LTDA' }, 'licitanet', true],
  ['so PNCP, sem mais nada -> PNCP (nao desconhecido)',
    { linkExterno: 'https://pncp.gov.br/app/editais/123/2026/4' }, 'pncp', false],
  ['municipal proprio, sem usuarioNome -> orgao-proprio',
    { linkExterno: 'https://compras.barueri.sp.gov.br/x' }, 'orgao-proprio', false],
  ['transparencia NAO e disputa',
    { linkExterno: 'https://pmroseira.geosiap.net.br:8443/portal-transparencia/x' }, 'geosiap', false],
  ['comprasgovernamentais.gov.br = Compras.gov',
    { linkExterno: 'https://comprasgovernamentais.gov.br/x' }, 'comprasgov', true],
  ['estadual pela URL com www1',
    { linkExterno: 'https://www1.compras.mg.gov.br/x' }, 'compras-mg', true],
  ['nada -> desconhecido',
    {}, 'desconhecido', false],
  ['marcador no objeto quando nao ha link',
    { objeto: '[LICITANET] - aquisicao de luvas' }, 'licitanet', true],
]

let falhas = 0
for (const [rot, row, esperado, disputaEsperada] of casos) {
  const got = resolverPortal(row)
  const disp = ePortalDeDisputa(got)
  const ok = got === esperado && disp === disputaEsperada
  if (!ok) falhas++
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${rot}`)
  if (!ok) console.log(`      esperado=${esperado}/disputa=${disputaEsperada}  obtido=${got}/disputa=${disp}`)
  else console.log(`      -> ${got} (${nomePortal(got)}) disputa=${disp}`)
}
console.log(`\n${casos.length - falhas}/${casos.length} passaram`)
process.exit(falhas ? 1 : 0)
