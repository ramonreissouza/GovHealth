# Runbook — Migração Neon → Oracle Cloud (VM Free + Postgres self-hosted)

> Objetivo: sair do Neon (teto de 500 MB atingido) para um **PostgreSQL 18 self-hosted** numa
> **VM Always Free do Oracle Cloud (Ampere A1, ARM)**, **sem quebrar nada** e com **rollback
> imediato para o Neon** a qualquer momento.
>
> **Garantia:** o Neon **não é tocado** em nenhuma etapa. Rollback = trocar `DATABASE_URL` de volta.

Preencha estes valores conforme avança:

| Variável | Valor |
|---|---|
| IP público da VM | `__________` |
| Senha do Postgres (role `govhealth`) | `__________` (forte, guarde no gerenciador) |
| `DATABASE_URL` novo (Oracle) | `postgresql://govhealth:SENHA@IP:6432/govhealth?sslmode=require` |
| `DATABASE_URL` antigo (Neon) | *(copie do `.env.local` atual — para o rollback)* |

⚠️ Se a senha tiver caracteres especiais (`@ : / ? # &`), **URL-encode** ao montar a connection string.

---

## Fase A — Provisionar a VM (console Oracle Cloud)

1. Login em <https://cloud.oracle.com>. Região: **Brazil East (São Paulo)** — as funções da
   Vercel já rodam em `gru1`/São Paulo (`vercel.json`), então o banco fica co-localizado (<5ms).
2. **Compute → Instances → Create instance**:
   - Image: **Ubuntu 24.04 (Canonical, aarch64)**.
   - Shape: **VM.Standard.A1.Flex** (Ampere ARM), **2 OCPU / 12 GB** — dentro do *Always Free*.
   - Boot volume: ~**100 GB** (o Always Free dá até ~200 GB de block storage no total).
   - **Adicione sua chave SSH pública** (guarde a privada).
   > ⚠️ Se aparecer *"Out of host capacity"* no Ampere A1: troque a Availability Domain, tente
   > outra região, ou repita mais tarde (é comum). **Não** use o micro AMD (1 GB de RAM é pouco).
3. **Networking → VCN → Security List** da subnet: adicione **Ingress Rule**:
   - Source `0.0.0.0/0`, IP Protocol **TCP**, Destination Port **6432** (PgBouncer).
   - (A porta 22/SSH já vem liberada. **Não** libere a 5432 — o Postgres fica só em localhost.)
4. Anote o **IP público** na tabela acima.

---

## Fase B — Instalar e configurar (via SSH)

> Dica: no Claude Code, você pode rodar cada comando pela sua máquina com `! ssh ubuntu@IP "..."`,
> ou simplesmente abrir um terminal e colar. Abaixo assume-se que você está logado na VM.

```bash
ssh ubuntu@IP        # IP público da VM
```

### B1. Firewall do SO (liberar 6432)
As imagens Ubuntu da Oracle vêm com iptables restritivo. Libere a 6432 e persista:
```bash
sudo apt-get update
sudo apt-get install -y netfilter-persistent iptables-persistent
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 6432 -j ACCEPT
sudo netfilter-persistent save
```

### B2. Instalar PostgreSQL 18 (repositório oficial PGDG)
```bash
sudo apt-get install -y curl ca-certificates
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
sudo sh -c 'echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
  https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list'
sudo apt-get update
sudo apt-get install -y postgresql-18 postgresql-client-18
```

### B3. Tuning do Postgres (12 GB de RAM) + escutar só localhost
Edite `/etc/postgresql/18/main/postgresql.conf` (`sudo nano ...`) e ajuste:
```conf
listen_addresses = 'localhost'
max_connections = 100
shared_buffers = 3GB
effective_cache_size = 8GB
maintenance_work_mem = 512MB
work_mem = 32MB
wal_compression = on
```

### B4. Criar role + banco
```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE govhealth WITH LOGIN PASSWORD 'TROQUE_POR_SENHA_FORTE';
CREATE DATABASE govhealth OWNER govhealth;
SQL
```
`pg_hba.conf` (`/etc/postgresql/18/main/pg_hba.conf`) — garanta a linha para o PgBouncer local:
```conf
host    govhealth    govhealth    127.0.0.1/32    scram-sha-256
```
Reinicie: `sudo systemctl restart postgresql`.

### B5. Certificado self-signed (TLS do PgBouncer)
O app usa `ssl:{ rejectUnauthorized:false }`, então um cert self-signed é aceito sem mudar código.
```bash
sudo openssl req -new -x509 -days 3650 -nodes -text \
  -out /etc/pgbouncer/server.crt -keyout /etc/pgbouncer/server.key -subj "/CN=govhealth-db"
sudo chown postgres:postgres /etc/pgbouncer/server.key /etc/pgbouncer/server.crt
sudo chmod 600 /etc/pgbouncer/server.key
```

### B6. PgBouncer (pooler — replica o que o Neon fazia)
```bash
sudo apt-get install -y pgbouncer
```
Extraia o verificador SCRAM da senha (para o `userlist.txt`):
```bash
sudo -u postgres psql -Atc "SELECT '\"govhealth\" \"' || rolpassword || '\"' \
  FROM pg_authid WHERE rolname='govhealth';" | sudo tee /etc/pgbouncer/userlist.txt
```
Edite `/etc/pgbouncer/pgbouncer.ini`:
```ini
[databases]
govhealth = host=127.0.0.1 port=5432 dbname=govhealth

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 500
default_pool_size = 20
; backend é localhost → sem TLS interno; TLS só voltado ao cliente (Vercel):
server_tls_sslmode = disable
client_tls_sslmode = require
client_tls_key_file = /etc/pgbouncer/server.key
client_tls_cert_file = /etc/pgbouncer/server.crt
```
```bash
sudo systemctl enable --now pgbouncer
sudo systemctl restart pgbouncer
```
**Teste local** (dentro da VM):
```bash
psql "postgresql://govhealth:SENHA@127.0.0.1:6432/govhealth?sslmode=require" -c "select 1;"
```

