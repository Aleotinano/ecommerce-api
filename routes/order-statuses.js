import { Router } from "express";
import { listPublicStatuses } from "../services/order-status.js";

export const orderStatusesRouter = Router();

/**
 * Catálogo de estados de orden: código, lugar en el pipeline, si lo mueve una
 * persona, a dónde puede ir, y cómo se llama para el panel y para el cliente.
 *
 * **Sin auth y sin tenant**, a diferencia de todo el resto: es una tabla estática
 * del sistema —no hay adentro un dato de nadie— y la consumen los dos frontends,
 * uno de los cuales (el storefront) la necesita para renderizar el pedido de un
 * invitado, que no tiene token. Pedir sesión acá sería pedirla para leer un
 * diccionario.
 *
 * Cachea fuerte: solo cambia con un deploy.
 */
orderStatusesRouter.get("/", (_req, res) => {
  res.set("Cache-Control", "public, max-age=3600");
  return res.json({ statuses: listPublicStatuses() });
});
