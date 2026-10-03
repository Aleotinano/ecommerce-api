#!/usr/bin/env bash
# Copia al repo de EditFlow los archivos de Cori que se reutilizan (ver REUTILIZACION.md).
#
#   ./copiar-desde-cori.sh <clon de ecommerce-api> <clon de e-commerce-nextjs> <repo editflow>
#
# Qué hace y qué no:
#  - Copia SOLO lo de las listas de abajo, a la ruta destino que corresponde.
#  - A cada archivo .ts/.tsx/.js le antepone una línea de procedencia con el commit de Cori,
#    para que dentro de seis meses se pueda comparar contra el original con un diff.
#  - Los archivos del BACKEND llegan a `apps/api/_from-cori/` y no a `src/`: son JavaScript y
#    hay que pasarlos a TypeScript y adaptarlos (tenantId -> agencyId, etc.). Es el primer
#    trabajo de la fase 1 (ver PROMPTS.md). Los del front ya son TS y van a su lugar final.
#  - No pisa nada: si el destino existe, lo saltea y lo avisa.
#  - Escribe COPIADOS_DE_CORI.md en la raíz de EditFlow con la lista y los commits de origen.
set -euo pipefail

if [ $# -ne 3 ]; then
  echo "uso: $0 <ecommerce-api> <e-commerce-nextjs> <editflow>" >&2
  exit 1
fi

API_SRC=$(cd "$1" && pwd)
WEB_SRC=$(cd "$2" && pwd)
DEST=$(mkdir -p "$3" && cd "$3" && pwd)

API_SHA=$(git -C "$API_SRC" rev-parse --short HEAD)
WEB_SHA=$(git -C "$WEB_SRC" rev-parse --short HEAD)

# ── Backend: origen (relativo a ecommerce-api) -> destino (relativo a EditFlow) ─────────
API_FILES=(
  "helpers/error.js                 apps/api/_from-cori/lib/errors.js"
  "helpers/password.js              apps/api/_from-cori/lib/password.js"
  "lib/tokens.js                    apps/api/_from-cori/lib/tokens.js"
  "lib/prisma.js                    apps/api/_from-cori/lib/prisma.js"
  "lib/logger.js                    apps/api/_from-cori/lib/logger.js"
  "lib/slug.js                      apps/api/_from-cori/lib/slug.js"
  "lib/phone.js                     apps/api/_from-cori/lib/phone.js"
  "lib/mailer.js                    apps/api/_from-cori/lib/mailer.js"
  "lib/redis.js                     apps/api/_from-cori/lib/redis.js"
  "lib/cache.js                     apps/api/_from-cori/lib/cache.js"
  "lib/crypto.js                    apps/api/_from-cori/lib/crypto.js"
  "helpers/origin.js                apps/api/_from-cori/lib/origin.js"
  "helpers/xlsx.js                  apps/api/_from-cori/lib/xlsx.js"
  "config.js                        apps/api/_from-cori/config/index.js"
  "schemas/env.schema.js            apps/api/_from-cori/config/env.js"
  "schemas/id.schema.js             apps/api/_from-cori/schemas/id.schema.js"
  "schemas/date.schema.js           apps/api/_from-cori/schemas/date.schema.js"
  "middleware/auth.js               apps/api/_from-cori/http/middleware/auth.js"
  "middleware/role.js               apps/api/_from-cori/http/middleware/require-role.js"
  "middleware/validate.js           apps/api/_from-cori/http/middleware/validate.js"
  "middleware/errorHandler.js       apps/api/_from-cori/http/middleware/error-handler.js"
  "middleware/cors.js               apps/api/_from-cori/http/middleware/cors.js"
  "middleware/proxyChain.js         apps/api/_from-cori/http/middleware/proxy-chain.js"
  "middleware/rateLimit.js          apps/api/_from-cori/http/middleware/rate-limit.js"
  "middleware/httpLogger.js         apps/api/_from-cori/http/middleware/http-logger.js"
  "app.js                           apps/api/_from-cori/app.js"
  "services/users.js                apps/api/_from-cori/modules/auth/users.service.js"
  "controllers/users.js             apps/api/_from-cori/modules/auth/users.controller.js"
  "routes/users.js                  apps/api/_from-cori/modules/auth/users.routes.js"
  "schemas/auth.schema.js           apps/api/_from-cori/modules/auth/auth.schema.js"
  "prisma/create-tenant.js          apps/api/_from-cori/prisma/create-agency.js"
  "services/order-state.js          apps/api/_from-cori/REFERENCIA/order-state.js"
  "services/order-status.js         apps/api/_from-cori/REFERENCIA/order-status.js"
  "services/promos.js               apps/api/_from-cori/REFERENCIA/promos.js"
  "tests/global-setup.js            apps/api/_from-cori/tests/global-setup.js"
  "tests/helpers.js                 apps/api/_from-cori/tests/helpers.js"
  "tests/isolation.test.js          apps/api/_from-cori/REFERENCIA/isolation.test.js"
  "vitest.config.js                 apps/api/_from-cori/vitest.config.js"
  "prisma.config.ts                 apps/api/prisma.config.ts"
  "Dockerfile                       apps/api/Dockerfile"
  "docker-compose.yml               docker-compose.yml"
  "docker-compose.prod.yml          docker-compose.prod.yml"
  "scripts/backup-db.sh             scripts/backup-db.sh"
  ".env.example                     apps/api/.env.example"
  "front-md-guia/COOKIE_PANEL_CROSS_SITE.md  docs/cori/COOKIE_PANEL_CROSS_SITE.md"
  "docs/DEPLOY.md                   docs/cori/DEPLOY.md"
)

# ── Front: origen (relativo a e-commerce-nextjs) -> destino. Misma ruta a propósito ──────
WEB_FILES=(
  "pnpm-workspace.yaml              pnpm-workspace.yaml"
  "tsconfig.base.json               tsconfig.base.json"
  "scripts/free-ports.mjs           scripts/free-ports.mjs"
  "apps/admin/package.json          apps/web/package.json"
  "apps/admin/tsconfig.json         apps/web/tsconfig.json"
  "apps/admin/next.config.ts        apps/web/next.config.ts"
  "apps/admin/postcss.config.mjs    apps/web/postcss.config.mjs"
  "apps/admin/proxy.ts              apps/web/proxy.ts"
  "apps/admin/app/globals.css       apps/web/app/globals.css"
  "apps/admin/app/layout.tsx        apps/web/app/layout.tsx"
  "apps/admin/app/providers.tsx     apps/web/app/providers.tsx"
  "apps/admin/app/error.tsx         apps/web/app/error.tsx"
  "apps/admin/app/loading.tsx       apps/web/app/loading.tsx"
  "apps/admin/app/not-found.tsx     apps/web/app/not-found.tsx"
  "apps/admin/lib/api.ts            apps/web/lib/api.ts"
  "apps/admin/lib/download.ts       apps/web/lib/download.ts"
  "apps/admin/lib/platform-brand.ts apps/web/lib/platform-brand.ts"
  "apps/admin/services/auth.service.ts  apps/web/services/auth.service.ts"
  "apps/admin/context/Auth.tsx      apps/web/context/Auth.tsx"
  "apps/admin/context/SidePanel.tsx apps/web/context/SidePanel.tsx"
  "apps/admin/context/PageMeta.tsx  apps/web/context/PageMeta.tsx"
  "apps/admin/context/HeaderSlot.tsx    apps/web/context/HeaderSlot.tsx"
  "apps/admin/context/FooterSlot.tsx    apps/web/context/FooterSlot.tsx"
  "apps/admin/context/UISettingsPanel.tsx  apps/web/context/UISettingsPanel.tsx"
  "apps/admin/hooks/useAuth.tsx     apps/web/hooks/useAuth.tsx"
  "apps/admin/hooks/useSidePanel.tsx    apps/web/hooks/useSidePanel.tsx"
  "apps/admin/hooks/useUISettingsPanel.tsx  apps/web/hooks/useUISettingsPanel.tsx"
  "apps/admin/hooks/useMediaQuery.ts    apps/web/hooks/useMediaQuery.ts"
  "apps/admin/hooks/usePersistedPreference.ts  apps/web/hooks/usePersistedPreference.ts"
  "apps/admin/hooks/useSidebarCollapsed.ts     apps/web/hooks/useSidebarCollapsed.ts"
  "apps/admin/hooks/useCollapsedNavSections.ts apps/web/hooks/useCollapsedNavSections.ts"
  "apps/admin/hooks/useHorizontalWheelScroll.ts apps/web/hooks/useHorizontalWheelScroll.ts"
  "packages/shared/lib/api-error.ts packages/shared/lib/api-error.ts"
  "packages/shared/lib/storage.ts   packages/shared/lib/storage.ts"
  "packages/shared/lib/format.ts    packages/shared/lib/format.ts"
  "packages/shared/lib/toast.ts     packages/shared/lib/toast.ts"
  "packages/shared/lib/query.ts     packages/shared/lib/query.ts"
  "packages/shared/lib/url.ts       packages/shared/lib/url.ts"
  "packages/shared/lib/phone.ts     packages/shared/lib/phone.ts"
  "packages/shared/lib/access-log.ts    packages/shared/lib/access-log.ts"
  "packages/shared/hooks/useRevalidateOnFocus.ts  packages/shared/hooks/useRevalidateOnFocus.ts"
  "packages/shared/components/auth/PasswordInput.tsx     packages/shared/components/auth/PasswordInput.tsx"
  "packages/shared/components/auth/PasswordStrength.tsx  packages/shared/components/auth/PasswordStrength.tsx"
  "packages/shared/components/theme/ThemeSwitcher.tsx   packages/shared/components/theme/ThemeSwitcher.tsx"
  "packages/shared/types/auth.ts    packages/shared/types/auth.ts"
  "packages/shared/types/dashboard/sideBar.ts  packages/shared/types/dashboard/sideBar.ts"
  "packages/shared/package.json     packages/shared/package.json"
  "packages/shared/tsconfig.json    packages/shared/tsconfig.json"
  "docs/PATRON_DE_MODULO.md         docs/cori/PATRON_DE_MODULO.md"
  "docs/design-tokens.md            docs/cori/design-tokens.md"
)

# Carpetas enteras del admin, con la misma ruta (ver ARQUITECTURA.md §7).
WEB_DIRS=(
  "apps/admin/app/(auth)                     apps/web/app/(auth)"
  "apps/admin/components/auth                apps/web/components/auth"
  "apps/admin/components/shared              apps/web/components/shared"
  "apps/admin/components/dashboard/layout    apps/web/components/dashboard/layout"
  "apps/admin/components/dashboard/panel     apps/web/components/dashboard/panel"
  "apps/admin/components/dashboard/pages/ui  apps/web/components/dashboard/pages/ui"
)

# Dentro de esas carpetas, lo que está atado al dominio de Cori y NO se copia (ver
# REUTILIZACION.md §4): la paginación conoce los contexts de productos/variantes/caja, y el
# panel de ajustes de UI monta los paneles del dashboard de la tienda.
WEB_EXCLUDE=(
  "apps/admin/components/shared/pagination/Pagination.tsx"
  "apps/admin/components/dashboard/layout/header/UISettingsPanel.tsx"
)

copied=()
skipped=()
missing=()

provenance() {
  local repo=$1 sha=$2 path=$3
  echo "// Origen: Cori ${repo}@${sha}:${path} — adaptado para EditFlow. Ver COPIADOS_DE_CORI.md"
}

copy_one() {
  local src_root=$1 repo=$2 sha=$3 rel_src=$4 rel_dst=$5
  local src="$src_root/$rel_src" dst="$DEST/$rel_dst"

  if [ ! -f "$src" ]; then missing+=("$repo:$rel_src"); return; fi
  if [ -e "$dst" ]; then skipped+=("$rel_dst"); return; fi

  mkdir -p "$(dirname "$dst")"
  case "$dst" in
    *.ts|*.tsx|*.js|*.mjs)
      # "use client" tiene que seguir siendo la primera línea del archivo.
      if head -1 "$src" | grep -q '^"use client"'; then
        { head -1 "$src"; echo; provenance "$repo" "$sha" "$rel_src"; tail -n +2 "$src"; } > "$dst"
      else
        { provenance "$repo" "$sha" "$rel_src"; echo; cat "$src"; } > "$dst"
      fi
      ;;
    *) cp "$src" "$dst" ;;
  esac
  copied+=("$repo:$rel_src -> $rel_dst")
}

