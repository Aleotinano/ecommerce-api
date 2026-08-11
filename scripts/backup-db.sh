#!/usr/bin/env bash
# Backup de Postgres del deploy de producción. Ver docs/DEPLOY.md.
#
# Corre en el HOST (no adentro de un contenedor): habla con el servicio `postgres`
# vía `docker compose exec`. Pensado para cron:
#
#   0 3 * * * /home/ubuntu/e-commerce-express/scripts/backup-db.sh >> /home/ubuntu/backup.log 2>&1
#
# KEEP_DAYS controla la retención (14 por defecto).

set -euo pipefail

cd "$(dirname "$0")/.."

# El .env del server trae POSTGRES_USER / POSTGRES_DB. `set -a` exporta todo lo
# que se defina mientras esté activo, que es lo que necesita el `docker compose`
# de más abajo para interpolar.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

KEEP_DAYS="${KEEP_DAYS:-14}"
DEST="${BACKUP_DIR:-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${DEST}/ecommerce-${STAMP}.sql.gz"

mkdir -p "$DEST"

# -T: sin TTY (cron no tiene una). El gzip corre en el host, así que el archivo
# queda acá aunque el contenedor no monte ningún volumen de backups.
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-ecommerce}" -d "${POSTGRES_DB:-ecommerce}" \
  | gzip >"$OUT"

# `set -o pipefail` ya hace fallar el pipe de arriba si pg_dump muere, pero un
# dump que sale "bien" y vacío es el modo de falla que de verdad duele: pisa la
# rotación con basura y nadie se entera hasta el día que hay que restaurar.
if [ ! -s "$OUT" ] || ! gzip -t "$OUT" 2>/dev/null; then
  echo "[backup] dump inválido o vacío, se descarta: $OUT" >&2
  rm -f "$OUT"
  exit 1
fi

# La rotación va DESPUÉS de validar: si el dump de hoy falló, no queremos haber
# borrado ya el más viejo que todavía sirve.
find "$DEST" -name 'ecommerce-*.sql.gz' -mtime "+${KEEP_DAYS}" -delete

echo "[backup] ok: $OUT ($(du -h "$OUT" | cut -f1))"
