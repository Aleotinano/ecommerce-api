# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:24-alpine AS runtime
WORKDIR /app
RUN corepack enable && addgroup -S app && adduser -S app -G app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `prisma generate` no conecta a la base, pero prisma.config.ts exige que
# DATABASE_URL resuelva para poder cargar la config; en build time no hay
# acceso a las env vars de runtime (vienen de compose), así que se usa un
# placeholder solo para este paso — el valor real lo pisa `environment`/
# `env_file` del compose al levantar el contenedor.
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" npx prisma generate
# middleware/upload.js escribe uploads temporales acá (multer diskStorage)
# antes de subirlos a Cloudinary; el usuario no-root necesita poder crearlo.
RUN mkdir -p tmp/uploads && chown -R app:app tmp
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
USER app
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "app.js"]
