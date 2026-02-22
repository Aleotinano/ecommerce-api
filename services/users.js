import prisma from "../lib/prisma.js";
import { hashPassword, verifyPassword } from "../helpers/password.js";
import { createError } from "../helpers/error.js";
import jwt from "jsonwebtoken";
import { DEFAULTS } from "../config.js";

export const UserModel = {
  async register({ username, password, email, role }) {
    const existingUser = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      throw createError("El usuario ya existe", "USERNAME_EXISTS", 409);
    }

    const hashedPassword = await hashPassword(password);
    const data = {
      username: username,
      password: hashedPassword,
      email: email,
      role: role,
    };

    return prisma.user.create({ data });
  },

  async login({ username, password }) {
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      throw createError("El usuario no existe", "USER_NOT_FOUND", 401);
    }

    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      throw createError("ContraseÃ±a incorrecta", "INVALID_PASSWORD", 401);
    }
    return user;
  },

  async me({ token }) {
    if (!token) {
      throw createError("No autenticado", "UNAUTHORIZED", 401);
    }

    try {
      const data = jwt.verify(token, DEFAULTS.SECRET_JWT_KEY);

      return {
        id: data.id,
        username: data.username,
        email: data.email,
        role: data.role,
      };
    } catch (error) {
      throw createError("Token invalido", "INVALID_TOKEN", 401);
    }
  },
};
