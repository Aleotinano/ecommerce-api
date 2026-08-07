---
tags: [servicio, dominio/tenant-config]
estado: estable
ultima-revision: 2026-07-22
lado: backend
---

# TenantConfig

## Propósito
Configuración de marca/operación por tenant: branding, contacto, redes, SEO, políticas legales,
moneda/locale, comportamiento de catálogo/carrito, seña/depósito y credenciales de WhatsApp Business.
Es 1-1 con `Tenant` y alimenta tanto el panel admin como el `GET /store/config` público del storefront.

## Modelo de datos
Fuente: `prisma/schema.prisma` (modelo `TenantConfig`, relación 1-1 con `Tenant`).

Campos por grupo:
- **Branding/contacto**: `storeName`, `storeDescription`, `storeTagline`, `logoUrl`/`logoPublicId`
  (Cloudinary, gestionados aparte — ver abajo), `contactEmail`, `contactPhone`, `contactAddress`.
- **Redes**: `socialInstagram`, `socialTiktok`, `socialFacebook`, `socialTwitter`, `socialYoutube`,
  `socialPinterest`, `socialWhatsapp`.
- **WhatsApp Business (Graph API)**: `whatsappPhoneNumberId` (único, dígitos), `whatsappAccessToken`
  (cifrado en reposo, ver Reglas de negocio).
- **Cuenta de Cloudinary del cliente**: `cloudinaryCloudName`, `cloudinaryApiKey`,
  `cloudinaryApiSecret` (las dos últimas cifradas en reposo). Van las tres o ninguna; en `null`
  se usa la cuenta global de env. Ver [[Cloudinary por tenant]].
- **SEO**: `seoTitle`, `seoDescription`, `seoKeywords`.
- **Políticas**: `shippingPolicy`, `returnsPolicy`, `privacyPolicy` (texto libre largo).
- **Operación**: `currency` (default `"ARS"`), `locale` (default `"es-AR"`), `showOutOfStock`
  (default `false`), `allowCartGuest` (default `true`).
- **Variantes**: `productVariantsEnabled` (default `true`) — ver [[Productos]] y [[Variantes]].
- **Flujo de venta** (los cuatro que NO edita el tenant, ver más abajo):
  `paymentMethodsEnabled` (array de `OrderPaymentMethod`, default `[CASH, TRANSFER, MIXED]`),
  `fulfillmentMethodsEnabled` (array de `FulfillmentMethod`, default `[DELIVERY, PICKUP]`),
  `depositEnabled` (default `false`), `depositPercentage` (default `50`) — ver [[Órdenes]] →
  "Flujo de seña / pedidos del bot".
- **Caja**: `cashRegisterEnabled` (default `false`) — habilita el módulo de [[Caja]]. **No lo edita el
  tenant**: prendido, cobrar sin turno abierto falla, así que es de la misma clase que los cuatro de
  arriba. No es parte de un perfil: se setea con `node prisma/set-cash-register.js <slug> on|off`.
- **Turnos de caja**: `cashSchedule` (`Json?`, default `null`) — `[{ label, from: "HH:MM",
  to: "HH:MM" }]`, hasta 6 turnos sin solapar. **Esto sí lo edita el tenant**: es su horario de
  atención, cambia con la temporada, y un horario mal puesto no puede bloquear una venta porque la
  apertura automática solo **desbloquea** cobros. Ver [[Caja]] → "Turnos con horario".

## Reglas de negocio / invariantes

> [!important] Dos clases de campo: los del tenant y los nuestros (2026-07-29)
> El flujo de venta —`paymentMethodsEnabled`, `fulfillmentMethodsEnabled`, `depositEnabled`,
> `depositPercentage`— más `cashRegisterEnabled` **los configuramos nosotros**. Deciden cuándo una
> orden puede producirse y cuánta plata se exige antes: si el tenant los cambiara, un pedido tomado
> la semana pasada podría dejar de poder producirse porque alguien apagó un método de pago, o un
> cobro dejaría de impactar en el arqueo sin que nadie se enterara. Todo lo demás (branding, tema,
> SEO, políticas, contacto, y las perillas de UX `showOutOfStock`/`allowCartGuest`/
> `customerPhoneMode`) sigue siendo del tenant — igual que las **etiquetas de caja**
> (`CashCategory`), que son su taxonomía y no una regla de plata.
>
> **El mecanismo es el schema Zod, no el rol.** `PATCH /tenant-config/:tenantId` corre con
> `requireRole(["ADMIN"])`, y ese ADMIN es el del propio tenant — el rol no alcanza para
> distinguirlo de nosotros. Lo que bloquea es que el campo **no esté en
> `updateTenantConfigObject`**. Están listados en `READONLY_TENANT_CONFIG_FIELDS`, y el `PATCH` los
> rechaza con un 400 explícito en vez de dejar que Zod los descarte: un
> `PATCH { storeName, depositEnabled }` que devolviera 200 habiendo tirado la seña a la basura es
> justo el bug de "persiste pero no se refleja" que este módulo evita en otros lados. Para eso el
> objeto es `.passthrough()` — Zod descarta las claves desconocidas *antes* de los refinements, así
> que sin eso el chequeo nunca vería el campo. No se usó `.strict()` porque rompería a cualquier
> panel que haga `PATCH` del payload completo del `GET` (que incluye `id` y `logoUrl`).
>
> **Se leen igual**: `TENANT_CONFIG_PUBLIC_SELECT` mergea las dos listas, porque el storefront
> necesita `paymentMethodsEnabled` para pintar solo los métodos que el tenant acepta, y el panel
> necesita `cashRegisterEnabled` para saber si mostrar el módulo de caja.
>
> **Cómo se setean**: con un perfil de `services/tenant-profiles.js` al crear el tenant
> (`UserModel.register` acepta un `profile`, default `estandar`), y después a mano con
> `node prisma/set-tenant-profile.js <slug> <perfil>`. La caja va por su propio script
> (`prisma/set-cash-register.js`) y **no** por el perfil, para que reaplicar un perfil no apague la
> caja de quien la tenga prendida. No hay endpoint HTTP a propósito: cualquier ruta con
> `requireRole(["ADMIN"])` se la puede pegar el admin del tenant.

