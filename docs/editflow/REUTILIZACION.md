---
tags: [editflow, reutilizacion, cori]
estado: propuesta
ultima-revision: 2026-10-03
---

# Qué se reutiliza de Cori, y cómo

## 1. La estrategia: copiar con procedencia

Hay tres formas de reusar código entre dos proyectos. Para el momento de EditFlow, la
respuesta es la primera:

| Forma | Cuándo conviene | Para EditFlow hoy |
| --- | --- | --- |
| **Copiar con procedencia** | El código es chico, probado, y va a divergir | ✅ Sí |
| Paquete compartido (npm privado o submódulo) | El mismo archivo se corrige en los dos lados más de una vez | Todavía no: hoy sería versionar y publicar para dos consumidores que recién se separan |
| Un solo repo con los dos productos | Comparten deploy, usuarios o base | No: no comparten nada de eso |

"Con procedencia" quiere decir que cada archivo copiado lleva una primera línea así:

```ts
// Origen: Cori e-commerce-nextjs@236e4d8:apps/admin/components/dashboard/panel/PanelSection.tsx — adaptado para EditFlow
```

y que en la raíz de EditFlow queda `COPIADOS_DE_CORI.md` con la lista completa. Si mañana se
arregla un bug en `SidePanel.tsx` de Cori, se sabe que EditFlow tiene la misma copia y de qué
commit salió. **El día que el mismo arreglo haya que hacerlo dos veces en los dos lados,** ese
archivo pasa a un paquete compartido; no antes.

## 2. El script

[`copiar-desde-cori.sh`](./copiar-desde-cori.sh) hace la copia entera:

```bash
./docs/editflow/copiar-desde-cori.sh ~/code/ecommerce-api ~/code/e-commerce-nextjs ~/code/editflow
```

- Copia **175 archivos**, a su ruta de destino, con la línea de procedencia.
- **No pisa** nada que ya exista en el destino (corrido dos veces, la segunda no copia nada).
- El backend llega a `apps/api/_from-cori/` (es JS y hay que pasarlo a TS); el front llega a
  su lugar final (ya es TS).
- **Verificado:** lo copiado del panel no tiene imports sin resolver y compila con `tsc
  --noEmit` (113 archivos del proyecto) usando las dependencias del admin de Cori.

## 3. Inventario

**Acción**: *tal cual* = se copia y anda; *adaptar* = se copia y se cambia algo concreto
(dicho en la columna); *referencia* = no se usa, se lee para escribir el equivalente.

### Backend (`ecommerce-api`) → `apps/api`

| Cori | Acción | Qué cambia |
| --- | --- | --- |
| `helpers/error.js` | tal cual → `lib/errors.ts` | Pasa a clase `AppError` con el mismo shape (`message, code, statusCode, details`) |
| `middleware/errorHandler.js` | tal cual | Solo el import de config |
| `middleware/validate.js` | adaptar | Sacar la limpieza de uploads de multer (no hay uploads en v1) |
| `middleware/role.js` | adaptar | Responder con `AppError` en vez de armar el JSON a mano |
| `middleware/auth.js` | adaptar | Quedan `verifyToken` y `attachUser`; `tenantId` → `agencyId`; se van las variantes de la tienda |
| `controllers/users.js` + `services/users.js` + `routes/users.js` + `schemas/auth.schema.js` | adaptar | Login, logout, me, verificación de email, cookie cross-site. Se va el registro de tenant con perfil de venta |
| `helpers/password.js` | tal cual | argon2 |
| `lib/tokens.js` | adaptar | Queda `hashToken` y el token de verificación; se va el de seguimiento de pedido (o se reusa si el cliente tiene link público) |
| `lib/prisma.js` | tal cual | `@prisma/adapter-pg` |
| `lib/logger.js` + `middleware/httpLogger.js` | tal cual | pino + pino-http |
| `middleware/cors.js` + `helpers/origin.js` + `middleware/proxyChain.js` | tal cual | `ORIGINS`, trust proxy |
| `middleware/rateLimit.js` | adaptar | Quedan el general y el de login; se van los de la tienda y el chat |
| `config.js` + `schemas/env.schema.js` | adaptar | Recortar a lo que se usa: DB, JWT, ORIGINS, BASE_URL, SMTP opcional |
| `schemas/id.schema.js`, `date.schema.js` | tal cual | Van a `packages/shared/schemas` |
| `lib/slug.js` | tal cual | Slug de la agencia |
| `lib/phone.js` | tal cual | Normalizar el WhatsApp del cliente a E.164 |
| `lib/mailer.js` | tal cual (fase 2) | Verificación de email, avisos |
| `lib/redis.js` + `lib/cache.js` | tal cual (cuando haga falta) | `tenantNs` → `agencyNs` |
| `lib/crypto.js` | tal cual (cuando haga falta) | Solo si se guardan credenciales de terceros |
| `helpers/xlsx.js` | tal cual (fase 3) | Exportar tandas/entregas a Excel |
| `prisma/create-tenant.js` | adaptar → `create-agency.ts` | Alta por consola de la agencia y su OWNER |
| `tests/global-setup.js` + `tests/helpers.js` | adaptar | `buildTenant` → `buildAgency` con un OWNER y un EDITOR |
| `vitest.config.js`, `prisma.config.ts` | tal cual | |
| `Dockerfile`, `docker-compose*.yml`, `scripts/backup-db.sh`, `.env.example` | adaptar | Nombres de servicio e imagen; sacar lo que no se usa |
| `services/order-state.js` | **referencia** | La forma de `domain/video-state.ts`: transiciones como dato, `blockers()` puro |
| `services/order-status.js` | **referencia** | Un solo lugar con los nombres visibles de los estados |
| `services/promos.js` (`pickPromoTier`) | **referencia** | Es exactamente el escalón de descuento de `domain/pricing.ts` |
| `tests/isolation.test.js` | **referencia** | El test de que una agencia no ve a otra |

