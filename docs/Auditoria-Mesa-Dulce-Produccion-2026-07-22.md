# Auditoría de código — Mesa Dulce a producción

**Fecha:** 2026-07-22 · **Método:** lectura directa del repo (read-only), sin asumir nada de contexto verbal. Prioriza evidencia de código por sobre documentación no versionada o memoria de trabajo previo — donde hay discrepancia, se marca explícitamente.

## Alcance confirmado por el usuario (condiciona toda la tabla)

El software está pensado en 3 demos. Lo que se comercializa a Mesa Dulce ahora es **Demo 1: catálogo — Productos, Órdenes, Categorías, Estadísticas.** Nada más.

**Demo 2 (sugerencias de contenido + chatbot de WhatsApp, prioridad en el chatbot) queda fuera de esta cotización** — se audita igual acá abajo, en sección separada, porque ya está construido en el repo y puede ser insumo para una cotización futura, pero no debe inflar el presupuesto de Demo 1.

## Hallazgo previo importante (condiciona la estimación de Demo 1)

**"mesa-dulce" ya existe en el repo como tenant con datos reales, no es un cliente nuevo en blanco.** `prisma/seed.js` tiene un bloque `MESA_DULCE_CATEGORIES` / `MESA_DULCE_PRODUCTS` (catálogo real de cookies/brownies), `prisma/fix-mesa-dulce-categories-and-combos.js` reconstruye 3 combos reales, y `prisma/seed-tenant-config.js` ya tiene `depositEnabled: true, depositPercentage: 50` para ese tenant. Esto es trabajo de dominio ya hecho en un sprint anterior — pero vive **solo en datos de seed de desarrollo** (uno de los scripts existe porque el catálogo *"se perdió en un reset de la DB dev"* y hubo que reconstruirlo a mano).

**Decisión que bloquea el resto del análisis:** confirmar si el cliente real que están por cerrar es literalmente este mismo negocio (y por lo tanto ese catálogo/combos ya sirve como base real) o si es coincidencia de nombre y hay que tratarlo como catálogo de referencia a reemplazar.

---

## Tabla de tareas concretas — Demo 1 (Mesa Dulce: Productos, Órdenes, Categorías, Estadísticas)

| # | Área | Qué hay que hacer | Estado actual | Complejidad | Riesgos / incógnitas |
|---|---|---|---|---|---|
| 1 | Infra | Confirmar si "mesa-dulce" del seed es el cliente real o coincidencia de nombre | Dato ya cargado en repo | Trivial (pregunta, no código) | Bloquea la estimación de cuánto del catálogo/combos ya sirve |
| 2 | Infra | Dockerfile de producción para el backend | No existe (0 archivos `Dockerfile*` en todo el repo) | Media | Depende de Node version y si hay build step |
| 3 | Infra | `docker-compose.yml` de producción (backend + Postgres, hoy solo levanta Redis) | Existe parcial — el compose actual solo define Redis (`redis_dev`), sin backend ni Postgres | Media | Decidir si Postgres va en el mismo compose o managed/externo |
| 4 | Infra | Pipeline de deploy a VPS (manual documentado o CI/CD) | No existe — sin `.github/workflows`, sin Procfile/fly.toml/railway.json/deploy.sh | Media/Grande | Depende de proveedor elegido (Hetzner/Linode) y si quieren CI |
| 5 | Infra | Separación real de config prod vs dev (hoy solo `NODE_ENV`) | Existe parcial — `.env.example` completo y validado con zod, sin plantilla de producción separada | Chica | Ninguno crítico |
| 6 | Infra | Auth en Redis si se expone en un VPS público | Existe parcial (sin `requirepass` visible) | Trivial/chica | Riesgo si el puerto 6379 queda accesible desde afuera |
| 7 | Infra | Soporte de dominio custom del tenant (hoy solo subdominio o header `X-Tenant-Slug`) | No existe — la resolución exige hostname con ≥3 partes | Chica/Media | Solo si el cliente quiere dominio propio en vez de subdominio del SaaS |
| 8 | Infra/seguridad | Enforcement automático de `tenantId` en queries (hoy convención, no lo garantiza el ORM) | Existe parcial — ya documentado como riesgo por el propio equipo | Media | Riesgo real de fuga de datos entre tenants; relevante ahora que hay un cliente pagando con datos reales |
| 9 | Productos | Migrar catálogo/combos de Mesa Dulce de "script manual recuperado tras pérdida de datos" a proceso confiable | Existe parcial | Chica | Queda una categoría "Combo Mundialista" vacía sin terminar |
| 10 | Productos | Modo de combo "cerrado" (contenido fijo, precio fijo, se agrega al carrito como producto simple) | **No existe** — hoy todo combo obliga a elegir componentes de una whitelist (`comboMinItems`/`comboMaxItems`) | Media/Grande | Brecha más importante encontrada: contradice el caso de uso descripto; toca schema, carrito, orden y checkout |
| 11 | Órdenes | Campo de "observación/nota" del cliente en el flujo normal de carrito/checkout | **No existe** — hoy `note` solo se completa vía bot (fuera de alcance Demo 1) o corrección posterior de un admin | Chica | Ninguno mayor |
| 12 | Productos/Config | Cargar branding real de Mesa Dulce en `TenantConfig` | **No existe** — el seed solo tiene `depositEnabled`/`depositPercentage`, nada de branding | Trivial/chica | Es carga de datos, no desarrollo |
| 13 | Productos | Preset genérico y reusable de vertical "repostería" para futuros tenants | **No existe**, confirmado en comentario: *"el backend no tiene ningún concepto de rubro"* | Grande | Solo tiene sentido si van a vender la plataforma a más de una pastelería — decisión de producto, no bloquea a Mesa Dulce |
| 14 | Productos | Limpieza de deuda legacy menor (`Product.isCombo` escrito pero nunca leído, scripts ya ejecutados) | Existe (deuda conocida, no bloqueante) | Trivial | Cosmético, no bloquea producción |
| 15 | Órdenes | Que `allowCartGuest` tenga efecto real (hoy el carrito de invitado funciona siempre, sin mirar el flag) | Existe parcial | Chica | Solo relevante si quieren poder desactivarlo para este tenant |
| 16 | Estadísticas | Dashboard de KPIs para Mesa Dulce (revenue, órdenes completadas, ticket promedio, unidades vendidas, clientes activos, tendencia diaria, estado de órdenes, revenue por categoría, ranking de productos con stock bajo) | **Existe y sirve tal cual** — `GET /stats/dashboard` (`controllers/stats.js`, `services/stats.js`), ya genérico por tenant, sin nada hardcodeado a otro cliente | Trivial | No se encontró ningún test dedicado para este endpoint (`tests/`) — validar manualmente el output con el catálogo real de Mesa Dulce antes de entregar |
| 17 | Storefront | Storefront de Mesa Dulce | **No existe nada en este repo** — no hay `apps/storefront`; solo contratos de API en `front-md-guia/` para un repo externo | Grande (fuera de este repo) | No se pudo auditar el repo de frontend externo — no accesible desde acá |

