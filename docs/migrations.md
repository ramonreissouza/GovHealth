# Migrations: como escrever uma que o deploy aplica sozinho

O deploy da `main` (Jenkins, job `govhealth-deploy-k8s`) aplica as
migrations sozinho. Ninguém precisa mais rodar `npm run *:migrate`
à mão antes do merge. Em troca, todo script de migration precisa seguir as
regras abaixo. Um script fora delas pode ser pulado, rodar duas vezes ou
travar o app em produção.

O lado do pipeline está documentado no repositório `infra` da TecHealth
(`docs/15-jenkins-deploy-govhealth.md`, seção 15.5). Este documento é o lado de
quem escreve a migration.

## O que o deploy faz

A cada merge na `main`:

1. **Descobre as migrations do deploy.** Compara o commit que está no ar com o
   novo. Um `scripts/**/migrate-*.mjs` entra se, nesse intervalo, mudou:
   - o próprio script;
   - um `db/*.sql` que o script cita pelo nome;
   - um módulo que o script importa por caminho relativo, fora de
     `scripts/lib/` (ex.: `../src/lib/categoria-mercado.ts`).

   Elas rodam na ordem em que os scripts foram criados: a mais antiga primeiro.
2. **Faz backup do banco inteiro** (`pg_dump`) e confere o arquivo. Sem espaço
   em disco ou com o dump falhando, nenhuma migration roda.
3. **Roda cada script com `node scripts/...`**, na imagem do worker, com o
   `DATABASE_URL` de produção no ambiente. Para no primeiro que falhar.
4. **Só depois atualiza app e worker.** Se qualquer migration falhar, nada é
   implantado: o site segue na versão anterior e o próximo deploy tenta de novo.

O código novo, portanto, só sobe com o schema já aplicado. Por alguns minutos,
porém, o código **antigo** roda sobre o schema **novo** (regra 6).

## As regras

### 1. Nome e lugar

`scripts/migrate-<assunto>.mjs` ou `scripts/<área>/migrate-<assunto>.mjs`, com
um atalho `<assunto>:migrate` no `package.json` para quem roda local.

Qualquer outro nome é ignorado pelo deploy. É assim de propósito com
`seed-*.mjs`, `migrar-*.mjs` e com os scripts de backfill ou ETL: eles não
rodam sozinhos.

### 2. Idempotente, sempre

**Rodar o script duas vezes tem de dar o mesmo resultado que rodar uma.** O
deploy roda de novo scripts já aplicados em vários casos normais: deploy
repetido depois de uma falha, rollback seguido de um novo deploy, `.sql`
citado só num comentário. Não existe tabela de controle de "já rodou".

| Em vez de | Use |
|---|---|
| `CREATE TABLE x` | `CREATE TABLE IF NOT EXISTS x` |
| `ALTER TABLE x ADD COLUMN y` | `ALTER TABLE x ADD COLUMN IF NOT EXISTS y` |
| `CREATE INDEX i ON ...` | `CREATE INDEX IF NOT EXISTS i ON ...` |
| `DROP ... x` | `DROP ... IF EXISTS x` |
| `INSERT INTO ...` (seed) | `INSERT ... ON CONFLICT DO NOTHING` (ou `DO UPDATE`) |
| `UPDATE t SET plano = 'x'` | `UPDATE t SET plano = 'x' WHERE plano IS DISTINCT FROM 'x'` |
| `CREATE FUNCTION` / `VIEW` | `CREATE OR REPLACE ...` |

Quando o `IF NOT EXISTS` não basta (coluna gerada cuja expressão pode mudar,
por exemplo), guarde uma marca e compare antes de agir. O
`migrate-categoria-mercado.mjs` grava uma impressão digital da expressão num
`COMMENT ON COLUMN` e só recria a coluna quando ela muda.

### 3. Falhar de verdade

Se algo der errado, o processo tem de **sair com código diferente de zero**.
É isso que para o deploy. Os dois jeitos que já usamos:

```js
} catch (e) {
  console.error('Falha na migração:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
```

ou simplesmente não capturar o erro. **Nunca** capture e só imprima: o deploy
entenderia que deu certo e subiria o código novo sem o schema.

### 4. Conexão pelo ambiente

- Leia `DATABASE_URL` de `process.env`. O fallback para o `.env.local` pode
  ficar, para quem roda local; em produção o arquivo não existe.
- Conecte com `novoClient()` / `novoPool()` ou `sslParaHost()`, de
  `scripts/lib/pg-ssl.mjs`. Nada de `ssl` fixo no script.
- **Não dependa de flag do `npm run`.** O deploy chama `node <script>`
  direto, sem `--env-file` nem outra flag do `package.json`. Import de `.ts`
  funciona sem flag (Node 24).
- Não use `@/` nem outro alias do `tsconfig` num import: o `node` não os
  resolve. Use caminho relativo (`../src/lib/x.ts`).

### 5. SQL em arquivo: cite pelo nome

Se o SQL mora num arquivo, deixe-o em `db/` (na raiz, sem subpasta) e cite o
nome no script, como os atuais fazem:

```js
const sql = fs.readFileSync(path.join('db', 'schema-stripe.sql'), 'utf8')
```

É esse nome que liga o `.sql` ao script: mudar o `db/schema-stripe.sql` faz o
deploy rodar o `migrate-stripe.mjs`.

