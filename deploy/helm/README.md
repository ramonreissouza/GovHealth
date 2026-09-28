# Chart do GovHealth

O GovHealth roda no k3s da VPS que divide com o TecSupply, no namespace
`govhealth`. Este diretório tem só o que é da aplicação: banco, app, worker,
Ingress e NetworkPolicies. A plataforma (k3s, Traefik, quota, PriorityClass,
nginx do host) vive no repositório `infra` da TecHealth, e o passo a passo do
primeiro corte está lá, em `docs/14-govhealth-k3s.md`.

## Este repositório é público

Nenhum segredo entra no chart, nos values ou em `--set`. O Helm guarda cada
release num Secret do cluster, e um valor passado por `--set` vira histórico
legível para sempre. Tudo o que é segredo mora no Secret `govhealth-secrets`,
criado fora do chart.

## O Secret

Cada chave do Secret vira variável de ambiente de app e worker, pelo
`envFrom`. Os nomes são os de `deploy/app/.env.exemplo`, mais:

- `POSTGRES_PASSWORD`, que o banco lê
- `DATABASE_URL`, apontando para `db:5432`, o mesmo nome de serviço do compose

## As imagens

Não há registry. As duas imagens são buildadas a partir do
`deploy/app/Dockerfile` (alvos `runner` e `worker`) e importadas direto no
containerd do k3s:

```bash
docker build -f deploy/app/Dockerfile --target runner -t govhealth.local/app:$SHA \
  --build-arg NEXT_PUBLIC_APP_URL=... .
docker build -f deploy/app/Dockerfile --target worker -t govhealth.local/worker:$SHA .
docker build -f deploy/app/Dockerfile --target mineracao -t govhealth.local/mineracao:$SHA .
for i in app worker mineracao; do docker save govhealth.local/$i:$SHA | sudo k3s ctr images import -; done
```

A de `mineracao` só é usada com `mineracao.enabled=true`, mas as três precisam
existir com a mesma tag. Sem a de mineração, as CronJobs sobem e cada execução
falha com `ErrImagePull`.

O prefixo `govhealth.local` não resolve de propósito. Se a imagem importada
sumir, o pod falha com `ErrImagePull`, em vez de baixar do Docker Hub uma
imagem de mesmo nome publicada por qualquer pessoa.

As variáveis `NEXT_PUBLIC_*` e `RADAR_EMBED_ORIGIN` entram no build. Mudar uma
delas exige uma imagem nova, não só um restart.

## O worker

`worker.enabled` é booleano e o Deployment usa `strategy: Recreate`. Nunca
suba duas réplicas: o pg-boss agenda os jobs no boot, e dois workers rodariam
cada job duas vezes.

## As minerações

O ETL do PNCP, a cobertura, o backfill de itens, o pipeline da noite, a CAPAG
e o Radar de Chat rodavam no Agendador do Windows. Aqui, cada tarefa é uma
CronJob (`templates/mineracao.yaml`), com a agenda em `mineracao.jobs` do
`values.yaml`, em horário de Brasília. O passo a passo para ligar está em
[`docs/vps-mineracao.md`](../../docs/vps-mineracao.md).

- **`concurrencyPolicy: Forbid`:** uma execução não começa enquanto a anterior
  da mesma tarefa roda.
- **`activeDeadlineSeconds`:** o teto de tempo que cada tarefa tinha no
  Windows. Ao estourar, o pod recebe SIGTERM e solta a trava do PNCP.
- **A pista do PNCP:** as tarefas do PNCP se revezam por uma trava de arquivo.
  Ela mora no PVC `mineracao-pista`, montado em todos os pods
  (`PNCP_PISTA_DIR=/pista`). Como o PID se repete entre pods, o dono é
  identificado por PID + nome do pod. Um dono de outro pod vale enquanto se
  anuncia (a cada 5 min; 30 min de silêncio o descartam).

A permissão do Jenkins no namespace precisa incluir `batch/cronjobs`. Se ela
não incluir, o `helm upgrade` com `mineracao.enabled=true` falha. Isso fica no
repositório `infra`.

## Migrations

O chart não roda migration: o schema muda por scripts avulsos
(`scripts/**/migrate-*.mjs`), sem um executor único que um hook do Helm possa
chamar. Quem aplica é o deploy do Jenkins, antes do `helm upgrade`: ele
descobre quais scripts mudaram desde o commit no ar, faz backup do banco e
os roda num pod do namespace. Se algum falha, o upgrade não acontece.

Como escrever uma migration que esse deploy aplica sem risco está em
[`docs/migrations.md`](../../docs/migrations.md). Não é mais preciso rodar
`npm run *:migrate` à mão antes do merge.

## Acesso ao banco

O compose publicava `127.0.0.1:5432` para túnel SSH. No k3s, o equivalente é:

```bash
kubectl -n govhealth port-forward svc/db 5432:5432
```

Rodado na VPS, e com o túnel SSH de sempre por cima.
