# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app
# `corepack enable` a secas instala shims para npm, npx, yarn y pnpm (pisando los
# binarios reales). El proyecto es pnpm-only, así que se pide solo ese.
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:24-alpine AS runtime
WORKDIR /app
# La imagen de runtime no lleva gestor de paquetes: ni npm ni pnpm. Los binarios
# se invocan directo desde node_modules/.bin (que son shims `#!/bin/sh`, no hace
# falta nada que los resuelva). Meter pnpm acá vía corepack sale caro: su bundle
# son 20 MB y arrastra su propio `tar` con una CVE crítica — cambiar el árbol de
# npm por el de pnpm no es ganar nada.
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `prisma generate` no conecta a la base, pero prisma.config.ts exige que
# DATABASE_URL resuelva para poder cargar la config; en build time no hay
# acceso a las env vars de runtime (vienen de compose), así que se usa un
# placeholder solo para este paso — el valor real lo pisa `environment`/
# `env_file` del compose al levantar el contenedor.
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" node_modules/.bin/prisma generate
# middleware/upload.js escribe uploads temporales acá (multer diskStorage)
# antes de subirlos a Cloudinary; el usuario no-root necesita poder crearlo.
RUN mkdir -p tmp/uploads && chown -R app:app tmp
# Fuera los gestores de paquetes que trae la imagen base. npm es el importante:
# el proyecto es pnpm-only y su árbol de dependencias bundleadas es el origen de
# *todas* las CVEs que Docker Scout reporta sobre node:24-alpine (tar,
# brace-expansion, undici e ip-address viven ahí adentro y en ningún otro lado de
# la base). yarn y corepack se van por lo mismo: no los usa nadie y en una imagen
# sin npm no tiene sentido dejarlos. Nada en runtime los necesita — el CMD es
# `node app.js` y el healthcheck es `node -e`.
# Ver docs/ARCHITECTURE.md §Infraestructura local.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/lib/node_modules/corepack /usr/local/bin/corepack \
    /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
USER app
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "app.js"]
