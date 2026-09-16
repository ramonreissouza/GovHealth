# Mover o banco para outra VPS sem perder dado

Roteiro medido em 11/09/2026 contra a instalação real, não genérico.

## 1. O que temos hoje

| | |
|---|---|
| versão | PostgreSQL **18.4** (Ubuntu, pgdg) |
| banco / papel | `govhealth` / `govhealth` |
| tamanho | **1.544 MB** em 16/09 (era 1.433 MB em 11/09 — cresce ~22 MB/dia) |
| tabelas | 32 · maiores: `itens` 649MB, `contratacoes` 500MB, `resultados` 296MB |
| extensões | `pg_trgm 1.6`, `plpgsql` |
| Postgres escuta | **127.0.0.1:5432** (não exposto) |
| PgBouncer escuta | **0.0.0.0:6432**, `client_tls_sslmode = require`, cert próprio |
| backup | diário 03:15 → `/var/backups/pg/govhealth-AAAAMMDD-0315.dump`, 7 dias |

O backup está saudável: o de 11/09 tem 143MB, 205 entradas e **32 tabelas com dados** —
o mesmo número de tabelas do banco. Conferido de novo em **16/09**: a versão (18.4), as
extensões, os papéis e as 32 tabelas seguem iguais; só o volume subiu. **`radar_saude`
continua sendo a única tabela sem chave primária**, que é o fato que decide o método na
seção 2 — se um dia ela ganhar PK, a replicação lógica passa a ser uma opção real.

O que cresce é `itens` (+66 MB em 5 dias), porque o backfill de itens está rodando. Se a
janela de migração for depois de muito tempo, remeça — o dump de hoje sai perto de
**155 MB**, não mais 143 MB.

## 2. Método: `pg_dump` / `pg_restore`

Com 143MB de dump, a restauração leva minutos. As alternativas não pagam o preço:

- **Replicação lógica** (quase sem parada) exige chave primária em toda tabela — e
  `radar_saude` **não tem**. Daria para contornar com `REPLICA IDENTITY FULL`, mas é
  complexidade para economizar ~15 minutos de madrugada.
- **Replicação física** (streaming + promote) exige a mesma versão major e mais
  montagem, para o mesmo ganho pequeno.

## 3. A janela: sábado de manhã cedo

Não é preferência, é medição. O PNCP publica por dia da semana assim (120 dias):

```
seg 832 · ter 888 · qua 978 · qui 871 · sex 826 · SÁB 14 · DOM 9
```

Parar a coleta num sábado custa quase nada. E o feriado/fim de semana agora é entendido
pela régua da cobertura, então nenhum dia parado vira falso buraco depois.

## 4. Ensaio ANTES do dia (sem parada nenhuma)

**Este é o passo que transforma o risco em rotina — não pule.** Ele roda com tudo no ar,
usando o dump da madrugada:

```bash
# na VPS nova, já com PG 18 instalado
sudo -u postgres createuser govhealth
sudo -u postgres createdb -O govhealth govhealth
sudo -u postgres psql -d govhealth -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'

# traz o dump de ontem e restaura, cronometrando
scp ubuntu@163.176.103.191:/var/backups/pg/govhealth-AAAAMMDD-0315.dump .
time pg_restore -U govhealth -d govhealth -j 2 --no-owner --no-privileges govhealth-*.dump
```

O ensaio responde três coisas que ninguém quer descobrir com o sistema parado: quanto
tempo leva de verdade, se alguma extensão ou permissão falta, e se o PgBouncer novo
aceita a conexão da app. Depois do ensaio, **apague o banco de teste** e recrie vazio.

## 5. Quem escreve no banco (a lista que faz "sem perder dado" ser verdade)

Nada disso pode estar rodando durante o dump final.

**Tarefas agendadas nesta máquina** (Agendador do Windows):

