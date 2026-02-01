import { Router } from "express";
import { cartController } from "../controllers/cart.js";
import { verifyToken } from "../middleware/auth.js";

export const cartRouter = Router();

/**
 * GET /api/cart
 * Obtener el carrito del usuario autenticado
 * - Retorna el carrito completo con todos sus items
 * - Incluye información de productos (nombre, precio, imagen)
 * - Calcula subtotales y total general
 */
cartRouter.get("/", verifyToken, cartController.getCart);

/**
 * POST /
 * Agregar un producto al carrito con increment
 * Body: { productId, quantity }
 * - Si el producto ya existe, incrementa la cantidad
 * - Si no existe, lo crea con la cantidad especificada
 * - Valida stock disponible antes de agregar
 *  Body: { quantity } o { increment: number }
 *
 */
cartRouter.post("/:productId", verifyToken, cartController.add);

/**
 * DELETE /api/cart/items/:productId
 * Eliminar un item específico del carrito
 * - Remueve completamente el producto del carrito
 * Body: { quantity } o { increment: number }
 */
cartRouter.patch("/:productId", verifyToken, cartController.remove);

/**
 * DELETE /api/cart
 * Vaciar todo el carrito
 * - Elimina todos los items del carrito del usuario
 * - Útil para "limpiar carrito" o después de una compra exitosa
 */
cartRouter.delete("/", verifyToken, cartController.clear);
