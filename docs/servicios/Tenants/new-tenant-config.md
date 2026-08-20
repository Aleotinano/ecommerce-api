---
tags: [tenants, onboarding, patrón]
estado: vigente
ultima-revision: 2026-08-04
lado: backend
---

# Dar de alta un tenant nuevo

> [!note] Para qué es este doc
> El patrón de alta destilado de los tenants que ya pasamos por acá (mesa-dulce, cafe-sublime,
> maikai). Es una receta, no una referencia: si algo de acá contradice al código, gana el código
> — pero decilo en la próxima revisión.

## 1. Los cuatro pasos

```bash
pnpm tenant:create --name "<Nombre>" --email <email-del-dueño> --profile <perfil>
```

Crea el tenant, su primer ADMIN y la fila de `TenantConfig` (sin esa fila, la pantalla de
configuración tira 404). Llama a `UserModel.register({ trusted: true })`, el mismo service
que usa `POST /auth/register`. La contraseña se genera al azar y se imprime **una sola
vez**; si querés fijar una, va por `ADMIN_PASSWORD` en el entorno, nunca como argumento
(los argumentos quedan en el historial del shell y en la lista de procesos).

> [!warning] "El registro está apagado" es una decisión de producto, no del código
> Esta sección decía que `POST /auth/register` estaba apagado. **No lo está**: la ruta
> sigue montada, con su rate limiter, y responde. Lo que hay es la decisión de que los
> clientes compren sin cuenta y las credenciales de admin se entreguen a mano — el plan
> está en [[Producción sin cuentas (propuesta)]] y su primer pendiente es justamente
> cablear `customerAccountsEnabled`, que todavía no existe en el schema. Hasta entonces,
> el alta por consola es una comodidad, no el único camino.

Después:

2. **Carpeta `prisma/<slug>/`** con los scripts de datos: `categorias.js`, `productos.js`,
   `config.js`, `index.js`. Idempotentes y corribles por separado.
3. **Scripts en `package.json`**: `seed:<slug>` y uno por paso.
4. **Verificar** (sección 8).

> [!danger] `pnpm seed` no es para esto
> `prisma/seed.js` arranca con un `TRUNCATE … RESTART IDENTITY CASCADE` de toda la base. Es el
> seed de los tenants de demo (acme, shopco, mesa-dulce). **Un tenant real nunca vive ahí.**

## 2. Elegir el perfil de flujo de venta

Los cuatro de `services/tenant-profiles.js`. Se materializan en columnas al crear el tenant: el
perfil es un punto de partida, no una indirección viva.

| Perfil | Cuándo | Qué hace |
| --- | --- | --- |
| `estandar` | Default. Se compra online, se paga entero | Todo habilitado, sin seña |
| `contraentrega` | El repartidor cobra al entregar | Solo CASH, solo DELIVERY |
| `produccion-por-sena` | Producen a pedido y necesitan plata antes | Seña del 50% para pasar a producción |
| `carta` | **Se lee, no se compra** — restó, cafetería | `storeMode: MENU`, sin carrito ni checkout |

Las dos preguntas que lo deciden, en orden: **¿se compra o se lee?** (si se lee → `carta`, no
mires nada más). **¿Producen a pedido?** (si sí → `produccion-por-sena`).

Se corrige después con `node prisma/set-tenant-profile.js <slug> <perfil>`, y sin argumentos
lista los perfiles y en qué flujo está cada tenant. No reescribe órdenes ya creadas.

## 3. Reorganizar el catálogo que manda el cliente

Suele llegar un dump JSON de su web actual. **No se carga como viene.** Las reglas, en el orden
en que conviene aplicarlas:

- **Buscar categorías espejo.** Una categoría cuyos productos ya existen todos, con el mismo
  precio, en otras. En Maikai, "Almuerzos" (20 productos) era el espejo de Pastas + Ensaladas +
  Menú Ejecutivo. Se descarta entera.
