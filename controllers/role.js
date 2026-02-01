import { roleModel } from "../services/role.js";

export class roleController {
  static async edit(req, res) {
    try {
      const { id } = req.params;
      const { role } = req.body;

      if (!id || !role) {
        return res.status(400).json({
          message: "Faltan datos",
        });
      }

      if (!["USER", "ADMIN"].includes(role)) {
        return res.status(400).json({
          message: "Rol inválido",
        });
      }

      const updatedUser = await roleModel.edit(id, role);

      if (!updatedUser) {
        return res.status(404).json({
          message: "Usuario no encontrado",
        });
      }

      return res.json({
        message: "Rol actualizado correctamente",
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          role: updatedUser.role,
        },
      });
    } catch (error) {
      return res.status(500).json({
        message: "Error al actualizar rol",
      });
    }
  }
}
