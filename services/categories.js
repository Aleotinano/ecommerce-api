import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";

async function ensureParentExists(tx, parentId) {
  if (parentId === undefined || parentId === null) return null;

  const parent = await tx.categories.findUnique({
    where: { id: parentId },
    select: { id: true, parentId: true },
  });

  if (!parent) {
    throw createError(
      "La categoría padre no existe",
      "PARENT_CATEGORY_NOT_FOUND",
      404
    );
  }

  return parent;
}

async function ensureNoCircularHierarchy(tx, categoryId, parentId) {
  if (parentId === undefined || parentId === null) return;

  if (categoryId === parentId) {
    throw createError(
      "Una categoría no puede ser su propia padre",
      "INVALID_PARENT_CATEGORY",
      400
    );
  }

  let currentParentId = parentId;

  while (currentParentId !== null) {
    if (currentParentId === categoryId) {
      throw createError(
        "No se puede crear una jerarquía circular entre categorías",
        "CATEGORY_CIRCULAR_HIERARCHY",
        400
      );
    }

    const current = await tx.categories.findUnique({
      where: { id: currentParentId },
      select: { parentId: true },
    });

    if (!current) {
      throw createError(
        "La categoría padre no existe",
        "PARENT_CATEGORY_NOT_FOUND",
        404
      );
    }

    currentParentId = current.parentId;
  }
}

function buildCategoryTree(categories, parentId = null) {
  return categories
    .filter((c) => c.parentId === parentId)
    .map((c) => ({
      ...c,
      children: buildCategoryTree(categories, c.id),
    }));
}

export const CategoryModel = {
  async getAll({ includeChildren = false } = {}) {
    return prisma.categories.findMany({
      orderBy: { id: "asc" },
      include: includeChildren
        ? { children: { orderBy: { id: "asc" } } }
        : undefined,
    });
  },

  async getById({ id }) {
    const category = await prisma.categories.findUnique({
      where: { id },
      include: {
        parent: true,
        children: { orderBy: { id: "asc" } },
      },
    });

    if (!category) {
      throw createError("La categoría no existe", "CATEGORY_NOT_FOUND", 404);
    }

    return category;
  },

  async create({ name, description, isActive, icon, parentId }) {
    return prisma.$transaction(async (tx) => {
      const exists = await tx.categories.findUnique({ where: { name } });

      if (exists) {
        throw createError(
          "Ya existe una categoría con ese nombre",
          "CATEGORY_ALREADY_EXISTS",
          409
        );
      }

      await ensureParentExists(tx, parentId);

      return tx.categories.create({
        data: {
          name,
          description: description ?? null,
          isActive: isActive ?? true,
          icon: icon ?? null,
          parentId: parentId ?? null,
        },
      });
    });
  },

  async edit({ id, name, description, isActive, icon, parentId }) {
    return prisma.$transaction(async (tx) => {
      const category = await tx.categories.findUnique({ where: { id } });

      if (!category) {
        throw createError("La categoría no existe", "CATEGORY_NOT_FOUND", 404);
      }

      if (name !== undefined) {
        const conflict = await tx.categories.findFirst({
          where: { name, NOT: { id } },
        });

        if (conflict) {
          throw createError(
            "Ya existe otra categoría con ese nombre",
            "CATEGORY_ALREADY_EXISTS",
            409
          );
        }
      }

      if (parentId !== undefined) {
        await ensureParentExists(tx, parentId);
        await ensureNoCircularHierarchy(tx, id, parentId);
      }

      return tx.categories.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(isActive !== undefined && { isActive }),
          ...(icon !== undefined && { icon }),
          ...(parentId !== undefined && { parentId }),
        },
        include: {
          parent: true,
          children: { orderBy: { id: "asc" } },
        },
      });
    });
  },

  async delete({ id }) {
    return prisma.$transaction(async (tx) => {
      const category = await tx.categories.findUnique({
        where: { id },
        include: {
          products: { select: { id: true } },
          children: { select: { id: true } },
        },
      });

      if (!category) {
        throw createError("La categoría no existe", "CATEGORY_NOT_FOUND", 404);
      }

      if (category.products.length > 0) {
        throw createError(
          "No se puede eliminar: la categoría tiene productos asociados",
          "CATEGORY_HAS_PRODUCTS",
          409
        );
      }

      if (category.children.length > 0) {
        throw createError(
          "No se puede eliminar: la categoría tiene subcategorías",
          "CATEGORY_HAS_CHILDREN",
          409
        );
      }

      return tx.categories.delete({ where: { id } });
    });
  },

  async getTree() {
    const categories = await prisma.categories.findMany({
      orderBy: { id: "asc" },
      include: { parent: true },
    });

    return buildCategoryTree(categories);
  },
};
