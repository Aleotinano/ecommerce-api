import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";

export const roleModel = {
  async edit(id, role) {
    const user = await prisma.user.findUnique({
      where: { id: Number(id) },
    });

    if (!user) {
      throw createError("Usuario no encontrado", "USER_NOT_FOUND", 404);
    }

    return prisma.user.update({
      where: { id: Number(id) },
      data: { role },
    });
  },
};
