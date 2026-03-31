import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";

async function ensureParentExists(tx, parentId) {
  if (parentId === undefined || parentId === null) {
    return null;
  }

  const parentCategory = await tx.categories.findUnique({
    where: { id: parentId },
    select: { id: true, parentId: true },
  });

  if (!parentCategory) {
    throw createError(
      "La categoria padre no existe",
      "PARENT_CATEGORY_NOT_FOUND",
      404
    );
  }

  return parentCategory;
}

async function ensureNoCircularHierarchy(tx, categoryId, parentId) {
  if (parentId === undefined || parentId === null) {
    return;
  }

  if (categoryId === parentId) {
    throw createError(
      "Una categoria no puede ser su propia padre",
      "INVALID_PARENT_CATEGORY",
      400
    );
  }

  let currentParentId = parentId;

  while (currentParentId !== null) {
    if (currentParentId === categoryId) {
      throw createError(
        "No se puede crear una jerarquia circular entre categorias",
        "CATEGORY_CIRCULAR_HIERARCHY",
        400
      );
    }

    const currentParent = await tx.categories.findUnique({
      where: { id: currentParentId },
      select: { parentId: true },
    });

    if (!currentParent) {
      throw createError(
        "La categoria padre no existe",
        "PARENT_CATEGORY_NOT_FOUND",
        404
      );
    }

    currentParentId = currentParent.parentId;
  }
}

function buildCategoryTree(categories, parentId = null) {
  return categories
    .filter((category) => category.parentId === parentId)
    .map((category) => ({
      ...category,
      children: buildCategoryTree(categories, category.id),
    }));
}

export const CategoryModel = {
  async getAll({ includeChildren = false } = {}) {
    const categories = await prisma.categories.findMany({
      orderBy: { id: "asc" },
      include: includeChildren
        ? {
            children: {
              orderBy: { id: "asc" },
            },
          }
        : undefined,
    });

    return categories;
  },

  async getById({ id }) {
    const category = await prisma.categories.findUnique({
      where: { id: id },
      include: {
        parent: true,
        children: {
          orderBy: { id: "asc" },
        },
      },
    });

    if (!category) {
      throw createError("La categoria no existe", "CATEGORY_NOT_FOUND", 404);
    }

    return category;
  },

  async create({ name, description, isActive, icon, parentId }) {
    const category = await prisma.$transaction(async (tx) => {
      const categoryExist = await tx.categories.findUnique({
        where: { name: name },
      });

      if (categoryExist) {
        throw createError(
          "La categoria ya existe",
          "CATEGORY_ALREADY_EXISTS",
          409
        );
      }

      await ensureParentExists(tx, parentId);

      return tx.categories.create({
        data: {
          isActive: isActive,
          name: name,
          description: description,
          icon: icon,
          parentId: parentId ?? null,
        },
      });
    });

    return category;
  },

  async edit({ id, name, description, isActive, icon, parentId }) {
    const updatedCategory = await prisma.$transaction(async (tx) => {
      const category = await tx.categories.findUnique({
        where: { id: id },
      });

      if (!category) {
        throw createError("La categoria no existe", "CATEGORY_NOT_FOUND", 404);
      }

      if (
        name === undefined &&
        description === undefined &&
        isActive === undefined &&
        icon === undefined &&
        parentId === undefined
      ) {
        throw createError(
          "No hay campos modificados",
          "NO_FIELDS_TO_UPDATE",
          400
        );
      }

      if (parentId !== undefined) {
        await ensureParentExists(tx, parentId);
        await ensureNoCircularHierarchy(tx, id, parentId);
      }

      return tx.categories.update({
        where: { id: id },
        data: {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(isActive !== undefined && { isActive }),
          ...(icon !== undefined && { icon }),
          ...(parentId !== undefined && { parentId }),
        },
        include: {
          parent: true,
          children: {
            orderBy: { id: "asc" },
          },
        },
      });
    });

    return updatedCategory;
  },

  async delete({ id }) {
    return prisma.$transaction(async (tx) => {
      const category = await tx.categories.findUnique({
        where: { id },
        include: {
          products: true,
          children: {
            select: { id: true },
          },
        },
      });

      if (!category) {
        throw createError("La categoria no existe", "CATEGORY_NOT_FOUND", 404);
      }

      if (category.products.length > 0) {
        throw createError(
          "CATEGORY_HAS_PRODUCTS",
          "CATEGORY_HAS_PRODUCTS",
          409
        );
      }

      if (category.children.length > 0) {
        throw createError(
          "CATEGORY_HAS_CHILDREN",
          "CATEGORY_HAS_CHILDREN",
          409
        );
      }

      return tx.categories.delete({
        where: { id },
      });
    });
  },

  async getTree() {
    const categories = await prisma.categories.findMany({
      orderBy: { id: "asc" },
      include: {
        parent: true,
      },
    });

    return buildCategoryTree(categories);
  },
};
