import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";

export const ProductModel = {
  async getAll({ name, price, limit, offset }) {
    const where = {
      isActive: true,
    };

    if (name) {
      where.name = { contains: name, mode: "insensitive" };
    }

    if (price) {
      where.price = { lte: price };
    }

    const search = {
      where,
      take: limit,
      skip: offset,
    };

    return prisma.product.findMany(search);
  },

  async getById({ id }) {
    const product = await prisma.product.findUnique({
      where: { id: id, isActive: true },
    });
    if (!product) {
      throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
    }
    return product;
  },

  async create({ name, description, price, stock, img }) {
    const data = {
      name: name,
      description: description ?? null,
      price: price,
      stock: stock,
      img: img ?? null,
    };

    return prisma.product.create({ data });
  },

  async edit({ id }, { name, description, price, stock, img }) {
    const existing = await prisma.product.findUnique({
      where: { id },
    });
    if (!existing) {
      throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
    }

    const data = {
      name: name,
      description: description,
      price: price,
      stock: stock,
      img: img,
    };

    const updateData = Object.fromEntries(
      Object.entries(data).filter(([_, value]) => value !== undefined)
    );

    return prisma.product.update({
      where: { id },
      data: updateData,
    });
  },

  async delete({ id }) {
    const existing = await prisma.product.findUnique({
      where: { id },
    });
    if (!existing) {
      throw createError("Producto no encontrado", "PRODUCT_NOT_FOUND", 404);
    }

    return prisma.product.delete({
      where: { id: id },
    });
  },
};