Los tres perfiles (`estandar` / `contraentrega` / `produccion-por-sena`), cómo se aplican y cómo
agregar uno están en **[[Perfiles de flujo de venta]]**. Acá alcanza con saber que los cuatro campos
existen, que el tenant no los escribe, y que el default (`estandar`) coincide exactamente con los
`@default()` de las columnas — hay un test que lo verifica leyendo `schema.prisma`.

> [!note] Whitelist derivada del schema Zod (corregido, commit `85f0013`, 2026-07-17)
> `controllers/tenant-config.js:update` ya **no** destructura campo por campo: itera
> `UPDATABLE_TENANT_CONFIG_FIELDS` (exportado desde `schemas/tenant-config.schema.js:203-205` como
> `Object.keys(updateTenantConfigObject.shape)`) y copia a `data` solo los campos presentes en
> `req.body`. Lo mismo aplica del lado de lectura: `TENANT_CONFIG_PUBLIC_SELECT`
> (`services/tenant-config.js`) también se deriva de `UPDATABLE_TENANT_CONFIG_FIELDS` (menos los de
> `SECRET_TENANT_CONFIG_FIELDS`, excluidos a propósito). Agregar un campo nuevo hoy exige tocar **dos**
> lugares: el modelo Prisma + migración, y `schemas/tenant-config.schema.js` — ya no existe un
> tercer lugar (whitelist del controller o `select` a mano) que se pueda olvidar; el campo aparece
> automáticamente tanto en la escritura como en la respuesta de lectura. Al momento de esta revisión
> el schema tiene 28 campos actualizables.

- **`logoUrl`/`logoPublicId` están fuera del whitelist de `update`**: se gestionan por endpoints
  dedicados (`PATCH /:tenantId/logo`, `DELETE /:tenantId/logo`) que suben/borran en Cloudinary y hacen
  su propio `upsert`. `PATCH /:tenantId` normal no puede tocar el logo.
- **Los campos de `SECRET_TENANT_CONFIG_FIELDS` se cifran en reposo** (AES-256-GCM vía [[Crypto]])
  antes de persistir y **nunca se devuelven** en ninguna respuesta de la API: hoy son
  `whatsappAccessToken`, `cloudinaryApiKey` y `cloudinaryApiSecret`. La lista es una sola y la
  consume el servicio para las dos cosas —cifrar al escribir, excluir del `select`—, así que un
  secreto nuevo queda cubierto en ambos lados por agregarlo ahí. `null` explícito desconecta
  (vuelve al token / la cuenta global de `env`); no confundir con "no enviar el campo" (que lo deja
  como está).
- **Las credenciales de Cloudinary se validan contra el proveedor al guardarlas** (`api.ping`): un
  `api_secret` mal pegado da `400 CLOUDINARY_CREDENTIALS_INVALID` y no se persiste nada. Y van las
  **tres juntas** (CHECK en la DB + `superRefine`): media credencial es un tenant que sube a ningún
  lado. Ver [[Cloudinary por tenant]].
- **`update` es un `upsert`**: si el tenant no tenía config todavía, el primer PATCH la crea.
- **Solo `ADMIN`** puede `PATCH`/subir o borrar logo. `GET /:tenantId` (admin) usa `attachUser` (no
  fuerza rol — auth opcional); `GET /store/config` (storefront) **no tiene auth alguna**, es
  completamente público — ambos devuelven el mismo `select`, que ya excluye el token.
- **`updateTenantConfig` (schema) exige al menos un campo definido** (`.refine`) — un PATCH vacío se
  rechaza en la capa de validación, antes de llegar al controller/whitelist.