---

## Fuera de alcance de esta cotización — Demo 2 (sugerencias + chatbot, prioridad chatbot)

Se deja registrado porque ya es código existente en el repo y puede servir de insumo cuando llegue el momento de cotizar Demo 2, **no debe entrar en el presupuesto de Mesa Dulce/Demo 1**.

| # | Área | Qué hay que hacer | Estado actual | Complejidad | Riesgos / incógnitas |
|---|---|---|---|---|---|
| A | WhatsApp | Configurar `whatsappPhoneNumberId`/`whatsappAccessToken` por tenant en `TenantConfig` | No existe cargado para mesa-dulce | Trivial/chica | Depende de tener la cuenta de WhatsApp Business (Meta) lista |
| B | WhatsApp | Que el bot pueda tomar pedidos de combos (hoy los rechaza explícitamente en `createDraftOrder`) | Existe parcial — hay un "v2" mencionado en docs de dominio pero no implementado | Media/Grande | Si Demo 2 se vende a Mesa Dulce, el bot hoy no puede vender nada de su catálogo (solo combos) hasta que exista el modo de combo cerrado (ítem 10) |
| C | WhatsApp | Cobertura de test end-to-end del canal (hoy todo mockeado en las fronteras: Prisma, Redis, Graph API) | Existe parcial — buena cobertura unitaria, cero integración real | Media | Riesgo de regresión silenciosa |
| D | WhatsApp | Encolar el procesamiento del webhook (hoy fire-and-forget in-process) | Existe parcial | Media | Si el proceso muere entre el 200 OK y el envío, el mensaje se pierde |
| E | Sugerencias | Módulo de sugerencias de contenido (`services/content-suggestions/`) | Existe en el repo, no auditado en esta pasada (fuera de foco por prioridad del usuario en el chatbot) | — | No auditado — requiere pasada dedicada si se va a cotizar |

---

## Decisiones de arquitectura pendientes

- **¿"mesa-dulce" del seed es el cliente real o coincidencia de nombre?** Condiciona si el catálogo/combos/seña ya construidos cuentan como trabajo hecho o hay que descartarlos.
- **Modelo de combo: cerrado (precio fijo, sin selección) vs. armable (el actual).** Decisión de mayor impacto técnico dentro de Demo 1 — sin resolverla no se puede estimar bien el ítem 10, y además condiciona el ítem B de Demo 2.
- **Nivel de enforcement de tenant a nivel de datos antes del primer cliente pagando:** ¿aceptable el riesgo actual o se blinda antes de Demo 1?
- **¿Mesa Dulce es cliente único o van a vender esto como plataforma a más pastelerías?** Condiciona si vale construir el preset genérico (ítem 13).
- **Dominio propio vs. subdominio del SaaS** para el storefront.
- **"Las tres decisiones del roadmap del Page Builder"** mencionadas como posible bloqueante: no se pudieron confirmar en esta auditoría — existe un modelo `TenantPageSpec` en el schema pero no se investigó su alcance. Marcado como **incógnita explícita**.

## Incógnitas no confirmables por código

- Dónde/cómo se despliega hoy en producción, si hay algo corriendo.
- Estado real del repo de frontend externo (no accesible desde acá).
- Si el catálogo/combos reconstruidos reflejan una base real de algún ambiente o solo dev local.
- Alcance y estado del "Page Builder" (`TenantPageSpec`).
- Estado real del módulo de Sugerencias de Demo 2 (no auditado, marcado como pendiente si se necesita para una cotización de Demo 2).
