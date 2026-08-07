---
lado: contrato
---

# Guía frontend: Sugerencias de Contenido

Referencia de API para construir la pantalla de **Sugerencias de Contenido** del panel admin.

Cada día, el backend arma **una** sugerencia de publicación por tenant para sus redes: elige
**qué producto destacar** según las ventas/stock reales del tenant (4 ángulos que rotan) y un LLM
redacta el **copy** y los **hashtags** con el tono de marca (`TenantConfig`). La **imagen sale del
catálogo**, no se genera. El usuario **revisa y publica él mismo**: el front **no** auto-postea ni
toca la API de Meta — solo muestra, deja editar/copiar y listo.

> Es feature de **Panel Admin** (ver [FRONTEND_INTEGRATION.md](FRONTEND_INTEGRATION.md)):
> rutas **sin prefijo**, auth por **cookie** httpOnly (`withCredentials: true`), rol **ADMIN/STAFF**.
> No es storefront: no lleva Bearer ni `X-Tenant-Slug`.

---

## 1. Endpoint

| Método | Ruta | Auth | Notas |
|--------|------|------|-------|
| GET | `/content-suggestions/today` | cookie, ADMIN/STAFF | sugerencia del día (se crea on-demand si no existe) |

**Una sola sugerencia por tenant por día.** El `tenantId` sale del JWT en la cookie; el front no lo manda.

### Comportamiento on-demand (importante para la UX)

- La **primera** llamada del día **genera** la sugerencia: selecciona el producto y llama al LLM.
  Eso puede tardar **~1–3 s** → mostrá un **estado de carga** (spinner / skeleton de la card).
- Las llamadas siguientes del mismo día devuelven **la misma** sugerencia (es idempotente y está
  cacheada). Refrescar la página no genera una nueva ni cambia el texto.
- No hay endpoint de "regenerar" todavía: lo que se ve es lo del día. (Si el usuario quiere otro
  texto, que lo edite en el front antes de copiar.)

---

## 2. Respuesta

`GET /content-suggestions/today` → `{ message, suggestion }`:

```json
{
  "message": "Sugerencia del dia obtenida correctamente",
  "suggestion": {
    "id": 7,
    "angle": "BEST_SELLER",
    "date": "2026-06-09T00:00:00.000Z",
    "copy": "¿Todavía no la tenés? La gorra vintage LA es la más elegida de la temporada 🧢",
    "hashtags": ["#GorraVintage", "#SonidoTotal", "#MasVendido"],
    "model": "gemini-2.0-flash",
    "generatedAt": "2026-06-09T13:20:11.000Z",
    "createdAt": "2026-06-09T13:20:11.000Z",
    "updatedAt": "2026-06-09T13:20:11.000Z",
    "product": {
      "id": 9,
      "name": "Gorra vintage LA",
      "description": "Gorra de gabardina con visera curva",
      "price": 8500,
      "img": "https://res.cloudinary.com/.../gorra.jpg",
      "imgPublicId": "e-commerce-express/...",
      "category": { "id": 3, "name": "Accesorios" }
    }
  }
}
```

| Campo | Tipo | Para qué sirve en la UI |
|-------|------|--------------------------|
| `angle` | enum | **badge** del ángulo (ver tabla §3). Explica *por qué* se eligió ese producto. |
| `copy` | string | el texto de la publicación. Mostralo en un **textarea editable**. |
| `hashtags` | string[] | **chips**. Cada uno ya viene con `#`. Pueden ser 0–6. |
| `product.img` | string \| null | **imagen** de la publicación (del catálogo). Si es `null`, placeholder. |
| `product.name` / `description` / `price` / `category` | — | contexto del producto en la card. |
| `model` | string \| null | qué generó el copy. **`null` = fallback por template** (ver §4). |
| `generatedAt` | ISO | cuándo se generó (podés mostrar "Sugerencia del {date}"). |
| `date` | ISO (solo día) | el día de la sugerencia. |

> `copy` **nunca** llega vacío: si el LLM falla, el backend persiste igual un copy por template
> (el usuario siempre ve algo). Ver §4.

---

## 3. Ángulos (`angle`)

El ángulo es **por qué** el backend eligió ese producto. Mostralo como badge con color/tono
(podés reusar la paleta de los labels del dashboard de stats):

| Valor | Label sugerido | Tono | Significado |
|-------|----------------|------|-------------|
| `BEST_SELLER` | "Más vendido" | danger / rojo | el producto con más unidades vendidas (COMPLETED, últimos 30 días). |
| `NEW_ARRIVAL` | "Recién llegado" | info / azul | el producto más nuevo del catálogo (`createdAt`). |
| `LOW_STOCK` | "Stock bajo" | warning / ámbar | el stock total (sumando variantes activas) está por agotarse. |
| `NO_RECENT_SALES` | "Sin ventas recientes" | neutral / gris | producto con stock pero sin ventas en 30 días: para reflotar. |