- **Deduplicar por nombre normalizado** — NFD, sin acentos, sin puntuación, minúsculas. Sin eso,
  "Bagel Ibérico" y "Bagel Iberico" entran los dos. Cuando el duplicado trae **precios
  distintos**, no lo resuelve el algoritmo: hay que declarar cuál gana y anotarlo como dato a
  confirmar con el cliente.
- **Máximo 2 niveles** (raíz + hija). Es lo que usan todos los tenants y lo que el storefront
  tiene probado.
- **`position` explícita en todas**, por nivel: las raíces entre sí, y las hijas dentro de su
  padre. Es lo único que gobierna el orden de la carta.
- **Fusionar las categorías de 1–2 productos.** "Vinos" con un solo vino no es una sección.
- **Un producto nunca cuelga de una raíz que tiene hijas.** O la raíz es hoja (Pastas, Brunch),
  o todos sus productos están en alguna hija.

La reorganización va **en código**, no editando el JSON a mano: `prisma/<slug>/build-menu.js`
lee el dump crudo, aplica el mapa y escribe el `menu.json` que consumen los seeds. Así el
criterio queda revisable y se puede volver a correr cuando llegue un dump nuevo. El `menu.json`
resultante se commitea y **ese** es el que se edita a mano para un cambio de precio suelto.

## 4. Las raíces salen de la home, no del dump

La lección cara de Maikai: el catálogo se reorganizó dos veces porque la primera fue antes de
ver el diseño de la landing.

**Si la home abre con un grid de tiles de categoría, esos tiles SON las categorías raíz.**
Primero se define cuántos entran en el grid, después se reparte el menú. Al revés se rehace.

Corolario: las raíces necesitan `Categories.imageUrl` (la foto del tile) e `icon`. Si las fotos
todavía no están, el seed las deja en `null` y se cargan aparte — pero conviene pedirlas en la
misma conversación en que se pide el menú.

## 5. Convención de SKU

`<PREFIJO>-<SLUG-DEL-NOMBRE>` en mayúsculas, sin acentos. Por ejemplo `MK-CIABATTA-DE-MILANESA`.

Derivado del **nombre**, nunca de un índice ni del orden del archivo: es lo que hace que
reordenar el menú no cambie la identidad de un producto, y por lo tanto lo que hace que el seed
pueda ser idempotente por SKU. Sufijo `-2` para las colisiones.

## 6. Qué no inventar

Stock, handles de redes sociales, composición de combos, horarios. Si el dato no vino, va `null`
y queda anotado como pendiente. El precedente es [[mesa dulce demo]], donde 15 productos
quedaron en `stock: 0` porque el stock real es un dato de negocio que no nos corresponde definir
— y eso se anotó en vez de rellenarlo.

> [!note] Anotarlo no es lo mismo que dejarlo roto
> Con el default `showOutOfStock: false`, ese catálogo entero en 0 se veía **vacío**, y armar
> un combo fallaba con `409 INSUFFICIENT_STOCK`. Cuando el negocio no lleva inventario —produce
> por encargo— la salida no es inventar un número ni dejar 0: es **stock alto +
> `showOutOfStock: true`**, que es decir "el stock no gobierna nada acá". Lo hacen [[pastaia]]
> (999 por variante) y [[mesa-dulce]]. Y en los dos el seed **no vuelve a tocar el stock** en un
> rerun, por si algún día sí lo manejan desde el panel.

En un tenant `carta` el stock no gobierna nada (no nacen órdenes), así que va `stock: 0` y
`showOutOfStock: true`. Nadie lee un número inventado como si fuera real.

## 7. Trampas verificadas

- **`Categories` tiene `@@unique([tenantId, name])` — global, no por padre.** Dos "Clásicos"
  bajo padres distintos NO entran. Es la que más rompe seeds de menús de restaurante, donde
  "Clásicos" o "Especiales" aparece bajo varias secciones.
- **En un `PRODUCTO` el precio vive en la variante `isDefault`**, y `Product.price` es `null`.
  `Product.price` es exclusivo de `COMBO`.
