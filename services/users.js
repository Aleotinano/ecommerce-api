import prisma from "../lib/prisma.js";
import { hashPassword, verifyPassword } from "../helpers/password.js";

export const UserModel = {
  async register({ username, password, email, role }) {
    const existingUser = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      throw new Error("USERNAME_EXISTS");
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

    if (!user) return null;

    const isValid = await verifyPassword(password, user.password);
    if (!isValid) return { isValid: false };
    return user;
  },
};
