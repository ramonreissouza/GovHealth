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
