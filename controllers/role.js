import { roleModel } from "../services/role.js";
import { createError } from "../helpers/error.js";

export class roleController {
  static async edit(req, res, next) {
    try {
      const { id } = req.params;
      const { role } = req.body;

      if (!id || !role) {
        return next(createError("Faltan datos", "MISSING_DATA", 400));
      }

      if (!["USER", "ADMIN"].includes(role)) {
        return next(createError("Rol invÃ¡lido", "INVALID_ROLE", 400));
      }

      const updatedUser = await roleModel.edit(id, role);

      return res.json({
        message: "Rol actualizado correctamente",
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          role: updatedUser.role,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}
