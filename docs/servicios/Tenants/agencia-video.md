---
tags: [tenant, agencia-video, carta, servicios, variantes]
estado: en-preparacion
ultima-revision: 2026-10-03
lado: backend
---

# Agencia Video

> [!note] Qué es
> Agencia de **edición de video**: Reels y TikTok, YouTube, podcasts en video, casamientos y
> 15, spots e institucionales. Es el **primer tenant que vende servicios y no productos**, y
> el primero de la plantilla de servicios del storefront (`storefronts/servicios/` en el repo
> del front): la landing muestra cada servicio con su precio por plan y el equipo, y se cotiza
> por WhatsApp.

> [!warning] Los precios son de referencia
> `servicios.json` arranca con `preciosConfirmados: false`: los números son una propuesta para
> maquetar, no la lista del negocio. El seed los carga igual (es una carta, no se cobra nada
> online) pero **avisa en cada corrida** hasta que el flag pase a `true`. Es la excepción
> consciente a [[new-tenant-config]] §6: el dueño del tenant es parte del equipo y pidió ver la
> página armada; el aviso es lo que impide que la propuesta quede como lista real por olvido.

## Qué es para el sistema

| | |
| --- | --- |
| Slug | `agencia-video` (sale del `--name "Agencia Video"` del alta) |
| Perfil de venta | `carta` → `storeMode: MENU`: no hay carrito ni checkout, se cotiza por WhatsApp |
| Catálogo | 13 servicios `PRODUCTO` con 27 planes (variantes) |
| Categorías | 5, todas raíces hoja: las líneas de servicio |
| Atributos de variante | `plan` — `productVariantsEnabled: true` |
| Stock | 0 en todos los planes + `showOutOfStock: true` (criterio de carta) |
| `storeName` | El del alta; el nombre real de la agencia se cambia desde el panel |

## Cómo se modela un servicio

| Concepto del negocio | Modelo | Ejemplo |
| --- | --- | --- |
| Línea de servicio | Categoría raíz | Redes sociales, Eventos |
| Servicio | `Product` tipo `PRODUCTO` | Edición de Reels y TikTok |
| Plan / paquete | `ProductVariant` con `{"plan": "..."}` y su precio | Pack 4 videos — $90.000 |

Un servicio con un solo plan **también** lleva el atributo (`{"plan": "Hasta 3 min"}`): en una
lista de precios el plan no es decorativo, es lo que se cotiza, y la landing lo muestra al lado
del precio. La variante `isDefault` es el primer plan del JSON (el de entrada).

El **equipo (staff) no vive acá**: no hay modelo para eso. Está en el `content.ts` del tenant en
el storefront, igual que las casas de Cafe Sublime en su landing. Si se quiere editar desde el panel, el
camino es un JSON en `TenantConfig` — ver "Lo que este tenant deja expuesto".

## Cómo se construye

```bash
pnpm tenant:create --name "Agencia Video" --email <email> --profile carta
pnpm seed:agencia-video     # categorías -> atributos -> servicios -> config
```

`prisma/agencia-video/servicios.json` **es la lista de precios** y se edita a mano: no hay
`build-menu.js` porque no hay dump de cliente que reorganizar ni matriz que expandir. El SKU va
escrito en el JSON (`AV-REELS-X4`) y es la identidad del plan: cambiar el `name` del servicio o
el texto del `plan` actualiza en el lugar; cambiar un `sku` crea un plan nuevo y el viejo queda
huérfano (el seed lo avisa y no lo borra).

El JSON se **valida entero antes de escribir nada**: categoría inexistente, SKU repetido o de
más de 60, descripción de más de 600, o un precio que no sea un entero positivo. Lista todos los
problemas juntos.

Todos los pasos son idempotentes (verificado: la segunda corrida da "13 ya al día, 0 planes
creados, 0 actualizados").

## Pendientes

1. **Confirmar precios** y pasar `preciosConfirmados` a `true`.
2. **Email del dueño** para el alta real (el primer ADMIN).
3. **Contacto** en el panel: `socialWhatsapp` (con el 9 de móvil, `549…`), `socialInstagram`,
   `socialTiktok`, `socialYoutube`, `contactEmail`. `config.js` los **omite** en vez de ponerlos
   en null, para no borrar lo cargado desde el panel. Mientras falte el WhatsApp, el storefront
   usa su número de respaldo.
4. **Nombre de la agencia** → `storeName` desde el panel.
5. **Qué incluye un precio** (rondas de cambios, plazos, seña): no hay campo; va como nota en
   el storefront o en `returnsPolicy`/`shippingPolicy` si hace falta texto largo.

## Lo que este tenant deja expuesto

- **No hay modelo de staff.** Tres caminos, de menor a mayor obra: `content.ts` del front (lo
  de hoy, pide deploy), un `Json?` en `TenantConfig` (`storefrontTeam`) validado por el schema
  Zod como el resto, o un modelo `TeamMember` propio si algún día se asignan órdenes a personas.
- **Un servicio no tiene "duración" ni "entrega en X días".** Si la landing lo necesita como
  dato y no como texto de la descripción, es un atributo más (`entrega`) o un campo del producto.
- **El modo `MENU` no tiene una variante "cotización"**: el pedido se cierra por WhatsApp y, si
  se quiere registrar, se carga desde el mostrador (`POST /orders`), que en modo carta sigue
  funcionando a propósito. Si mañana se quiere cobrar una seña online, el perfil es
  `produccion-por-sena` — y entonces el stock deja de poder ser 0.

## Dependencias

- [[new-tenant-config]] — el pipeline de alta.
- [[Perfiles de flujo de venta]] — perfil `carta`.
- [[Variantes]] — el atributo `plan`.
- [[pastaia]] — de donde sale la forma de los seeds (idempotentes por SKU, stock que no se pisa).
