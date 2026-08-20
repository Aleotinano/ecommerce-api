---
tags: [servicio, dominio/infra]
estado: implementado
ultima-revision: 2026-07-30
lado: backend
---

# Cloudinary por tenant

> [!info] Qué es este documento
> Cómo se resuelven las credenciales de Cloudinary cuando cada cliente tiene **su propia cuenta**
> sobre una instancia multi-tenant única. Implementado el 2026-07-30 (antes vivía acá como
> propuesta).

## Por qué

Cada cliente que sale a producción se crea **sus propias cuentas de servicios externos**, para
aislar responsabilidad y costos. El deploy es **una instancia multi-tenant única** —`mesa-dulce`,
`acme` y los que vengan conviven en el mismo proceso y la misma DB—, así que "una cuenta por
cliente" no se resuelve con un `.env` distinto por deploy: hay que resolver las credenciales **por
tenant, en runtime**. Era la restricción que bloqueaba el onboarding.

## Cómo funciona

Las credenciales viven en `TenantConfig` (`cloudinaryCloudName`, `cloudinaryApiKey`,
`cloudinaryApiSecret`). Las dos últimas se guardan **cifradas** con `encryptSecret`/`decryptSecret`
(`lib/crypto.js`, AES-256-GCM), igual que `whatsappAccessToken`.

`lib/cloudinary.js` las resuelve:

```js
credentialsFor(tenantId)                 // → { cloud_name, api_key, api_secret }
credentialsForCloudName(tenantId, name)  // para un asset que ya existe
verifyCredentials({ cloudName, apiKey, apiSecret })  // → { ok, rejected, status, reason }
invalidateCredentials(tenantId)
ENV_CREDENTIALS                          // la cuenta global
```

**No se crea un cliente del SDK por tenant.** Todos los métodos de Cloudinary
(`uploader.upload`, `uploader.destroy`, `utils.private_download_url`, `api.ping`) aceptan
`cloud_name`/`api_key`/`api_secret` en el objeto de opciones y los mergean sobre la config global,
así que el "cliente del tenant" es un objeto de credenciales que el llamador spreadea. La
alternativa —llamar `cloudinary.config()` por request— sería estado mutable global compartido entre
requests concurrentes de tenants distintos.

> [!warning] Dónde va el objeto de opciones: **justo después de los argumentos posicionales**
> No "al final", que es la regla que parece y no es. `lib/v2/api.js` y `lib/v2/uploader.js`
> publican los métodos vía `v1_adapter` con un mapping que dice cuántos argumentos
> posicionales lleva cada uno: `upload: 1` y `destroy: 1` (el archivo, el public_id) →
> `upload(file, opciones)`; pero **`ping: 0`** → `ping(opciones)`, con las opciones
> **primeras**.
>
> Ponerlas en el lugar equivocado no da error de tipos: el objeto se toma como callback y la
> llamada se resuelve contra la config global. Con cuenta de plataforma cargada eso devuelve
> `ok` **para cualquier credencial inventada**; sin ella revienta con `Must supply cloud_name`,
> que el usuario ve como "Cloudinary rechazó esas credenciales" teniendo las credenciales
> correctas. Pasó en producción el 2026-08-19, con la suite en verde: el test mockea el paquete
> entero, así que fijaba la convención inventada en vez de la real. Hoy lo fija el describe
> "el orden de los argumentos de api.ping", que va contra el SDK de verdad.

Las credenciales resueltas se cachean en un `Map` de proceso, con TTL de 60 s **además** de la
invalidación explícita que hace `TenantConfigModel.update`: la invalidación es por proceso y no
alcanzaría el día que haya más de una instancia.

### Reglas de la config

- **Van las tres o ninguna.** Lo dice el CHECK `TenantConfig_cloudinary_credentials_check` y un
  `superRefine` en `schemas/tenant-config.schema.js`. Media credencial cargada es un tenant que
  sube a ningún lado. No le pide nada raro al panel: el `api_secret` nunca vuelve en el `GET`, así
  que editar una sola nunca fue posible.
