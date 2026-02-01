import prisma from "../lib/prisma.js";

export const CategoryModel = {
  async getAll() {
    const categories = await prisma.categories.findMany({
      orderBy: { id: "asc" },
    });

    return categories;
  },

  async create({ name, description, isActive, icon }) {
    const categoryExist = await prisma.categories.findUnique({
      where: { name: name },
    });

    if (categoryExist) {
      throw new Error("CATEGORY_ALREADY_EXISTS");
    }

    const category = await prisma.categories.create({
      data: {
        isActive: isActive,
        name: name,
        description: description,
        icon: icon,
      },
    });

    return category;
  },

  async edit({ id, name, description, isActive, icon }) {
    const category = await prisma.categories.findUnique({
      where: { id: parseInt(id) },
    });

    if (!category) return null;

    if (!name && !description && isActive === undefined && !icon) {
      return res.status(400).json({
        message: "Debes enviar al menos un campo para actualizar",
      });
    }

    const updatedCategory = await prisma.categories.update({
      where: { id: parseInt(id) },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(isActive !== undefined && { isActive }),
        ...(icon !== undefined && { icon }),
      },
    });

    return updatedCategory;
  },

  async delete({ id }) {
    const category = await prisma.categories.findUnique({
      where: { id: parseInt(id) },
      include: { products: true },
    });

    if (!category) return null;

    if (category.products.length > 0) {
      throw new Error("CATEGORY_HAS_PRODUCTS");
    }

    const deletedCategory = await prisma.categories.delete({
      where: { id: parseInt(id) },
    });

    return deletedCategory;
  },
};
