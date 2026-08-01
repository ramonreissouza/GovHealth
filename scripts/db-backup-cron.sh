#!/usr/bin/env bash
# db-backup-cron.sh — backup diário do Postgres self-hosted (VM Oracle).
# Roda NA VM (não no Windows). Faz pg_dump -Fc com rotação de 7 dias.
#
# Instalação na VM:
#   sudo mkdir -p /var/backups/pg && sudo chown postgres:postgres /var/backups/pg
#   sudo cp db-backup-cron.sh /usr/local/bin/pg-backup && sudo chmod +x /usr/local/bin/pg-backup
#   # cron do usuário postgres, todo dia às 03:15:
#   sudo crontab -u postgres -e
#     15 3 * * * /usr/local/bin/pg-backup >> /var/backups/pg/backup.log 2>&1
#
# Restaurar um backup:
#   pg_restore --clean --if-exists --no-owner --no-acl -d govhealth /var/backups/pg/govhealth-YYYYMMDD-HHMM.dump

set -euo pipefail

DB="${PGDATABASE:-govhealth}"     # ajuste se o nome do banco for outro
DEST="/var/backups/pg"
KEEP=7                            # nº de backups diários a manter
STAMP="$(date +%Y%m%d-%H%M)"
FILE="${DEST}/${DB}-${STAMP}.dump"

mkdir -p "$DEST"

echo "[$(date -Is)] dump -> ${FILE}"
# -Fc = formato custom (comprimido, restaurável seletivamente).
pg_dump -Fc "$DB" -f "$FILE"

# rotação: mantém só os KEEP mais recentes
ls -1t "${DEST}/${DB}-"*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  echo "[$(date -Is)] removendo antigo ${old}"
  rm -f "$old"
done

echo "[$(date -Is)] ok — $(du -h "$FILE" | cut -f1)"

# (Opcional) enviar para Oracle Object Storage (10 GB free):
#   oci os object put -bn govhealth-backups --file "$FILE" --name "$(basename "$FILE")" --force
