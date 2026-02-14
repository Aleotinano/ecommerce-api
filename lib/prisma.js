import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/index.js";
import { DEFAULTS } from "../config.js";

const connectionString = DEFAULTS.DATABASE_URL;

// adaptador necesario conoxion a la bd en postgres
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

export default prisma;
