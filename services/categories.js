import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";
import { wrap, delPattern, tenantNs } from "../lib/cache.js";

const CATEGORIES_TREE_TTL = 300;

function categoriesTreeKey(tenantId) {
  return `${tenantNs(tenantId)}:cat:tree`;
}

async function invalidateCategoriesCache(tenantId) {
  await delPattern(`${tenantNs(tenantId)}:cat:*`);
}

async function ensureParentExists(tx, tenantId, parentId) {
  if (parentId === undefined || parentId === null) return null;

  const parent = await tx.categories.findFirst({
    where: { id: parentId, tenantId },
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

async function ensureNoCircularHierarchy(tx, tenantId, categoryId, parentId) {
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

    const current = await tx.categories.findFirst({
      where: { id: currentParentId, tenantId },
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
  async getAll({ tenantId, includeChildren = false } = {}) {
    return prisma.categories.findMany({
      where: { tenantId },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      include: includeChildren
        ? { children: { orderBy: [{ position: "asc" }, { id: "asc" }] } }
        : undefined,
    });
  },

  async getById({ tenantId, id }) {
    const category = await prisma.categories.findFirst({
      where: { id, tenantId },
      include: {
        parent: true,
        children: { orderBy: [{ position: "asc" }, { id: "asc" }] },
      },
    });

    if (!category) {
      throw createError("La categoría no existe", "CATEGORY_NOT_FOUND", 404);
    }

    return category;
  },

  async getByIdForManagement({ tenantId, id }) {
    const category = await prisma.categories.findFirst({
      where: { id, tenantId },
    });

    if (!category) {
      throw createError("La categoría no existe", "CATEGORY_NOT_FOUND", 404);
    }

    return category;
  },

  async create({
    tenantId,
    name,
    description,
    isActive,
    icon,
    imageUrl,
    imgPublicId,
    parentId,
    position,
  }) {
    const result = await prisma.$transaction(async (tx) => {
      const exists = await tx.categories.findFirst({
        where: { tenantId, name },
      });

      if (exists) {
        throw createError(
          "Ya existe una categoría con ese nombre",
          "CATEGORY_ALREADY_EXISTS",
          409
        );
      }

      await ensureParentExists(tx, tenantId, parentId);

      return tx.categories.create({
        data: {
          tenantId,
          name,
          description: description ?? null,
          isActive: isActive ?? true,
          icon: icon ?? null,
          imageUrl: imageUrl ?? null,
          imgPublicId: imgPublicId ?? null,
          parentId: parentId ?? null,
          position: position ?? 0,
        },
      });
    });

    await invalidateCategoriesCache(tenantId);
    return result;
  },

  async edit({
    tenantId,
    id,
    name,
    description,
    isActive,
    icon,
    imageUrl,
    imgPublicId,
    parentId,
    position,
  }) {
    const result = await prisma.$transaction(async (tx) => {
      const category = await tx.categories.findFirst({
        where: { id, tenantId },
      });

      if (!category) {
        throw createError("La categoría no existe", "CATEGORY_NOT_FOUND", 404);
      }

      if (name !== undefined) {
        const conflict = await tx.categories.findFirst({
          where: { tenantId, name, NOT: { id } },
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
        await ensureParentExists(tx, tenantId, parentId);
        await ensureNoCircularHierarchy(tx, tenantId, id, parentId);
      }

      return tx.categories.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(isActive !== undefined && { isActive }),
          ...(icon !== undefined && { icon }),
          ...(imageUrl !== undefined && { imageUrl }),
          ...(imgPublicId !== undefined && { imgPublicId }),
          ...(parentId !== undefined && { parentId }),
          ...(position !== undefined && { position }),
        },
        include: {
          parent: true,
          children: { orderBy: [{ position: "asc" }, { id: "asc" }] },
        },
      });
    });

    await invalidateCategoriesCache(tenantId);
    return result;
  },

  async delete({ tenantId, id }) {
    const result = await prisma.$transaction(async (tx) => {
      const category = await tx.categories.findFirst({
        where: { id, tenantId },
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

    await invalidateCategoriesCache(tenantId);
    return result;
  },

  async getTree({ tenantId }) {
    return wrap(categoriesTreeKey(tenantId), CATEGORIES_TREE_TTL, async () => {
      const categories = await prisma.categories.findMany({
        where: { tenantId },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        include: { parent: true },
      });

      return buildCategoryTree(categories);
    });
  },
};
