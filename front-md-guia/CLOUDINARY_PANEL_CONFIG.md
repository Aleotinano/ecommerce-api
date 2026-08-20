# Panel: cuenta de Cloudinary por tenant — contrato del backend

> Pegá este archivo entero como contexto en el chat del frontend. Está escrito para que
> alguien que no vio el backend pueda armar o corregir la pantalla sin adivinar nada.

## Qué hay que hacer

En la pantalla de configuración del tenant (panel admin) hay un formulario donde el cliente
carga **su propia cuenta de Cloudinary**: cloud name, API key y API secret. El backend ya
funciona; lo que sigue son el contrato exacto y tres ajustes de UI que hacen falta.

Contexto de producto: cada cliente que sale a producción usa su propia cuenta de Cloudinary
para que sus imágenes no vivan en la nuestra. Si no carga ninguna, se usa la cuenta global
de la plataforma (y si la plataforma tampoco tiene, no puede subir imágenes).

---

## El endpoint

```
PATCH /tenant-config/:tenantId
```

- **Auth**: cookie de sesión (`httpOnly; Secure; SameSite=None`), rol `ADMIN`. El fetch va
  con `credentials: "include"`.
- **Content-Type**: `application/json`.
- Es un PATCH parcial: **sólo mandá los campos que cambiaron**.

### Body de las credenciales

```json
{
  "cloudinaryCloudName": "dqukj1pac",
  "cloudinaryApiKey": "123456789012345",
  "cloudinaryApiSecret": "aBcD-efGh1234..."
}
```

| Campo | Tipo | Reglas |
|---|---|---|
| `cloudinaryCloudName` | `string \| null` | trim, 1–100 chars |
| `cloudinaryApiKey` | `string \| null` | trim, 1–100 chars |
| `cloudinaryApiSecret` | `string \| null` | trim, 1–200 chars |

**Las tres van juntas, siempre.** O las tres con valor, o las tres en `null` (que significa
"desconectar mi cuenta y volver a la global"). Mandar una sola o dos es un 400 de
validación. No hay forma de editar sólo el cloud name.

Esto no es una restricción caprichosa: media credencial cargada es un tenant que sube a
ningún lado, y el error aparecería recién cuando alguien intente subir una foto.

El formato **no** se valida con regex a propósito: quien decide si sirven es Cloudinary, con
un ping real que el backend hace **antes** de guardar. Si el ping falla, no se persiste nada.

---

## El GET, y por qué importa para el form

```
GET /tenant-config/:tenantId
```

Devuelve `cloudinaryCloudName` (no es secreto: le sirve al panel para mostrar si el tenant
ya tiene cuenta propia), pero **nunca** `cloudinaryApiKey` ni `cloudinaryApiSecret`. Ni
siquiera cifrados.

Consecuencia directa para la UI: al abrir la pantalla, los campos de key y secret están
**siempre vacíos**, aunque el tenant tenga cuenta cargada. No se pueden prellenar. Entonces:

- Mostrá el estado con el cloud name ("Conectado a `dqukj1pac`"), no con los campos.
- Para cambiar cualquier cosa hay que reescribir las tres.
- El submit se habilita sólo con las tres completas (o con las tres vacías, si es
  "desconectar").

### ⚠️ No hagas PATCH del payload completo del GET

El GET devuelve varios campos que el PATCH **rechaza explícitamente** con un 400:

```
storeMode, paymentMethodsEnabled, fulfillmentMethodsEnabled,
depositEnabled, depositPercentage, cashRegisterEnabled
```

Son campos de flujo de venta que configuramos nosotros, no el tenant. Si el form hace
"traigo todo con GET, edito un campo, mando todo con PATCH", se come un 400 y no guarda
nada. Mandá sólo lo que cambió.

(`id` y `logoUrl` sí se pueden mandar sin romper: se ignoran.)

---

## Las respuestas, y qué mostrar en cada una

Hay **dos formas distintas** de error según de dónde venga. Manejá las dos.

### Éxito — 200

```json
{ "message": "Configuración actualizada", "config": { "...": "la config completa" } }
```

### Error de validación (Zod) — 400

Formato **sin** envoltura `error`, con los mensajes por campo:

```json
{
  "message": "Error de validacion",
  "errors": {
    "cloudinaryApiKey": ["Las credenciales de Cloudinary se mandan las tres juntas (cloud name, API key y API secret)"]
  }
}
```

Pintá cada mensaje debajo de su campo.

### Errores de negocio — formato con envoltura

```json
{ "error": { "message": "...", "code": "...", "details": { } } }
```

| Status | `code` | Qué pasó | Qué mostrar |
|---|---|---|---|
| 400 | `CLOUDINARY_CREDENTIALS_INVALID` | Cloudinary **contestó** rechazando | El `message`, **más `details.reason`** en letra chica: es el texto literal de Cloudinary (`unknown api_key`, `Invalid Signature`…) y `details.status` el HTTP que devolvió. Sin eso, el usuario no tiene cómo saber cuál de los tres campos está mal |
| 502 | `CLOUDINARY_UNREACHABLE` | **No se pudo llegar** a Cloudinary (DNS, timeout, red del server) | El `message` tal cual. **No digas "credenciales inválidas"**: puede que estén perfectas. Ofrecé reintentar |
| 500 | `SECRET_ENC_KEY_MISSING` | Al server le falta la clave de cifrado en su `.env` | Es un problema de configuración del deploy, no del usuario. Mensaje de "no se puede guardar ahora, avisá al equipo" |
| 404 | `TENANT_NOT_FOUND` | El tenant no existe | — |

La distinción 400 vs 502 es nueva y es el motivo de esta guía: antes **todo** salía como 400
"revisá cloud name, API key y API secret", incluso cuando el problema era que el server no
llegaba a Cloudinary. Si la UI colapsa los dos casos en un mensaje fijo, se pierde.

---

## Los tres ajustes concretos

1. **Manejar el 502.** Si hoy hay un mensaje hardcodeado tipo "credenciales inválidas" para
   cualquier fallo, reemplazalo por el `error.message` del body y ramificá por `error.code`.

2. **Mostrar `error.details.reason`** cuando venga, debajo del mensaje principal. Es lo que
   convierte "falló" en "Cloudinary dice: unknown api_key".

3. **Aclarar qué es el cloud name.** Es la trampa que ya nos costó un día de debugging: en
   el dashboard de Cloudinary, el cloud name **no** es el nombre lindo del "product
   environment" que se ve arriba, sino el string que aparece **después de la `@`** en la
   variable que Cloudinary muestra:

   ```
   CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@dqukj1pac
                                                      ^^^^^^^^^ esto
   ```

   Poné eso como hint o placeholder del campo. De paso, esa misma línea trae los otros dos
   valores, así que el hint puede explicar los tres a la vez.

---

## Notas

- Armá la pantalla con los componentes reutilizables del design system, no con markup suelto.
- El API secret es un secreto: campo tipo password, y no lo loguees ni lo metas en la URL.
- Después de un 200, el cloud name que devuelve `config` es la fuente de verdad para pintar
  el estado de conexión — no lo asumas del valor que tipeó el usuario.
