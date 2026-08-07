import "dotenv/config";

import { randomBytes } from "node:crypto";

import prisma from "../lib/prisma.js";
import { UserModel } from "../services/users.js";
import { registerSchema } from "../schemas/auth.schema.js";
import { TENANT_PROFILES, DEFAULT_TENANT_PROFILE } from "../services/tenant-profiles.js";

/**
 * Alta de tenant + su primer ADMIN, desde la consola del servidor.
 *
 * Es la vía de alta cuando `POST /auth/register` está apagado: mientras el SaaS no
 * sea self-serve, un tenant nuevo lo damos de alta nosotros contra la base.
 *
 * NO reimplementa el alta: llama a `UserModel.register({ trusted: true })`, el mismo
 * service que usaba la ruta HTTP. Eso es deliberado — un INSERT a mano acá se
 * desincroniza el día que el alta gane un paso (hoy ya son tres: tenant, usuario y la
 * fila de `TenantConfig` sin la cual la pantalla de configuración tira 404). Lo único
 * que cambia con `trusted` es que el email queda verificado y no sale el correo.
 *
 * La contraseña NUNCA se pasa por argumento: los argumentos quedan en el historial del
 * shell y en la lista de procesos. O viene por `ADMIN_PASSWORD`, o el script genera una
 * al azar y la imprime una sola vez.
 *
 * Uso:
 *   node prisma/create-tenant.js --name "Shifu" --email dueno@shifu.com
 *   node prisma/create-tenant.js --name "Shifu" --email dueno@shifu.com --username shifu
 *   ADMIN_PASSWORD='...' node prisma/create-tenant.js --name "Shifu" --email dueno@shifu.com
 *   node prisma/create-tenant.js --list
 */

const PROFILES = Object.keys(TENANT_PROFILES);

const USAGE = `
Alta de tenant + admin (la ruta HTTP de registro está deshabilitada).

  node prisma/create-tenant.js --name "<Tienda>" --email <email> [opciones]
  node prisma/create-tenant.js --list

Opciones:
  --name      Nombre de la tienda. De acá sale el slug (obligatorio).
  --email     Email del dueño. Es con lo que se loguea (obligatorio).
  --username  Usuario del admin. Por defecto "admin".
  --profile   Flujo de venta: ${PROFILES.join(" | ")}. Por defecto "${DEFAULT_TENANT_PROFILE}".
  --list      Lista los tenants existentes y sale.

La contraseña sale de ADMIN_PASSWORD; si no está, se genera una y se imprime.
`;

function parseArgs(argv) {
  const args = { list: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    const value = () => inline ?? argv[++i];

    switch (flag) {
      // pnpm reenvía los flags sin separador, pero `pnpm tenant:create -- --name ...`
      // es el reflejo de npm y ahí el `--` llega tal cual hasta acá. Se ignora en vez
      // de morir con "Opción desconocida", que no le dice a nadie qué hacer.
      case "--":
        break;
      case "--list":
        args.list = true;
        break;
      case "--name":
        args.tenantName = value();
        break;
      case "--email":
        args.email = value();
        break;
      case "--username":
        args.username = value();
        break;
      case "--profile":
        args.profile = value();
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      // `VAR=valor comando` es sintaxis de bash y no existe en PowerShell: la
      // asignación termina acá como argumento posicional. Vale la pena detectarlo
      // porque el error genérico no explica por qué la contraseña "no se tomó".
      case "ADMIN_PASSWORD":
        throw new Error(
          "ADMIN_PASSWORD es una variable de entorno, no un argumento.\n" +
            "  PowerShell:  $env:ADMIN_PASSWORD = 'tu-clave'; pnpm tenant:create --name ... --email ...\n" +
            "  bash:        ADMIN_PASSWORD='tu-clave' pnpm tenant:create --name ... --email ...\n" +
            "  O corré el comando sin ella y usá la contraseña que genera el script."
        );
      default:
        throw new Error(`Opción desconocida: ${flag}`);
    }
  }
  return args;
}

/** 24 caracteres base64url ≈ 128 bits. Se imprime una vez y no se guarda en ningún lado. */
function generatePassword() {
  return randomBytes(18).toString("base64url");
}

async function listTenants() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      isActive: true,
      users: {
        where: { role: "ADMIN" },
        orderBy: { id: "asc" },
        select: { email: true, username: true, emailVerified: true },
      },
    },
  });

  if (tenants.length === 0) {
    console.log("\nNo hay tenants todavía.\n");
    return;
  }

  console.log("");
  for (const tenant of tenants) {
    const estado = tenant.isActive ? "" : "  [INACTIVO]";
    console.log(`  #${tenant.id}  ${tenant.slug}${estado}  — ${tenant.name}`);
    for (const admin of tenant.users) {
      const verificado = admin.emailVerified ? "" : "  (email sin verificar)";
      console.log(`        admin: ${admin.username} <${admin.email}>${verificado}`);
    }
  }
  console.log("");
}

async function createTenant(args) {
  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || generatePassword();

  // Las mismas reglas que validaba la ruta HTTP: largo de contraseña, formato de
  // email, caracteres permitidos en el nombre. Que el alta sea por consola no
  // significa que pueda entrar cualquier cosa a la base.
  const input = registerSchema.parse({
    username: args.username,
    email: args.email,
    tenantName: args.tenantName,
    password,
  });

  const profile = args.profile ?? DEFAULT_TENANT_PROFILE;
  const { user, tenant } = await UserModel.register({
    ...input,
    profile,
    trusted: true,
  });

  console.log(`
✔ Tenant creado

  slug        ${tenant.slug}          ← NEXT_PUBLIC_DEFAULT_TENANT / subdominio
  tenantId    ${tenant.id}
  nombre      ${tenant.name}
  perfil      ${profile}

  admin       ${user.username} <${user.email}>
  email       verificado (alta por consola)
`);

  if (generated) {
    console.log(`  contraseña  ${password}
              ↑ generada al azar. No queda guardada en ningún lado: copiala ahora.
                Se puede fijar una propia con ADMIN_PASSWORD=... antes del comando.
`);
  } else {
    console.log("  contraseña  la de ADMIN_PASSWORD\n");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    return;
  }

  if (args.list) {
    await listTenants();
    return;
  }

  if (!args.tenantName || !args.email) {
    console.log(USAGE);
    throw new Error("Faltan --name y/o --email");
  }

  await createTenant(args);
}

main()
  .catch((err) => {
    // `createError` cuelga code/details del error; el más común es el choque de slug,
    // y ahí lo útil no es el mensaje sino las alternativas que ya calculó el service.
    if (err.code === "TENANT_EXISTS") {
      console.error(`\n✖ Ya existe un tenant con el slug "${err.details?.slug}".`);
      if (err.details?.suggestions?.length) {
        console.error(`  Libres: ${err.details.suggestions.join(", ")}`);
        console.error("  Pasá otro --name que derive en alguno de esos.\n");
      }
    } else if (err.name === "ZodError") {
      console.error("\n✖ Datos inválidos:");
      for (const issue of err.issues) {
        console.error(`  ${issue.path.join(".") || "(raíz)"}: ${issue.message}`);
      }
      console.error("");
    } else {
      console.error(`\n✖ ${err.message}\n`);
    }
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
