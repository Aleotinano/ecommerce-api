---
tags: [tenant, agencia-video, carta, servicios]
estado: en-preparacion
ultima-revision: 2026-10-03
lado: backend
---

# Agencia Video

> [!note] Qué es
> Agencia de **edición de video** (Reels y TikTok, YouTube, podcasts, eventos, publicidad). La
> landing muestra los servicios con su precio y el equipo, y se cotiza por WhatsApp.
>
> **Del lado del backend es solo el alta.** El catálogo de servicios, los precios, el branding
> y los textos los carga el equipo desde el panel; la landing se maqueta en el storefront.

## Qué es para el sistema

| | |
| --- | --- |
| Slug | `agencia-video` (sale del `--name "Agencia Video"` del alta) |
| Perfil de venta | `carta` → `storeMode: MENU`: sin carrito ni checkout, se cotiza por WhatsApp |
| `showOutOfStock` | `true` — los servicios se cargan con stock 0 y tienen que verse igual |
| `productVariantsEnabled` | `true` — un servicio con varios planes es un producto con variantes |
| `storeName` | El del alta; el nombre real de la agencia se cambia desde el panel |

## Cómo se crea

```bash
pnpm tenant:create --name "Agencia Video" --email <email> --profile carta
pnpm seed:agencia-video     # solo prisma/agencia-video/config.js
```

`config.js` toca **solo** las perillas de operación (moneda, locale, `showOutOfStock`,
variantes). No declara nombre, textos, SEO ni contacto a propósito: `update: CONFIG` pisa todo
lo que declara, así que cualquier copy acá borraría en cada corrida lo cargado desde el panel.

## Cómo cargar los servicios desde el panel (sugerencia)

No hay modelo de "servicio": se usa el catálogo como lista de precios.

| Concepto del negocio | Modelo | Ejemplo |
| --- | --- | --- |
| Línea de servicio | Categoría raíz | Redes sociales, Eventos |
| Servicio | Producto `PRODUCTO` | Edición de Reels y TikTok |
| Plan / paquete | Variante con su precio (atributo `plan`) | Pack 4 videos |

Para usar variantes con nombre de plan, el tenant tiene que definir su catálogo de atributos
**una sola vez** (`POST /tenant-attributes` con `{ key: "plan", label: "Plan" }`): es one-time y
después no se puede cambiar la key. Stock en 0: en modo carta no gobierna nada.

## Pendientes

1. **Email del dueño** para el alta real (el primer ADMIN).
2. **Nombre de la agencia**, contacto (`socialWhatsapp` con el 9 de móvil, `549…`; Instagram,
   TikTok, YouTube) y textos: desde el panel.
3. **Servicios y precios**: desde el panel.

## Lo que este tenant deja expuesto

- **No hay modelo de staff.** El equipo vive en el storefront. Si se quiere editar desde el
  panel, el camino más corto es un `Json?` en `TenantConfig` validado por el schema Zod como el
  resto; un modelo `TeamMember` propio solo si algún día se asignan órdenes a personas.
- **Si mañana se quiere cobrar una seña online**, el perfil es `produccion-por-sena`, y ahí el
  stock deja de poder ser 0.

## Dependencias

- [[new-tenant-config]] — el pipeline de alta.
- [[Perfiles de flujo de venta]] — perfil `carta`.
- [[Variantes]] — el atributo `plan`.
