import prisma from "../lib/prisma.js";

export const ProductModel = {
  async getAll({ name, price, limit = 10, offset = 0 }) {
    const search = {
      where: {
        name: name ? { contains: name, mode: "insensitive" } : undefined,
        price: price ? { lte: Number(price) } : undefined,
      },
      take: Number(limit),
      skip: Number(offset),
    };

    return prisma.product.findMany(search);
  },

  async getById(id) {
    return prisma.product.findUnique({
      where: { id: Number(id) },
    });
  },

  async create({ name, description, price, stock, img }) {
    const data = {
      name,
      description: description ?? null,
      price: price !== undefined ? Number(price) : null,
      stock: Number(stock),
      img: img ?? null,
    };

    return prisma.product.create({ data });
  },

  async edit(id, data) {
    // ← id y data como parámetros separados
    return prisma.product.update({
      where: { id: Number(id) },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && {
          description: data.description,
        }),
        ...(data.price !== undefined && { price: Number(data.price) }),
        ...(data.stock !== undefined && { stock: Number(data.stock) }),
        ...(data.img !== undefined && { img: data.img }),
      },
    });
  },

  async delete(id) {
    return prisma.product.delete({
      where: { id: Number(id) },
    });
  },
};
