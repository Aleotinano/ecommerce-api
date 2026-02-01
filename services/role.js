import prisma from "../lib/prisma.js";

export const roleModel = {
  async edit(id, role) {
    return prisma.user.update({
      where: { id: Number(id) },
      data: { role },
    });
  },
};
