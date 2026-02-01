import prisma from "../lib/prisma.js";
import { hashPassword } from "../helpers/password.js";
import { DEFAULTS } from "../config.js";

async function main() {
  const { USERNAME, PASSWORD } = DEFAULTS.ADMIN;

  const hashedPassword = await hashPassword(PASSWORD);

  const admin = await prisma.user.upsert({
    where: { username: USERNAME },
    update: {},
    create: {
      username: USERNAME,
      password: hashedPassword,
      role: "ADMIN",
    },
  });

  const publicData = {
    username: admin.username,
    role: admin.role,
  };

  console.log("Admin seed ejecutado correctamente:");
  console.log(publicData);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