### Front (`e-commerce-nextjs`) → `apps/web` y `packages/shared`

| Cori | Acción | Qué es |
| --- | --- | --- |
| `apps/admin/components/dashboard/layout/**` | tal cual | Sidebar, header, footer, `SidePanel`, `TabSlider`, `BottomSheet`, `SectionNav` |
| `apps/admin/components/dashboard/panel/**` | tal cual | `PanelCommandCard`, `PanelSection`, `FormSection`, `FormRow`, `PanelItem`… |
| `apps/admin/components/dashboard/pages/ui/` | tal cual | `PageSection`, `PageLabel` |
| `apps/admin/components/shared/**` | tal cual | `DataTable`, `ListRow`, `AlertCard`, `EmptyState`, `Segmented`, `SearchInput`, `StatusDot`, `Amount`, dnd, `ConfirmDeleteModal`, `Field` |
| `apps/admin/components/auth/**` + `app/(auth)/**` | adaptar | Login y recupero; textos y marca |
| `apps/admin/app/{layout,providers,error,loading,not-found}.tsx`, `globals.css` | adaptar | `globals.css` trae **todos los tokens de diseño**: es lo más valioso del front |
| `apps/admin/context/{Auth,SidePanel,PageMeta,HeaderSlot,FooterSlot,UISettingsPanel}.tsx` + sus hooks | tal cual | El estado del shell |
| `apps/admin/hooks/{useMediaQuery,usePersistedPreference,useSidebarCollapsed,…}` | tal cual | |
| `apps/admin/lib/api.ts` | adaptar | `X-Tenant-Slug` → el slug de la agencia (o nada: la agencia sale del token) |
| `apps/admin/services/auth.service.ts` | tal cual | |
| `packages/shared/lib/{api-error,format,storage,toast,query,url,phone,access-log}.ts` | tal cual | |
| `packages/shared/components/{auth,theme}` | tal cual | `PasswordInput`, `PasswordStrength`, `ThemeSwitcher` |
| `packages/shared/types/{auth,dashboard/sideBar}.ts` | tal cual | |
| `packages/shared/types/context.ts` | **recortado en el kit** | El original mezcla 15 contextos de la tienda; el script copia [`plantillas/shared-types-context.ts`](./plantillas/shared-types-context.ts) con los 3 del shell |
| `docs/PATRON_DE_MODULO.md`, `docs/design-tokens.md` | referencia → `docs/cori/` | **Leer antes del primer módulo** |
| `apps/admin/components/dashboard/pages/{caja,orders}/` | **referencia** | Los dos módulos que siguen el patrón; el molde de Clientes y Tandas |
| `apps/admin/components/dashboard/pages/{couriers,dispatch}/` | **referencia** | Asignar una persona a un trabajo y ver la carga de cada una: el molde de Editores |
| `apps/admin/components/dashboard/pages/stats/` + `dashboard/` | **referencia** | Stat cards y gráficos: el molde del Dashboard |

## 4. Lo que NO se lleva

| Cori | Por qué no |
| --- | --- |
| `components/shared/pagination/Pagination.tsx` | Conoce los contexts de productos, variantes y caja. Se reescribe genérica en el primer listado que la necesite |
| `components/dashboard/layout/header/UISettingsPanel.tsx` | Monta los paneles de ajustes del dashboard de la tienda. El context y el hook sí se copian |
| Storefront, Page Builder, carrito, checkout, combos, variantes, promos | Es el dominio de venta |
| Órdenes, cobros, caja, MercadoPago | Ídem. Si EditFlow registra pagos, se diseña su propio libro, mirando `OrderPayment` como referencia |
| Bot de WhatsApp, chat con LLM, sugerencias de contenido | Fuera de alcance de v1 |
| `services/tenant-profiles.js` | Perfiles de venta: no aplica |

## 5. Lo que conviene tener a mano y no está en el repo

- **El `CLAUDE.md` del admin de Cori.** Los docs lo citan ("regla 0", "regla 2"…) pero no está
  commiteado. Si lo tenés local, es la base del `CLAUDE.md` de `apps/web`.
- **Una config de ESLint.** El front de Cori no tiene `eslint.config.*` y `pnpm lint` no corre:
  en EditFlow va desde el primer commit.
