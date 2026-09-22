// scripts/migrate-unidade-esfera.mjs — guarda o que o PNCP já manda e a gente jogava fora:
// o código da unidade compradora e a esfera do órgão. Idempotente.
//
//   npm run unidade:migrate
//
// POR QUE AS DUAS COLUNAS, E POR QUE COM ESTES NOMES
//
// A `chaveCompra` do Compras.gov.br é `UASG(6) + modalidadeSIASG(2) + numero(5) + ano(4)`.
// A UASG viria de `unidadeOrgao.codigoUnidade`, que o PNCP devolve em TODA contratação e
// que os três ingestores descartavam — liam `municipioNome` e `ufSigla` do mesmo objeto e
// ignoravam o resto.
//
// A COLUNA NÃO SE CHAMA `uasg`, E ISSO É DELIBERADO. `codigoUnidade` só é uma UASG quando
// o órgão é FEDERAL. Medido no PNCP em 22/09/2026:
//
//   MUNICIPIO DE BELA VISTA DO CAROBA (esferaId M) → codigoUnidade "1"
//   ESTADO DO CEARA                  (esferaId E) → codigoUnidade "240424"
//
// O segundo tem seis dígitos e passaria por uma UASG sem levantar suspeita — e uma chave
// montada com ele fica BEM FORMADA E ERRADA: não dá erro, devolve o chat de outra compra.
// Chamar a coluna de `uasg` seria escrever essa confusão no esquema. Ela se chama
// `codigo_unidade`, como no PNCP, e quem decide se aquilo é uma UASG é a `esfera`.
//
// Por isso a esfera vem junto, e na mesma migração: sem ela, `codigo_unidade` é um número
// sem significado e o convite ao erro continua de pé. Ela vem de graça — `orgaoEntidade
// .esferaId` já está no MESMO payload da listagem que os ingestores leem, conferido em
// 22/09/2026. Nenhuma requisição a mais.
//
// A TERCEIRA COLUNA: `numero_compra`. Guardávamos `sequencial_compra` e ele NÃO serve para
// a chave. Medido em 38 processos federais em 22/09/2026: a UASG 160050 tem
// `numeroCompra` 267 e `sequencialCompra` 19876. O SIASG usa o primeiro — e ele cabe em
// 5 dígitos em 38 de 38 federais, enquanto o segundo passa de 5 com folga. Montar a chave
// com o sequencial dá uma chave bem formada e errada, que é o modo de falha que este
// arquivo inteiro existe para evitar.
//
// Todas ficam NULL no que já está gravado; o backfill é assunto separado (uma re-leitura
// do PNCP), e nada depende delas estarem preenchidas para funcionar.

import { novoPool } from './lib/pg-ssl.mjs'

const SQL = `
  ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS codigo_unidade TEXT;
  ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS esfera         TEXT;
  ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS numero_compra  TEXT;
  COMMENT ON COLUMN contratacoes.codigo_unidade IS
    'unidadeOrgao.codigoUnidade do PNCP. So e uma UASG do SIASG quando esfera = F.';
  COMMENT ON COLUMN contratacoes.esfera IS
    'orgaoEntidade.esferaId do PNCP: F federal, E estadual, M municipal.';
  COMMENT ON COLUMN contratacoes.numero_compra IS
    'numeroCompra do PNCP. E o numero do SIASG, NAO e sequencial_compra (que e o contador interno do PNCP).';
  CREATE INDEX IF NOT EXISTS idx_contratacoes_esfera ON contratacoes (esfera) WHERE esfera = 'F';
`

if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL nao configurada.'); process.exit(1) }

const banco = novoPool(process.env.DATABASE_URL, { max: 1 })
banco.on('error', (e) => console.error('aviso: conexao do pool caiu e foi descartada:', e?.message ?? e))
try {
  console.log('-> adicionando contratacoes.codigo_unidade e contratacoes.esfera...')
  await banco.query(SQL)
  const { rows } = await banco.query(
    `SELECT count(*)::int AS total,
            count(codigo_unidade)::int AS com_unidade,
            count(esfera)::int AS com_esfera,
            count(numero_compra)::int AS com_numero
       FROM contratacoes`)
  const r = rows[0]
  console.log(`ok. contratacoes: ${r.total} linhas · com codigo_unidade: ${r.com_unidade} · com esfera: ${r.com_esfera} · com numero_compra: ${r.com_numero}`)
  console.log('(zeros sao esperados agora: quem preenche e o ETL, da proxima passada em diante)')
} catch (e) {
  console.error('Falha na migracao:', e.message)
  process.exitCode = 1
} finally {
  await banco.end().catch(() => {})
}
