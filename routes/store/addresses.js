import { Router } from "express";
import { StoreAddressesController } from "../../controllers/store/addresses.js";
import { validate } from "../../middleware/validate.js";
import { validateId } from "../../schemas/id.schema.js";
import { createAddress, updateAddress } from "../../schemas/address.schema.js";
import { verifyStoreToken } from "../../middleware/auth.js";

export const storeAddressesRouter = Router();

// La libreta es siempre de un cliente logueado: a diferencia del carrito
// (optionalStoreAuth + guestCart), una dirección sin User no tiene dueño ni forma
// de recuperarse. El checkout ya exige token igual (routes/store/orders.js).
storeAddressesRouter.use(verifyStoreToken);

const validation = {
  create: validate({ body: createAddress }),
  update: validate({ params: validateId, body: updateAddress }),
  id: validate({ params: validateId }),
};

storeAddressesRouter.get("/", StoreAddressesController.getAll);
storeAddressesRouter.post("/", validation.create, StoreAddressesController.create);
storeAddressesRouter.get("/:id", validation.id, StoreAddressesController.getById);
// Marcar como default es PATCH { isDefault: true }: ya es una sola llamada y el
// repo no tiene sub-action routes en ningún CRUD.
storeAddressesRouter.patch("/:id", validation.update, StoreAddressesController.edit);
storeAddressesRouter.delete("/:id", validation.id, StoreAddressesController.delete);