for entry in "${API_FILES[@]}"; do
  read -r s d <<<"$entry"
  copy_one "$API_SRC" "ecommerce-api" "$API_SHA" "$s" "$d"
done

for entry in "${WEB_FILES[@]}"; do
  read -r s d <<<"$entry"
  copy_one "$WEB_SRC" "e-commerce-nextjs" "$WEB_SHA" "$s" "$d"
done

for entry in "${WEB_DIRS[@]}"; do
  read -r s d <<<"$entry"
  while IFS= read -r -d '' file; do
    rel=${file#"$WEB_SRC/$s/"}
    if printf '%s\n' "${WEB_EXCLUDE[@]}" | grep -qxF "$s/$rel"; then continue; fi
    copy_one "$WEB_SRC" "e-commerce-nextjs" "$WEB_SHA" "$s/$rel" "$d/$rel"
  done < <(find "$WEB_SRC/$s" -type f -print0 | sort -z)
done

# Archivos que no se copian de Cori sino del kit: versiones ya recortadas.
KIT_DIR=$(cd "$(dirname "$0")" && pwd)
KIT_FILES=(
  "plantillas/shared-types-context.ts  packages/shared/types/context.ts"
)
for entry in "${KIT_FILES[@]}"; do
  read -r s d <<<"$entry"
  if [ -e "$DEST/$d" ]; then skipped+=("$d"); continue; fi
  mkdir -p "$(dirname "$DEST/$d")"
  cp "$KIT_DIR/$s" "$DEST/$d"
  copied+=("kit:$s -> $d")
done

{
  echo "# Archivos copiados de Cori"
  echo
  echo "Generado por \`copiar-desde-cori.sh\` el $(date -u +%Y-%m-%d)."
  echo "Origen: ecommerce-api@${API_SHA} · e-commerce-nextjs@${WEB_SHA}."
  echo
  echo "Para comparar uno con su original: \`git -C <clon de Cori> show <sha>:<ruta>\` y diff."
  echo
  for line in "${copied[@]}"; do echo "- \`$line\`"; done
} > "$DEST/COPIADOS_DE_CORI.md"

echo "copiados: ${#copied[@]}"
if [ ${#skipped[@]} -gt 0 ]; then
  echo "salteados (ya existían en el destino): ${#skipped[@]}"
  printf '  %s\n' "${skipped[@]}"
fi
if [ ${#missing[@]} -gt 0 ]; then
  echo "NO ENCONTRADOS en Cori (¿se movieron?): ${#missing[@]}" >&2
  printf '  %s\n' "${missing[@]}" >&2
  exit 2
fi