Los ángulos **rotan** día a día (no se repite el de ayer), así que el badge va cambiando.

---

## 4. Copy generado vs. fallback (`model`)

- `model` con valor (`"gemini-2.0-flash"`, `"claude-haiku-4-5"`, …) → el copy lo escribió el LLM.
- `model: null` → el LLM no estaba disponible (sin API key, error de red, o JSON inválido) y el
  backend usó un **copy de template** para que la sección nunca quede vacía.

Sugerencia de UI: cuando `model === null`, mostrá un hint sutil tipo *"Borrador automático —
revisalo antes de publicar"*. En ambos casos el copy es **editable**: el valor agregado es que el
usuario lo retoque y lo copie.

---

## 5. Componente sugerido — "Sugerencia del día"

Una sola **card** centrada en la acción de copiar-y-publicar:

```
┌─────────────────────────────────────────────┐
│  [img producto]   Gorra vintage LA            │
│                   Accesorios · $8.500          │
│                   [ badge: Más vendido ]       │
│-----------------------------------------------│
│  Copy (editable):                              │
│  ┌───────────────────────────────────────┐    │
│  │ ¿Todavía no la tenés? La gorra ... 🧢 │    │
│  └───────────────────────────────────────┘    │
│  Hashtags:  #GorraVintage  #SonidoTotal  ...   │
│-----------------------------------------------│
│  [ Copiar texto ]   [ Copiar imagen / link ]   │
│  Generado con gemini-2.0-flash · 09/06/2026    │
└─────────────────────────────────────────────┘
```

Acciones recomendadas:

- **Copiar texto**: copia `copy` + `"\n\n"` + `hashtags.join(" ")` al portapapeles
  (`navigator.clipboard.writeText`). Es el botón principal.
- **Copiar imagen / link**: copia `product.img` (o descarga la imagen) para subirla a la red.
- **Editar copy**: textarea controlado, inicializado con `copy`. No hay endpoint para guardar la
  edición (es para copiar antes de publicar); persistirla podría ser una mejora futura.
- **Hashtags**: chips; opcional permitir quitar/agregar localmente antes de copiar.

Estados de la pantalla:

| Estado | Cuándo | Qué mostrar |
|--------|--------|-------------|
| **Loading** | mientras resuelve el `GET` (puede generar) | skeleton de la card / spinner con "Generando la sugerencia de hoy…" |
| **OK** | 200 | la card de arriba |
| **Sin candidato** | 422 `NO_SUGGESTION_CANDIDATE` | empty state: "Todavía no hay productos para sugerir. Cargá productos al catálogo." |
| **Sin permiso** | 401 / 403 | redirigir a login / mensaje de acceso |

---

## 6. Errores a manejar

| Código | Code | Cuándo |
|--------|------|--------|
| 401 | — | sin cookie / cookie inválida o expirada (admin). |
| 403 | — | rol insuficiente (requiere ADMIN/STAFF) o token de otro tenant. |
| 422 | `NO_SUGGESTION_CANDIDATE` | el tenant no tiene ningún producto candidato (catálogo vacío). Empty state, no es un error "roto". |

> Notá que un fallo del LLM **no** es un error de la API: el backend degrada a fallback y responde
> 200 con `model: null`. El front no necesita manejar ese caso como excepción.

---

## 7. Ejemplo de integración

```js
// Panel admin → cookie httpOnly, withCredentials
async function getTodaySuggestion() {
  const res = await fetch("http://localhost:4000/content-suggestions/today", {
    credentials: "include", // manda la cookie access_token
  });

  if (res.status === 401 || res.status === 403) {
    // redirigir a login / mostrar acceso denegado
    throw new Error("no-auth");
  }

  const body = await res.json();

  if (res.status === 422) {
    // body.error.code === "NO_SUGGESTION_CANDIDATE" → empty state
    return { empty: true };
  }

  return body.suggestion; // { angle, copy, hashtags, product, model, ... }
}

function buildShareText(s) {
  return [s.copy, "", s.hashtags.join(" ")].join("\n");
}

async function copyToClipboard(s) {
  await navigator.clipboard.writeText(buildShareText(s));
}
```

```bash
# curl (cookie admin)
curl --cookie "access_token=<jwt-admin>" \
  http://localhost:4000/content-suggestions/today
```

---

## 8. Resumen para el front

- **Una card por día**, admin (cookie), rol ADMIN/STAFF.
- La primera carga del día **genera** → poné **loading** (puede tardar unos segundos); luego es
  idempotente y cacheada.
- Mostrá **imagen del catálogo + producto + badge de ángulo + copy editable + hashtags como chips**.
- Acción estrella: **Copiar texto** (`copy` + hashtags). El usuario publica manualmente.
- `model: null` = borrador por template → hint "revisalo antes de publicar".
- `422 NO_SUGGESTION_CANDIDATE` = catálogo sin candidatos → empty state, no error.
