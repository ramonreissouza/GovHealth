# Minerações na VPS

As minerações (ETL do PNCP, cobertura, backfill de itens, pipeline da noite, CAPAG e
Radar de Chat) saíram do Agendador do Windows e passaram a rodar no serviço `mineracao`
do `deploy/app/docker-compose.yml`. A agenda está em `scripts/vps/mineracao.crontab`,
com horários de Brasília, e o agendador é o supercronic, dentro do contêiner.

Elas gravam no Postgres **da própria VPS** (serviço `db`), não na VM Oracle.

## Por que saiu do Windows

- **O agendador matava as passadas longas.** O Windows encerrava a tarefa no limite de
  tempo (`3221225786`). Aqui o teto é o `timeout` de cada linha, com o mesmo valor, e o
  script recebe SIGTERM para soltar a trava do PNCP antes de sair.
- **O PC não precisa ficar ligado,** nem fora de suspensão (o antigo `keep-awake`).
- **O IP é brasileiro.** Pelo IP de datacenter da VPN, o Licitanet respondia 403.

## Ligar, na ordem

Tudo na VPS (`ssh vps`), a partir de `~/govhealth`.

1. **Banco no ar e com dados.** O `mineracao` grava no `db`, então ele precisa estar
   restaurado primeiro (passos 1 e 2 do cabeçalho do `docker-compose.yml`):

   ```bash
   source ~/govhealth-secrets.env && cd ~/govhealth/deploy/app
   docker compose ps db
   docker compose --profile restore run --rm restore
   ```

2. **Desligar as tarefas do Windows.** No PC, desative as tarefas `GovHealth *`, menos
   `GovHealth Licitacoes-e`, que não foi para a VPS. As travas da pista do PNCP são
   arquivos locais, e cada máquina só enxerga as suas: as duas pontas rodando juntas
   disputam o PNCP, que derruba quem sonda em rajada.

3. **Construir e subir:**

   ```bash
   cd ~/govhealth && git pull && source ~/govhealth-secrets.env && cd deploy/app
   docker compose --profile mineracao build mineracao
   docker compose --profile mineracao up -d mineracao
   ```

4. **Acompanhar:**

   ```bash
   docker compose logs -f --since 1h mineracao
   ```

   Ao subir, o supercronic lista cada linha do crontab que leu. Depois, cada execução
   aparece com o nome do job, a saída do script e o código de saída.

## Rodar um job na hora

```bash
docker compose exec mineracao node scripts/sync-cobertura.mjs
```

O supercronic não impede essa execução manual. Se o mesmo job estiver rodando pela
agenda, a trava da pista do PNCP decide quem segue.

## O que ficou de fora

- **Licitações-e** (`scripts/licite`): o coletor resolve o CAPTCHA do portal por OCR, e
  isso não roda num servidor automatizado.
- **Backups do `limpar-ruido --aplicar`**: o `.limpeza-ruido-*.json` fica no contêiner
  e some quando ele é recriado. Se precisar dele, copie antes com
  `docker compose cp mineracao:/app/<arquivo> .`.