```
GovHealth Sync Cobertura      01:00 / 12:00 / 18:00
GovHealth Refresh 2 Dias      05:00, de 2 em 2 dias
GovHealth ETL Refresh         03:00, de 3 em 3 dias
GovHealth Backfill Itens 1mi  11:00
GovHealth Radar Sync          de 2 em 2 horas
GovHealth Radar Urgente       de 20 em 20 minutos
GovHealth Licitacoes-e        05:00
GovHealth Pipeline Noite      (sem próxima execução)
GovHealth CAPAG Ingest        04:30, semanal
```

Desligar todas de uma vez:

```powershell
Get-ScheduledTask | Where-Object { $_.TaskName -like 'GovHealth*' } | Disable-ScheduledTask
```

**Crons da Vercel** (`vercel.json`): `sync-pncp` 03:00, `sync-emendas` 04:00,
`sync-transferegov` 06:00, `alertas-email` 11:00, `trial-reminders` 12:00. Numa janela de
sábado entre 07:00 e 08:00 nenhum deles cai — confira o horário antes de escolher.

**A app.** Usuário logado escreve (`page_view`, cadastro, feedback, conversas de IA).
Numa janela curta de sábado cedo o tráfego é próximo de zero, mas o honesto é aceitar
que o que for escrito depois do dump final e antes da virada **se perde**. Se isso não
for aceitável, ponha a app em manutenção durante os ~15 minutos.

## 6. O dia

```bash
# 1. tarefas desligadas (comando acima) e nenhuma conexão viva
ssh ubuntu@163.176.103.191 "sudo -u postgres psql -c \"SELECT count(*) FROM pg_stat_activity WHERE datname='govhealth' AND pid<>pg_backend_pid();\""

# 2. contagem POR TABELA no origem — é o que vai provar que nada sumiu
ssh ubuntu@163.176.103.191 "sudo -u postgres psql -Atd govhealth -c \
  \"SELECT relname||' '||n_live_tup FROM pg_stat_user_tables ORDER BY relname;\"" > antes.txt

# 3. dump final
ssh ubuntu@163.176.103.191 "sudo -u postgres pg_dump -Fc -d govhealth -f /tmp/final.dump"
scp ubuntu@163.176.103.191:/tmp/final.dump .

# 4. restaura na nova
pg_restore -U govhealth -d govhealth -j 2 --no-owner --no-privileges final.dump

# 5. a MESMA contagem no destino, e o diff
psql -U govhealth -Atd govhealth -c \
  "SELECT relname||' '||n_live_tup FROM pg_stat_user_tables ORDER BY relname;" > depois.txt
diff antes.txt depois.txt && echo "IGUAIS"
```

> `n_live_tup` é estimativa do coletor de estatísticas. Rode `ANALYZE` nos dois lados
> antes de comparar, ou troque por `count(*)` nas seis maiores tabelas se quiser prova
> exata — com 1,4GB isso leva segundos.

**Confira as sequences.** É a falha silenciosa clássica: o `pg_dump` traz o `setval`,
mas se algo restaurar fora de ordem a sequence fica atrás do `max(id)` e o erro só
aparece semanas depois, como chave duplicada em produção:

```sql
SELECT schemaname, sequencename, last_value FROM pg_sequences ORDER BY 2;
```

## 7. Virar o ponteiro

O `DATABASE_URL` vive em três lugares — os três precisam mudar:

1. **Vercel** (Production e Preview) → e **redeploy**, porque o valor é lido no runtime
   das funções, mas um deploy garante que nada em cache ficou apontando para o antigo.
2. **`.env.local` desta máquina** — é dele que todo o ETL e os workers leem.
3. Qualquer `.env` na própria VPS (o `browser-service` do Radar, se já estiver de pé).

Mantenha o formato atual: porta **6432** (PgBouncer, não o Postgres direto) e os
parâmetros de TLS que a URL já carrega. O PgBouncer novo precisa nascer com
`client_tls_sslmode = require` e um par cert/chave — se gerar um certificado novo, a
string de conexão tem de continuar compatível com o modo de verificação que ela usa.

## 8. Rollback

**Não desligue a VM antiga.** Deixe o Postgres dela no ar por uma semana. Se algo der
errado, voltar é editar o `DATABASE_URL` de volta — desde que nada tenha escrito na
nova. Por isso a ordem importa: só reative as tarefas agendadas **depois** de conferir
as contagens.