---

## Fase C — Migrar os dados (freeze → dump → restore → verificar)

### C1. Congelar escritas (janela curta — garante rollback 1:1)
- **Vercel:** desative temporariamente os crons `sync-pncp` e `sync-emendas` (comente em
  `vercel.json` e faça um deploy, ou desative no dashboard).
- **Windows (Task Scheduler):** desative a task **"GovHealth ETL Refresh"**.
- Pare os **workers do radar** (Playwright locais), se estiverem rodando.

Com isso, **nenhuma escrita nova entra no Neon** durante a migração.

### C2. Dump do Neon → restore no Oracle (rodar NA VM)
`pg_dump` é **read-only**: funciona mesmo com o Neon no teto de storage.
```bash
# na VM:
export NEON_URL='postgresql://...neon...'   # copie do seu .env.local atual
export LOCAL_URL='postgresql://govhealth:SENHA@127.0.0.1:5432/govhealth'

pg_dump -Fc --no-owner --no-acl "$NEON_URL" -f neon.dump      # ~489 MB, rápido
pg_restore --no-owner --no-acl -d "$LOCAL_URL" neon.dump
```
> As colunas `GENERATED ... STORED` (regex de `db/schema.sql`) são recriadas nativamente —
> é Postgres real → Postgres real, sem ajuste.

### C3. Provar paridade ANTES de virar (na sua máquina)
No `.env.local`, adicione temporariamente (o `.env.local` é gitignored):
```
DATABASE_URL_NEON=<url atual do Neon>
DATABASE_URL_ORACLE=postgresql://govhealth:SENHA@IP:6432/govhealth?sslmode=require
```
Rode:
```bash
node scripts/db-verify-parity.mjs
```
Só prossiga com **✅ PASS** (linhas idênticas em todas as tabelas + checksums das 3 grandes).

---

## Fase D — Cutover

### D1. Salvar o Neon como backup de rollback
No `.env.local`, **antes** de trocar, guarde o valor atual:
```
DATABASE_URL_NEON=<url atual do Neon>       # NÃO apague — é o rollback
```
Na Vercel, adicione a mesma como referência:
```bash
vercel env add DATABASE_URL_NEON production   # cole o URL do Neon
```

### D2. Apontar para o Oracle
```bash
# .env.local (scripts/ETL/radar):
#   DATABASE_URL=postgresql://govhealth:SENHA@IP:6432/govhealth?sslmode=require

# Vercel (produção):
vercel env rm DATABASE_URL production
vercel env add DATABASE_URL production        # cole o URL do Oracle
vercel --prod                                 # redeploy
```

### D3. Smoke test em produção (`gov-health.vercel.app`)
- Login + dashboard carregam.
- Rotas: `/api/opportunities`, `/api/mapa`, `/api/resultados/vencedores` respondem.
- Faça **1 escrita de teste** (ex.: salvar algo em `user_data` pela UI) e confirme que persiste.

### D4. Religar as escritas (agora no Oracle)
- Reative os crons Vercel e a task **"GovHealth ETL Refresh"**.
- Rode uma fatia de ETL e confirme que grava no Oracle:
  ```bash
  npm run etl
  ```

---

## Fase E — Hardening de DBA (o banco agora é seu)

1. **Backup diário** na VM (script já no repo: `scripts/db-backup-cron.sh`):
   ```bash
   scp scripts/db-backup-cron.sh ubuntu@IP:/tmp/
   ssh ubuntu@IP
   sudo mkdir -p /var/backups/pg && sudo chown postgres:postgres /var/backups/pg
   sudo cp /tmp/db-backup-cron.sh /usr/local/bin/pg-backup && sudo chmod +x /usr/local/bin/pg-backup
   sudo crontab -u postgres -e
   #   15 3 * * * /usr/local/bin/pg-backup >> /var/backups/pg/backup.log 2>&1
   ```
2. Patches automáticos: `sudo apt-get install -y unattended-upgrades`.
3. Monitorar disco: `df -h` (alerte bem antes dos ~200 GB). Autovacuum já vem ligado.
4. SSH só por chave (desative senha em `/etc/ssh/sshd_config`); opcional `fail2ban`.

---

## 🔙 ROLLBACK — voltar ao Neon (estado de hoje)

**Quando:** qualquer quebra após o cutover.
**Garantia:** o Neon nunca foi alterado; volta idêntico ao estado atual (leituras ok; storage
ainda no teto, ETL bloqueado — exatamente como hoje).

**Passos (~2 min):**
```bash
# .env.local: DATABASE_URL = <valor de DATABASE_URL_NEON>

# Vercel:
vercel env rm DATABASE_URL production
vercel env add DATABASE_URL production     # cole o URL do Neon (o de DATABASE_URL_NEON)
vercel --prod
```
Reative/pause os crons conforme necessário. Pronto — de volta ao Neon.

**Caveat:** escritas feitas no Oracle *depois* do cutover **não** existem no Neon. Como as
escritas foram congeladas na Fase C, um rollback **logo após** o cutover é 1:1. Se você já
tiver rodado ETL no Oracle, esse delta se perde no rollback — mas é re-executável (`npm run etl`).

**Quando aposentar o Neon:** depois de alguns dias estável no Oracle (com backups rodando),
pode manter o Neon como está (não custa nada no Free) ou apagar o projeto. Enquanto o
`DATABASE_URL_NEON` existir e o projeto Neon estiver de pé, o rollback continua disponível.
