import prisma from "../lib/prisma.js";
import { hashPassword } from "../helpers/password.js";

async function main() {
  const { USERNAME, PASSWORD, EMAIL } = process.env;

  if (!USERNAME || !PASSWORD || !EMAIL) {
    throw new Error(
      "Missing required environment variables: USERNAME, PASSWORD, or EMAIL"
    );
  }

  const hashedPassword = await hashPassword(PASSWORD);

  const admin = await prisma.user.upsert({
    where: { username: USERNAME },
    update: {},
    create: {
      username: USERNAME,
      password: hashedPassword,
      email: EMAIL,
      role: "ADMIN",
    },
  });

  const publicData = {
    username: admin.username,
    role: admin.role,
    email: admin.email,
  };

  console.log("Admin seed ejecutado correctamente:");
  console.log(publicData);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