- **Cache**: `TenantConfigModel.get` cachea 600s (`wrap`, key `t<tenantId>:config`); toda escritura
  (`update`, `uploadLogo`, `deleteLogo`) invalida esa key.

## Endpoints

### `routes/tenant-config.js` (montado en `/tenant-config`)

| Método | Ruta | Qué hace | Auth / rol |
| --- | --- | --- | --- |
| GET | `/:tenantId` | Devuelve la config (404 `TENANT_CONFIG_NOT_FOUND` si el tenant no tiene) | `attachUser` (auth opcional, no exige rol) |
| PATCH | `/:tenantId` | Actualiza campos (whitelist, ver arriba); upsert si no existía | `ADMIN` |
| PATCH | `/:tenantId/logo` | Sube/reemplaza logo (multipart → Cloudinary), borra el anterior | `ADMIN` |
| DELETE | `/:tenantId/logo` | Borra logo actual (404 `NO_LOGO_TO_DELETE` si no tiene) | `ADMIN` |

### Storefront — `routes/store/config.js` (montado en `/store/config`)

| Método | Ruta | Qué hace | Auth |
| --- | --- | --- | --- |
| GET | `/` | Misma config, tenant resuelto por slug | **Público**, sin middleware de auth |

## Dependencias
- [[Crypto]] — cifra/descifra los `SECRET_TENANT_CONFIG_FIELDS`.
- [[Cloudinary por tenant]] — las tres credenciales que viven acá y cómo se resuelven en runtime.
- [[Almacenamiento de imágenes]] (Cloudinary) — logo.
- [[Redis y cache]] — cache de 600s con invalidación en cada escritura.
- [[Multi-tenancy]] — `tenantId` de ruta (admin) vs. resuelto por slug (storefront).
- Consumido por: [[Productos]] (`productVariantsEnabled`), [[Órdenes]] (los cuatro campos de flujo:
  métodos habilitados + `depositEnabled`/`depositPercentage`), [[Caja]] (`cashRegisterEnabled`, leído
  con un `findUnique` directo y **no** por el cache: de ese flag depende un guard),
  [[Sugerencias de contenido]] (branding para el prompt del LLM), [[WhatsApp]]
  (`whatsappPhoneNumberId`/`whatsappAccessToken`).

## Integraciones externas
- **Cloudinary** para el logo.
- **WhatsApp Business Graph API** — este servicio solo guarda las credenciales; el uso real está en
  [[WhatsApp]].

## Deuda técnica / cosas raras
Etiquetas por tipo de acción — ver convención en [[App]].

- `[resuelto]` El bug histórico de `select` desincronizado (campos que persistían pero no se
  reflejaban en la respuesta) y la whitelist manual del controller (campo nuevo olvidado = PATCH
  silenciosamente ignorado) quedaron eliminados estructuralmente por el refactor `85f0013` — ambos
  (`data` de escritura y `select` de lectura) se derivan hoy de la misma fuente
  (`UPDATABLE_TENANT_CONFIG_FIELDS`). Ver nota arriba.
- `[nota]` Los secretos fuera del `select` de respuesta son **intencionales** (nunca se exponen) —
  `TENANT_CONFIG_PUBLIC_SELECT` filtra `SECRET_TENANT_CONFIG_FIELDS` de
  `UPDATABLE_TENANT_CONFIG_FIELDS`. `cloudinaryCloudName` **no** está en esa lista y sí vuelve: no
  es secreto, y es lo que le permite al panel mostrar si el tenant tiene cuenta propia.
- `[nota]` Desde 2026-07-29 hay **dos** listas de campos, no una: `UPDATABLE_TENANT_CONFIG_FIELDS`
  (escritura + lectura) y `READONLY_TENANT_CONFIG_FIELDS` (solo lectura, el flujo de venta). Agregar un
  campo nuevo exige decidir en cuál va — si va en la de solo lectura, además hace falta una vía para
  setearlo (hoy hay dos: [[Perfiles de flujo de venta]] para los cuatro de venta y
  `prisma/set-cash-register.js` para el de [[Caja]]).
- `[riesgo]` `updateTenantConfigObject` **no** es `.strict()`, así que las claves desconocidas se
  descartan en silencio. Para el flujo de venta eso se cubrió con un rechazo explícito por campo, pero
  cualquier campo futuro que se saque del schema sin sumarlo a `READONLY_TENANT_CONFIG_FIELDS` vuelve a
  caer en el bug de "PATCH devuelve 200 y no guardó eso".

## Preguntas abiertas / mejoras candidatas
- ¿`GET /:tenantId` (admin, auth opcional vía `attachUser`) debería exigir al menos `verifyToken`? Hoy
  cualquiera con el `tenantId` numérico puede leer la config admin sin estar autenticado (aunque no
  incluye el token de WhatsApp).