Para eliminar a dúvida, deixe a antiga somente-leitura durante o período de observação:

```sql
ALTER DATABASE govhealth SET default_transaction_read_only = on;
```

## 9. Depois

- Recriar o **backup diário** na VPS nova. Ele existe hoje (03:15, 7 dias) e é fácil
  esquecer no destino — um banco sem backup é a dívida mais cara desta lista.
- `ANALYZE` geral, para o planner não trabalhar com estatísticas vazias.
- Conferir o índice que falta em `contratacoes.data_publicacao` — é um bom momento,
  já que a tabela vai ser reescrita de qualquer jeito.
- Só então reative as tarefas:
  `Get-ScheduledTask | Where-Object { $_.TaskName -like 'GovHealth*' } | Enable-ScheduledTask`

## 10. Uma oportunidade junto

A VM atual tem **954MB de RAM e 324MB livres** — foi ela que reprovou para hospedar o
navegador do Radar (ver `radar-navegador-hospedado.md`). Uma VPS de **4GB** acomoda os
dois com folga: o Postgres deste banco e o steel, que consome **565MB** medidos com uma
sessão aberta. Mover o banco e subir o Radar podem ser a mesma compra, em vez de duas.

## 11. Levar a aplicação junto (Docker) — `deploy/app/`

As seções acima movem só o banco, com a aplicação seguindo na Vercel. Se a VPS nova
for hospedar **as duas coisas**, é aqui.

```bash
# segredos vêm do ambiente do shell, não de um .env nesta pasta — ver o
# cabeçalho de deploy/app/docker-compose.yml e deploy/app/.env.exemplo
source ~/govhealth-secrets.env
cd deploy/app
docker compose up -d db                              # 1. só o banco
DUMP_DIR=/caminho/do/dump docker compose --profile restore run --rm restore
docker compose build app worker                      # 3. constrói
docker compose up -d --wait --wait-timeout 120 app worker   # 4. sobe
```

Três coisas que este arranjo resolve porque foram encontradas construindo de verdade,
não previstas:

- **O volume do Postgres 18 mudou de lugar.** É `pgdata:/var/lib/postgresql`, **não**
  `/var/lib/postgresql/data`. Com o caminho antigo o container sobe, escreve na pasta
  errada e morre no healthcheck cuspindo um aviso de 30 linhas que nunca diz "corrija
  o volume". Foi exatamente o que o ensaio pegou.
- **O `.dockerignore` da raiz é do OUTRO serviço.** Ele exclui `src`, `public`, `db` e
  `scripts/*.mjs` porque foi escrito para a imagem do navegador do Radar; com ele
  valendo, o build da aplicação falha em "src not found". Por isso existe
  `deploy/app/Dockerfile.dockerignore` — o BuildKit procura `<Dockerfile>.dockerignore`
  antes do da raiz, e é assim que as duas imagens convivem no mesmo repositório.
- **`output: 'standalone'`** no `next.config.js`. Sem isso a imagem carrega o
  `node_modules` inteiro (~1,4 GB); com isso fica em ~250 MB. A Vercel ignora a opção,
  então ligar não muda nada no deploy atual.

### O ensaio, medido (16/09/2026)

Rodado de ponta a ponta contra o dump real de produção, com a origem **no ar e
escrevendo** — de propósito, para ver o que isso custa.

| | |
|---|---|
| dump | 159 MB, 201 entradas, 32 tabelas com dados, sha256 idêntico dos dois lados |
| `pg_restore -j 2` | **17 min 48 s** (Docker Desktop no Windows; numa VPS Linux tende a ser menos) |
| índices | **93** na origem, 93 no destino |
| sequences | todas à frente do `max(id)` |
| contagem | **27 das 32 tabelas idênticas** |