- **Usar `CategoryModel` / `ProductModel`, no `prisma.*` directo.** Si no, el cache de Redis
  queda sucio. Y cerrar con `closeRedis()` o el script no termina nunca.
- **`showOutOfStock: false` es el default** y esconde todo lo que esté en `stock: 0`. Un
  catálogo entero en 0 con el default puesto se ve vacío.
- **`storeMode: MENU` lo aplica el backend desde 2026-08-07, pero solo en el storefront.**
  `/store/cart` y `/store/orders` responden 404 `STORE_MODE_MENU`; `POST /orders` (el mostrador
  del admin) y los borradores del bot **siguen funcionando a propósito**, porque en una carta el
  pedido se cierra por fuera y alguien lo tiene que poder anotar. El front igual sigue leyendo
  `storeMode` del `GET /tenant-config/:tenantId` (público, `attachUser` y no `verifyToken`) para
  no dibujar un carrito que el server va a rechazar.
- **En modo `MENU`, `paymentMethodsEnabled` y `fulfillmentMethodsEnabled` quedan poblados a
  propósito.** No gobiernan nada ahí; el campo que define qué es el tenant es `storeMode`, uno
  solo. Vaciarlos obligaría a `OrderModel.create` a distinguir "sin métodos habilitados" de "no
  vende".
- **`TenantConfig` no tiene campo de horarios de atención.** Hasta que la landing le dé un lugar
  propio, el horario va embebido en `storeDescription` / `seoDescription`.
- **El árbol de categorías se pide a `/store/categories/tree`**, no a `/store/categories` — ese
  devuelve la lista plana, sin `children`, y ordenada por `position` global (o sea, mezclada).
- **`/store/products` tiene `limit` máximo 100.** Para contar un catálogo grande hay que paginar.

## 8. Checklist de verificación

```bash
pnpm <slug>:build-menu          # el resumen impreso tiene que dar los conteos esperados
pnpm seed:<slug>                # primera corrida: crea
pnpm seed:<slug>                # segunda: TODO "ya está al día". Si crea algo, no es idempotente
node prisma/set-tenant-profile.js   # el tenant tiene que aparecer con el flujo correcto
pnpm test
```

Y por HTTP, con `X-Tenant-Slug: <slug>`:

- `GET /store/categories/tree` → las raíces en orden, con sus hijas.
- `GET /store/products?categoryId=<id>` → precio y descripción de una categoría de muestra.
- `GET /store/products?limit=100&offset=…` → el total del catálogo (confirma `showOutOfStock`).
- `GET /tenant-config/<tenantId>` → contacto, branding y `storeMode`.

## Ejemplo completo

[[maikai]] es la referencia más completa del lado de la CARTA: dump crudo → `build-menu.js` →
`menu.json` → seeds, todo en `prisma/maikai/`. Perfil `carta`, 8 raíces, 251 productos. Su
ficha tiene el detalle de qué se le hizo al menú del cliente y por qué.

[[punto-healthy]] es la referencia del lado de la TIENDA y la más reciente (2026-08-10):
mismo pipeline en `prisma/punto-healthy/`, pero perfil `estandar` y un catálogo que además
tiene variantes (packs y sabores) y 11 combos. Mirala si el tenant nuevo vende: ahí están el
criterio de stock inicial en modo SHOP, los dos patrones de whitelist de combo y cuál elegir,
y las tres cosas de una carta que el modelo todavía no representa.

> [!question] Quién está en cada modo, hoy
> `node prisma/set-tenant-profile.js` sin argumentos lo lista. Al 2026-08-07: `maikai` y
> `cafe-sublime` en carta; `acme`, `shopco`, `mesa-dulce` y **`shifu`** en tienda. Lo de
> shifu conviene mirarlo: es el restaurante por reserva que motivó el modo `MENU` —así lo
> cuenta la migración `20260804120000_tenant_store_mode`— y quedó en `SHOP`. Puede ser que
> su front ya resuelva el asunto no montando el carrito, que es exactamente lo que este
> campo vino a dejar de hacer a mano. A confirmar antes de tocarlo.