**Mudar um `db/*.sql` que nenhum script cita para o deploy**, a não ser que o
mesmo deploy traga outra migration. Nesse caso, o arquivo é tratado como espelho
e vira só um aviso. É o caso do `db/schema.sql`: mantenha-o atualizado como o
schema completo, para quem monta um banco do zero com `npm run db:setup`, mas a
mudança em produção tem de vir de um `migrate-*.mjs`.

### 6. Compatível com o código de antes

A migration roda **antes** do código novo subir, e o rollback volta só o
código, nunca o schema. Então a migration tem de funcionar com as duas
versões do código:

- **Coluna nova:** `NULL` ou com `DEFAULT`. `NOT NULL` sem default quebra o
  `INSERT` do código antigo.
- **Remover ou renomear coluna ou tabela:** em **dois deploys**. No primeiro, o
  código para de usar; no segundo, uma migration remove. Renomear é criar a
  nova, copiar e remover a velha depois.
- **Mudar tipo ou restrição:** a mesma ideia. Primeiro o código aceita os dois
  jeitos, depois o banco muda.

### 7. Não travar o app

O banco está em uso enquanto a migration roda, e o deploy liga
`lock_timeout = 15s`: um `ALTER TABLE` que não consegue o lock em 15 segundos
**falha** (e o deploy para), em vez de ficar na fila segurando as consultas do
site. Por isso:

- **Índice em tabela grande** (`contratacoes`, `itens`, `resultados`): use
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, fora de transação. Um
  `CONCURRENTLY` interrompido deixa o índice `INVALID`, e o `IF NOT EXISTS`
  pula ele na próxima vez. Confira e falhe com instrução, como o
  `scripts/radar/migrate-link-externo-idx.mjs` faz.
- **Evite reescrever tabela grande**: `ADD COLUMN` com `DEFAULT` volátil,
  coluna `GENERATED ... STORED`, `ALTER COLUMN TYPE`. Tudo isso segura a tabela
  inteira enquanto roda. Quando for inevitável, avise no PR: o merge vira
  janela de manutenção daquela tela.
- **Backfill de dado grande** não é migration. Faça um script à parte, em lotes,
  rodado à mão ou pelo worker.
- Operação que precisa de mais que o `statement_timeout` padrão: aumente no
  próprio script (`SET statement_timeout = '900s'`), como o
  `migrate-categoria-mercado.mjs`.

O pod da migration morre em 30 minutos, contando o backup.

### 8. Dependência entre migrations

Um script pode contar com as migrations **criadas antes dele** (já estão em
produção ou rodam antes no mesmo deploy). Não pode contar com as criadas
depois. A ordem é a do commit que adicionou cada script; dois scripts
adicionados no mesmo commit rodam em ordem alfabética do caminho. Se uma
migration depende de outra do mesmo PR, adicione-as em commits separados, na
ordem certa, ou junte as duas num script só.

## Como testar antes do PR

Contra um banco local ou uma cópia (nunca produção):

```bash
DATABASE_URL=postgres://govhealth:senha@localhost:5432/govhealth node scripts/migrate-x.mjs
DATABASE_URL=postgres://govhealth:senha@localhost:5432/govhealth node scripts/migrate-x.mjs   # de novo
echo $?   # 0, e a segunda rodada não pode mudar nada
```

Chame o `node` direto, como o deploy faz, e não o `npm run`. Para testar o
caminho de falha, rode contra um banco sem a tabela que o script altera: tem
de sair com código 1.

## Checklist do PR com migration

- [ ] `scripts/**/migrate-*.mjs`, com atalho no `package.json`
- [ ] idempotente: rodou duas vezes local, e a segunda não mudou nada
- [ ] sai com código ≠ 0 quando falha
- [ ] `DATABASE_URL` do ambiente, conexão por `scripts/lib/pg-ssl.mjs`, sem alias
- [ ] SQL em `db/<nome>.sql` citado pelo nome no script (se houver arquivo)
- [ ] o código **anterior** continua funcionando com o schema novo
- [ ] nada de lock longo em tabela grande (ou avisado no PR)
- [ ] `db/schema.sql` atualizado como espelho

## Quando o deploy para por causa de migration

O log do job (`govhealth-deploy-k8s`) mostra a saída do backup e de cada
script. O site continua no ar, na versão anterior.

| Mensagem | O que fazer |
|---|---|
| `Falha na migração: ...` no log de um script | Corrija o script num PR novo. O próximo deploy roda de novo. |
| `canceling statement due to lock timeout` | Algo segurava a tabela. Rode o job de novo; se repetir, veja a regra 7. |
| `muda schema que nenhum script de migration aplica` | Um `db/*.sql` mudou sem script (regra 5). Escreva o `migrate-*.mjs`, ou aplique à mão e rode o job com `MIGRATIONS=nenhuma`. |
| `espaço insuficiente para o backup` | Falta disco na VPS. Fale com quem cuida da infra. |
| `Há uma migration de um build anterior ainda rodando` | Espere ela terminar e rode o job de novo. |

Pelo parâmetro **`MIGRATIONS`** do job (só no disparo manual, no Jenkins),
dá para forçar ou pular:

- vazio: automático;
- `nenhuma`: não aplica nada (o schema já foi aplicado à mão);
- `scripts/migrate-x.mjs scripts/radar/migrate-y.mjs`: aplica exatamente
  esses, nessa ordem.

O backup de antes de cada rodada fica na VPS, e os três últimos são mantidos. A
restauração está no `docs/15` do `infra`.