As 5 que diferem são `itens`, `resultados`, `radar_mensagens`, `radar_auditoria` e
`radar_notificacoes` — e a diferença é inteira de linhas escritas DEPOIS do dump, não
de perda. A prova: a linha mais recente no destino é de `12:16:27`, o dump começou
`12:18`, e a origem tem 134 linhas em `radar_mensagens` com `capturado_em` posterior a
isso. É a seção 5 deste documento em números: sem desligar quem escreve, o que entra
durante a janela fica para trás.

### O que quebra ao sair da Vercel — e não avisa

**Os 5 crons do `vercel.json` param.** `sync-pncp` 03:00, `sync-emendas` 04:00,
`sync-transferegov` 06:00, `alertas-email` 11:00, `trial-reminders` 12:00. Eles são
agendamento **da Vercel**, não do Next: subir a app em Docker não os traz junto, e o
sintoma é silencioso — a base simplesmente para de atualizar e ninguém recebe alerta.

Na VPS, 4 deles (`sync-pncp`, `sync-emendas`, `alertas-email`, `trial-reminders`)
**não** viram cron do sistema batendo em rota HTTP — viram o serviço `worker` do
compose, rodando pg-boss (`src/worker/index.ts`; lógica em `src/jobs/*.ts`). O
agendamento fica persistido no próprio banco (schema `pgboss`), então subir o
worker já é suficiente, sem crontab nem `CRON_SECRET` externo:

```bash
docker compose up -d --build app worker
```

Suba o `worker` só DEPOIS de desativar os crons na Vercel — os dois ativos ao
mesmo tempo rodam a mesma janela em duplicidade. As rotas em
`src/app/api/cron/*` continuam existindo, mas agora só para disparo manual/debug
(`curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/sync-pncp`).

O quinto, `sync-transferegov`, ficou de fora dessa migração: a rota nunca existiu
no código — o `vercel.json` aponta para um path que sempre respondeu 404 na
Vercel, então não havia lógica real para portar. Decidir se vale construir essa
ingestão (e o que ela grava) é trabalho separado, não parte deste roteiro.

Outros quatro pontos que mudam de mãos junto:

- **TLS público.** O compose publica a app em `127.0.0.1:3000`, de propósito. Quem
  termina HTTPS é o nginx da VPS — o mesmo que já atende o Radar
  (`deploy/radar/nginx/`).
- **SSL do Postgres (interno, não confundir com o TLS público acima).** Neon exige
  SSL; o Postgres do compose (host `db`) não tem TLS e não precisa — a conexão
  nunca sai da rede interna do compose. `src/lib/db.ts` decide isso sozinho pelo
  host da `DATABASE_URL`, então não há nada a configurar aqui — mas se algum
  código novo abrir uma conexão própria ao banco (em vez de usar `@/lib/db`),
  replique essa lógica, ou vai herdar o mesmo problema.
- **`NEXTAUTH_SECRET`.** Se mudar de valor, toda sessão viva cai. Para a migração ser
  invisível ao cliente, traga o valor que está em produção hoje.
- **`RADAR_CRED_KEY`.** Tem de ser o MESMO. Ela decifra a sessão gov.br já guardada de
  cada cliente; com chave nova o cofre vira lixo ilegível e todo mundo precisa
  reconectar o portal.

### Env de BUILD × env de runtime

Tudo que é `NEXT_PUBLIC_*` e a `RADAR_EMBED_ORIGIN` são gravados no bundle durante o
build. Editar no `.env` depois **não muda nada** — é preciso `--build` de novo. O
`DATABASE_URL` é o contrário: só runtime, e o compose o monta a partir de
`POSTGRES_USER/PASSWORD/DB` apontando para o serviço `db`. Isso é deliberado: um
`.env.local` copiado da máquina de desenvolvimento apontaria para o banco ANTIGO, e a
app subiria bonita gravando no lugar errado.

### O dump não pode encostar no repositório

São 159 MB com dado pessoal de todos os clientes e o cofre cifrado do Radar dentro. Por
isso o caminho é parâmetro (`DUMP_DIR`) em vez de uma pasta versionada, e `*.dump` +
`deploy/app/dump/` entraram no `.gitignore`. Este repositório é público.
