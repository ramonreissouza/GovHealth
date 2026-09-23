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
for i in app worker; do docker save govhealth.local/$i:$SHA | sudo k3s ctr images import -; done
```

O prefixo `govhealth.local` não resolve de propósito. Se a imagem importada
sumir, o pod falha com `ErrImagePull`, em vez de baixar do Docker Hub uma
imagem de mesmo nome publicada por qualquer pessoa.

As variáveis `NEXT_PUBLIC_*` e `RADAR_EMBED_ORIGIN` entram no build. Mudar uma
delas exige uma imagem nova, não só um restart.

## O worker

`worker.enabled` é booleano e o Deployment usa `strategy: Recreate`. Nunca
suba duas réplicas: o pg-boss agenda os jobs no boot, e dois workers rodariam
cada job duas vezes.

## Migrations

O chart não roda migration. Hoje o schema muda por scripts avulsos
(`npm run *:migrate`), sem um executor único que um hook do Helm possa
chamar. Enquanto for assim, uma mudança de schema é aplicada à mão antes do
deploy, com `kubectl -n govhealth exec -it db-0 -- psql ...` ou rodando o
script com `DATABASE_URL` apontado para um `kubectl port-forward`. O deploy
automático pelo Jenkins depende de resolver isso primeiro.

## Acesso ao banco

O compose publicava `127.0.0.1:5432` para túnel SSH. No k3s, o equivalente é:

```bash
kubectl -n govhealth port-forward svc/db 5432:5432
```

Rodado na VPS, e com o túnel SSH de sempre por cima.