- **Las tres en `null`** = volver a la cuenta global.
- **Se validan al guardar** con `api.ping()`, y el resultado se parte en dos: si Cloudinary
  **contestó** rechazando (la respuesta trae `http_code`), es `400 CLOUDINARY_CREDENTIALS_INVALID`
  con `error.details = { status, reason }`; si **no se llegó** a Cloudinary (error de red, sin
  `http_code`), es `502 CLOUDINARY_UNREACHABLE`. En los dos casos **no se persiste nada**.

  La distinción no es cosmética: mientras las dos daban 400, un server sin salida a internet le
  decía a quien carga la cuenta que revisara un API secret que estaba perfecto. El `reason` es el
  mensaje del proveedor, con el `api_secret` tachado por si el proveedor lo ecoa.
- **Guardar exige la clave de cifrado.** `SECRET_ENC_KEY` (o el alias viejo
  `WHATSAPP_TOKEN_ENC_KEY`) se chequea ANTES del ping: sin ella el guardado iba a fallar igual, y
  hacerlo temprano evita el round-trip y devuelve `500 SECRET_ENC_KEY_MISSING` en vez del 500
  genérico que en producción no dice nada.
- **El `api_key` y el `api_secret` no salen nunca** por la API: están en
  `SECRET_TENANT_CONFIG_FIELDS`, que es la lista que `services/tenant-config.js` usa para las dos
  cosas —cifrar al escribir y excluir de la proyección pública—. El `cloud_name` sí vuelve, y le
  alcanza al panel para saber si el tenant tiene cuenta propia.

## La cuenta de la plataforma es opcional

Un tenant **sin credenciales cargadas** usa la cuenta del `.env`. Esa cuenta no es transitoria —queda
además para los templates de imágenes— pero **las tres variables son opcionales**, y vaciarlas es una
postura válida: en un deploy donde cada tienda tiene su cuenta, no tener ninguna es lo que garantiza
que ningún archivo de un cliente pueda terminar en la nuestra por accidente. Sin cuenta de plataforma
y sin cuenta del tenant, subir devuelve `409 CLOUDINARY_NOT_CONFIGURED` — un error de dominio y no el
`Must supply cloud_name` que tiraría el SDK, que del lado del panel se ve como un 500 sin explicación.
El mensaje nombra las **dos** salidas (conectar cuenta propia desde el panel, o cargar la de la
plataforma en el deploy) porque las dos faltan y el que lo lee no tiene cómo saber cuál le toca.

Las credenciales de esa cuenta se cargan de dos formas equivalentes: las tres variables sueltas, o
**`CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name`**, que es la línea que el dashboard de
Cloudinary da para copiar y pegar. Con las dos cargadas gana la explícita, para que una URL vieja
olvidada en el entorno no pueda cambiarle la cuenta a un deploy que ya tenía las tres. Que el alias
lo resuelva `ENV_CREDENTIALS` y no el SDK no es redundancia: el SDK parsea la URL al importar, pero
después `cloudinary.config({ ...ENV_CREDENTIALS })` la pisaba con `undefined` —el merge es un
`extend` de lodash, que copia los `undefined`—, y sobre todo `platformAccountConfigured()` seguía
diciendo que no hay cuenta. O sea: pegar la URL no hacía nada y el único síntoma era un 409 para
todos los tenants sin cuenta propia.

> [!warning] El orden importa si ya hay assets en la cuenta de la plataforma
> **Ver** las imágenes viejas sigue funcionando con las variables vacías: son URLs públicas y las
> sirve el CDN sin credenciales. Lo que se rompe es **borrar** una imagen vieja y **firmar** un
> comprobante viejo, porque las dos necesitan las credenciales de la cuenta donde el archivo está.
> O sea: primero la migración de assets, después vaciar.

**Un tenant con credenciales cargadas que no se pueden descifrar, en cambio, FALLA**
(`CLOUDINARY_CREDENTIALS_UNREADABLE`). Los dos casos parecen el mismo y no lo son: el primero eligió
la cuenta global; el segundo **cree que está usando la suya**. Degradar ahí sería mandarle los
archivos del cliente a nuestra cuenta sin que nadie se entere, que es exactamente lo que la cuenta
por cliente viene a evitar — y no se deshace solo: hay que encontrar los assets y moverlos. Es un
criterio distinto al de `resolveAccessToken` en `services/whatsapp/tenant-resolver.js`, que sí
degrada, y la diferencia es que allá el fallback manda el mensaje igual.

Lo que **no** falla es leer un asset que ya está en la cuenta global: `credentialsForCloudName`
resuelve ese caso sin mirar las credenciales del tenant, así que un comprobante viejo se sigue
abriendo aunque las nuevas estén rotas.

