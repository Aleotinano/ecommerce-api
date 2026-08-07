---
lado: contrato
---

# Frontend: timeline de Sugerencias de Contenido (`GET /content-suggestions`)

Endpoint para dibujar la **timeline** de los últimos N días. Devuelve el **rango
completo**: los días sin sugerencia vienen igual con `suggestion: null`, así el
front pinta placeholders sin inventar nada.

> Panel Admin: ruta **sin prefijo**, auth por **cookie** httpOnly
> (`credentials: "include"`), rol **ADMIN/STAFF**. Scoped al tenant (sale del JWT).

---

## Request

```
GET /content-suggestions?range=7
```

| Query | Valores | Default | Notas |
|-------|---------|---------|-------|
| `range` | `7` \| `15` \| `30` | `7` | Otro valor → **400**. Si se omite, usa 7. |

---

## Response `200`

```json
{
  "message": "Timeline de sugerencias obtenida correctamente",
  "range": 7,
  "days": [
    { "date": "2026-06-04", "hasSuggestion": false, "suggestion": null },
    {
      "date": "2026-06-05",
      "hasSuggestion": true,
      "suggestion": {
        "id": 7,
        "angle": "BEST_SELLER",
        "status": "SUGGESTED",
        "product": { "name": "Gorra vintage LA", "img": "https://..." },
        "copy": "¿Todavía no la tenés? …",
        "hashtags": ["#GorraVintage", "#SonidoTotal"]
      }
    }
  ]
}
```

- `days`: **siempre** `range` elementos, **ordenados ascendente**, con **hoy incluido**
  como último.
- `date`: string `"YYYY-MM-DD"`.
- `hasSuggestion`: `false` → `suggestion: null` (día vacío → placeholder).
- `suggestion.product.img` puede ser `null` (usar placeholder de imagen).
- `copy` / `hashtags` pueden venir vacíos si la sugerencia es muy vieja, pero
  normalmente están.

### Valores de enum (en MAYÚSCULAS)

- `angle`: `BEST_SELLER` · `NEW_ARRIVAL` · `LOW_STOCK` · `NO_RECENT_SALES`.
- `status`: `SUGGESTED` · `USED` · `DISMISSED`.

> ⚠️ **Hoy todas las sugerencias están en `SUGGESTED`.** El cambio de estado
> (`USED`/`DISMISSED`) es un endpoint aparte que todavía no existe; ya podés
> mapear los 3 valores en la UI, pero por ahora solo vas a ver `SUGGESTED`.

---

## Errores

| Código | Cuándo |
|--------|--------|
| 400 | `range` distinto de 7/15/30. |
| 401 | sin cookie / inválida. |
| 403 | rol insuficiente (requiere ADMIN/STAFF). |

---

## Ejemplo

```js
async function getTimeline(range = 7) {
  const res = await fetch(`/content-suggestions?range=${range}`, {
    credentials: "include",
  });
  if (res.status === 401 || res.status === 403) throw new Error("no-auth");
  if (res.status === 400) throw new Error("range inválido (7, 15 o 30)");
  const { days } = await res.json();
  return days; // array listo para la timeline (incluye días vacíos)
}
```

```bash
curl --cookie "access_token=<jwt-admin>" \
  "http://localhost:4000/content-suggestions?range=15"
```

---

## Notas de integración

- **Pintá todos los `days`**: los `hasSuggestion: false` son placeholders del
  calendario, no errores.
- El detalle/edición de cada día sigue siendo `GET /content-suggestions/today`
  para hoy (ver [FRONTEND_CONTENT_SUGGESTIONS.md](FRONTEND_CONTENT_SUGGESTIONS.md)).
- Sin cache del lado server: el rango refleja al instante los cambios.
