# Minerações no k3s da VPS

As minerações rodavam no Agendador do Windows do notebook. No k3s, cada uma é uma
CronJob do chart (`deploy/helm/govhealth/templates/mineracao.yaml`), com a agenda em
`mineracao.jobs` do `values.yaml`, em horário de Brasília. Todas gravam no banco do
namespace (`db:5432`, pelo `DATABASE_URL` do Secret `govhealth-secrets`).

| Tarefa | CronJob | Quando | Teto |
|---|---|---|---|
| ETL Refresh | `mineracao-etl-refresh` | a cada 3 dias, 22:00 | 18 h |
| Refresh 2 Dias | `mineracao-etl-refresh-2dias` | a cada 2 dias, 00:00 | 8 h |
| Sync Cobertura | `mineracao-sync-cobertura` | 07:00, 13:00 e 20:00 | 2 h |
| Backfill Itens 1mi | `mineracao-backfill-itens` | 06:00 | 12 h |
| Pipeline Noite | `mineracao-pipeline-noite` | 01:00 | 20 h |
| CAPAG | `mineracao-capag` | sábado, 23:30 | 1 h |
| Pagômetro (nova, sem tarefa no Windows) | `mineracao-pagometro` | domingo, 20:00 | 12 h |
| Radar Sync | `mineracao-radar` | a cada 2 h, das 07:00 às 21:00 | 3 h |
| Radar Urgente | `mineracao-radar-urgente` | a cada 20 min | 19 min |

**Ficou de fora: Licitações-e** (`scripts/licite`). Esse coletor resolve o CAPTCHA do
portal por OCR, e isso não roda num servidor automatizado.

## Por que saiu do Windows

- **O agendador matava as passadas longas.** O Windows encerrava a tarefa no limite de
  tempo (`3221225786`). Aqui o teto é o `activeDeadlineSeconds`, com o mesmo valor, e
  o pod recebe SIGTERM para soltar a trava do PNCP antes de sair.
- **O PC não precisa ficar ligado,** nem fora de suspensão.
- **O IP é brasileiro.** Pelo IP de datacenter da VPN, o Licitanet respondia 403.

## A pista do PNCP entre pods

O PNCP derruba quem o consulta em paralelo, por isso as tarefas dele se revezam por
uma trava de arquivo (`scripts/pncp-lock.mjs` e `scripts/pncp-prioridade.mjs`). No
k3s, cada execução é um pod, e isso exigiu três ajustes:

- **Uma pasta comum.** A trava mora no PVC `mineracao-pista`, montado em `/pista` em
  todos os pods (`PNCP_PISTA_DIR`).
- **O dono é PID + nome do pod.** O PID sozinho se repete entre pods.
- **Um pod não enxerga os processos de outro,** então um dono de outro pod prova que
  está vivo pela batida periódica. Na trava, a batida vem a cada 5 min, e 30 min de
  silêncio a descartam. Na fila de espera, vem a cada 20 s, e 2 min de silêncio a
  descartam.

Os casos estão em `scripts/pncp-pista-pods.teste.mjs`.

## Ligar, na ordem

1. **Banco restaurado e conferido.** As CronJobs gravam no `db` do namespace.

2. **Imagem de mineração importada,** com a mesma tag das outras duas (ver
   `deploy/helm/README.md`, "As imagens"):

   ```bash
   docker build -f deploy/app/Dockerfile --target mineracao -t govhealth.local/mineracao:$SHA .
   docker save govhealth.local/mineracao:$SHA | sudo k3s ctr images import -
   ```

3. **Tarefas do Windows desativadas,** menos `GovHealth Licitacoes-e`. As travas são
   locais: o PC e o k3s rodando juntos disputam o PNCP.

4. **Ligar no chart.** Troque `mineracao.enabled` para `true` no `values.yaml` e deixe
   o deploy do Jenkins aplicar, ou, na VPS:

   ```bash
   helm upgrade govhealth deploy/helm/govhealth -n govhealth --reuse-values --set mineracao.enabled=true --set image.tag=$SHA
   ```

   `mineracao.enabled` e `image.tag` não são segredo, então podem ir por `--set`.

5. **Conferir:**

   ```bash
   kubectl -n govhealth get cronjobs
   ```

   A lista deve ter as 8 `mineracao-*`, com `SUSPEND False`.

## No dia a dia

Ver as execuções e os logs da última:

```bash
kubectl -n govhealth get jobs -l app=mineracao --sort-by=.metadata.creationTimestamp
```

```bash
kubectl -n govhealth logs -l job=sync-cobertura --tail=200
```

Rodar uma tarefa agora, fora da agenda:

```bash
kubectl -n govhealth create job --from=cronjob/mineracao-sync-cobertura manual-cobertura-$(date +%s)
```

Pausar uma tarefa só, sem desligar as outras:

```bash
kubectl -n govhealth patch cronjob mineracao-backfill-itens -p '{"spec":{"suspend":true}}'
```

O próximo `helm upgrade` desfaz o patch. Para a pausa ficar, ponha `suspenso: true`
na tarefa, em `mineracao.jobs` do `values.yaml`.

## Backup do banco

A CronJob `backup-banco` (`templates/backup.yaml`) roda às 03:15, como o cron que existia
na VM Oracle. Ela grava um `pg_dump -Fc` no PVC `backup-banco`, confere que o arquivo
abre com `pg_restore --list` e apaga as cópias com mais de `backup.manterDias` (7).

Ligar junto com a mineração, no `helm upgrade`:

```bash
helm upgrade govhealth deploy/helm/govhealth -n govhealth --reuse-values --set backup.enabled=true
```

Para conferir o último backup:

```bash
kubectl -n govhealth logs -l app=backup --tail=20
```

O dump fica no mesmo disco da VPS. Ele cobre erro humano e banco corrompido, mas não a
perda da máquina. Copiar para fora (outro servidor, ou um bucket) é o próximo passo.

## Voltar para o Windows

1. Ponha `mineracao.enabled=false` e rode o `helm upgrade`: as CronJobs somem.
2. No Agendador do Windows, reative as tarefas `GovHealth *`.