> [!note] Por qué esto no se puede llevar más lejos
> "Que no se muestren las imágenes si el tenant no tiene su cuenta" no es implementable del lado del
> backend: las imágenes de catálogo son URLs públicas absolutas guardadas en `Product.img` y el
> navegador las pide directo al CDN de Cloudinary — no estamos en el medio. Lo único que se podría
> hacer es no devolver la URL en la API, o sea un catálogo sin fotos, que es peor que el problema.
> Los comprobantes sí son gateables de verdad (se firman por request), pero cortar el acceso a un
> comprobante ya cargado no protege nada: el archivo lo subió el propio comercio.

## Los assets viejos se quedan donde están

Un cliente puede cargar su cuenta **después** de tener imágenes y comprobantes subidos. Esos no se
migran (decisión de producto). "No migrar" no es "no hacer nada": había dos caminos que se rompían
en silencio y están atendidos.

1. **Borrar una imagen de catálogo vieja.** `uploader.destroy` contra la cuenta del tenant devuelve
   `not found` **sin lanzar**, y el asset quedaría huérfano en la cuenta compartida para siempre.
   `deleteCloudinaryImage` reintenta contra `ENV_CREDENTIALS` cuando el resultado no es `ok`.
2. **Ver un comprobante viejo.** Peor: firmar con la cuenta equivocada no da error, da una URL que
   404ea al abrirla, y del otro lado hay un CBU que alguien necesita mirar. Por eso
   `OrderReceipt.cloudName` guarda en qué cuenta quedó cada archivo (`null` = la global), y
   `signedUrl`/`deleteFile` resuelven con `credentialsForCloudName`.

Lo que queda pendiente es la migración en sí: mientras no se escriba, el catálogo de un cliente que
cargó su cuenta está **partido entre dos cuentas**. Es más barato y más feo.

## Qué toca en el código

| Archivo | Qué hace |
| --- | --- |
| `lib/cloudinary.js` | la resolución de credenciales; sigue exportando el singleton como `default` |
| `lib/imageManager.js` | imágenes públicas de catálogo; las tres funciones reciben `tenantId` |
| `lib/storage/cloudinary.js` | comprobantes; `putFile` devuelve `cloudName`, `signedUrl` es **async** |
| `services/tenant-config.js` | cifra, valida con ping, invalida la cache de credenciales |
| `schemas/tenant-config.schema.js` | los tres campos, la regla de "van juntas", las dos listas |

`signedUrl` pasó a ser async porque firmar necesita el `api_secret` del tenant, que sale de la DB;
arrastra `toPublic()` en `services/order-receipts.js`. La carpeta de las imágenes de catálogo **no**
cambió (`{CLOUDINARY_FOLDER}/{entity}`, sin tenant): el aislamiento entre clientes ahora es la
cuenta. En `lib/storage/` la carpeta sí lleva el tenant, porque ahí lo que se separa son archivos
privados adentro de una misma cuenta.

## Cómo verificar

- `tests/cloudinary-per-tenant.test.js` cubre la resolución, el fallback, la cache, el reintento de
  borrado y los caminos HTTP (ping, secreto que no sale, las tres juntas).
- A mano, con el tenant **`acme`** —nunca `mesa-dulce`— y **sin correr `pnpm seed`** (hace TRUNCATE
  completo): cargar credenciales de una segunda cuenta, subir una imagen de producto y ver en qué
  dashboard de Cloudinary aterriza; subir un comprobante y abrir la URL firmada; comprobar que un
  comprobante subido **antes** de cargar las credenciales se sigue abriendo después.

## Lo que quedó afuera

- **La migración de los assets viejos** (ver arriba).
- **La pantalla de TenantConfig del panel.** Está vieja —muestra campos que ya no se corresponden
  con los que el admin puede modificar— y ahora además le faltan estos tres. Vive en el repo del
  frontend (`D:\mocks\e-commerce-nextjs\e-commerce-nextjs-1`), `apps/admin/app/dashboard/config`.
  Conviene hacer las dos cosas juntas y no tocar esa pantalla dos veces.

## Relacionado

- [[Órdenes]] §Comprobantes de transferencia — el puerto `lib/storage/` y `OrderReceipt.cloudName`.
- [[TenantConfig]] — cómo se derivan whitelist y `select` desde Zod.
- [[Producción sin cuentas (propuesta)]] — el otro documento de onboarding de clientes reales.
- `docs/ARCHITECTURE.md` §11 — lo que queda como GAP.
