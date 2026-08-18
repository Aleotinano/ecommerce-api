import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";

/**
 * Corta las rutas de COMPRA del storefront cuando el tenant es una carta.
 *
 * `TenantConfig.storeMode` dice qué hace el cliente con el catálogo: en `SHOP` se
 * compra, en `MENU` se lee (restó, cafetería) y el pedido se cierra por fuera —
 * WhatsApp, mostrador—. Hasta acá eso lo apagaba **solo el storefront**, no
 * montando el carrito, lo cual funciona mientras nadie escriba `/checkout` en la
 * barra de direcciones.
 *
 * Se monta sobre `/store/cart` y `/store/orders` (routes/store/index.js), después
 * de `resolveTenantFromSlug`, que es quien deja `req.tenantId`.
 *
 * **No toca el mostrador del admin (`POST /orders`) ni los borradores del bot**
 * (`OrderModel.createDraft`): el modo describe qué puede hacer el CLIENTE, no que
 * el local no pueda registrar una venta ni usar la caja. La segunda llave, en
 * `OrderModel.create`, filtra por `origin === "STORE"` por la misma razón.
 */
export async function requireShopMode(req, _res, next) {
  try {
    const config = await prisma.tenantConfig.findUnique({
      where: { tenantId: req.tenantId },
      // A la base y no a `TenantConfigModel.get` (cacheado 600 s), igual que el
      // guard de caja: de este flag depende un guard, y un cache de diez minutos
      // son diez minutos vendiendo después de apagar la tienda.
      select: { storeMode: true },
    });

    // Sin fila de config el tenant se comporta como siempre (`SHOP` es el default
    // de la columna): un tenant a medio configurar no puede quedar sin vender.
    if (config?.storeMode !== "MENU") return next();

    // 404 y no 403: para este tenant el carrito no existe, no es que le falten
    // permisos. Mismo criterio que `CASH_REGISTER_DISABLED`. El código es lo que
    // le permite al front distinguirlo de un 404 de ruta.
    return next(
      createError(
        "Esta tienda no vende online: su catálogo es una carta",
        "STORE_MODE_MENU",
        404
      )
    );
  } catch (err) {
    next(err);
  }
}
