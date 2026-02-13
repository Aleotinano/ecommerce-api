import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";

export const CategoryModel = {
  async getAll() {
    const categories = await prisma.categories.findMany({
      orderBy: { id: "asc" },
    });

    return categories;
  },

  async getById({ id }) {
    const category = await prisma.categories.findUnique({
      where: { id: id },
    });

    if (!category) {
      throw createError("La categoría no existe", "CATEGORY_NOT_FOUND", 404);
    }

    return category;
  },

  async create({ name, description, isActive, icon }) {
    const categoryExist = await prisma.categories.findUnique({
      where: { name: name },
    });

    if (categoryExist) {
      throw createError(
        "la categoria ya existe",
        "CATEGORY_ALREADY_EXISTS",
        409
      );
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
      where: { id: id },
    });

    if (!category) {
      throw createError("La categoría no existe", "CATEGORY_NOT_FOUND", 404);
    }

    if (!name && !description && isActive === undefined && !icon) {
      throw createError(
        "No hay campos modificados",
        "NO_FIELDS_TO_UPDATE",
        400
      );
    }

    const updatedCategory = await prisma.categories.update({
      where: { id: id },
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
    return prisma.$transaction(async (tx) => {
      const category = await tx.categories.findUnique({
        where: { id },
        include: { products: true },
      });

      if (!category) {
        throw createError("La categoría no existe", "CATEGORY_NOT_FOUND", 404);
      }

      if (category.products.length > 0) {
        throw createError(
          "CATEGORY_HAS_PRODUCTS",
          "CATEGORY_HAS_PRODUCTS",
          409
        );
      }

      return tx.categories.delete({
        where: { id },
      });
    });
  },
};
