import "dotenv/config";

import prisma from "../lib/prisma.js";
import { DEFAULTS } from "../config.js";
import {
  ENV_CREDENTIALS,
  credentialsFor,
  isEnvAccount,
  platformAccountConfigured,
  verifyCredentials,
} from "../lib/cloudinary.js";

/**
 * Diagnóstico de Cloudinary: qué cuenta va a usar cada tenant, y si esa cuenta
 * contesta.
 *
 * Existe porque el estado "sin cuenta configurada" **es válido** y no rompe el
 * arranque: el server levanta igual y el problema recién aparece cuando alguien
 * sube una foto desde el panel y se come un 409 `CLOUDINARY_NOT_CONFIGURED`.
 * Esto lo adelanta a un comando.
 *
 * Corre contra el entorno que tenga cargado, así que en el server va adentro del
 * contenedor (es el que tiene el `.env` de producción):
 *
 *   docker compose -f docker-compose.prod.yml exec backend node scripts/check-cloudinary.js
 *
 * NO imprime secretos: el `api_secret` no sale nunca y la `api_key` va enmascarada.
 * El motivo es que la salida de esto es justo lo que uno pega en un chat cuando
 * algo no anda.
 *
 *   pnpm cloudinary:check
 */

/** Deja las 4 primeras y las 4 últimas: alcanza para comparar contra el dashboard. */
function enmascarar(valor) {
  if (!valor) return "(vacío)";
  if (valor.length <= 10) return "*".repeat(valor.length);
  return `${valor.slice(0, 4)}${"*".repeat(valor.length - 8)}${valor.slice(-4)}`;
}

function describirPing(resultado) {
  if (resultado.ok) return "ok";
  // La distinción que hace `verifyCredentials`: si Cloudinary contestó rechazando,
  // el problema son las credenciales; si no contestó, el problema es la red del
  // server y mandar a revisar el api_secret es mandar a arreglar lo único sano.
  return resultado.rejected
    ? `RECHAZADO por Cloudinary${resultado.status ? ` (${resultado.status})` : ""}: ${resultado.reason}`
    : `NO SE PUDO LLEGAR a Cloudinary: ${resultado.reason}`;
}

async function checkPlataforma() {
  console.log("\n== Cuenta de la plataforma (variables de entorno) ==\n");

  if (!platformAccountConfigured()) {
    console.log("  NO configurada.");
    console.log(
      "\n  Es un estado válido: en un deploy donde cada tienda trae su cuenta, vacía es lo\n" +
        "  que garantiza que ningún archivo de un cliente caiga en la nuestra. Pero todo\n" +
        "  tenant SIN cuenta propia va a recibir 409 CLOUDINARY_NOT_CONFIGURED al subir.\n" +
        "\n  Para cargarla, en el .env:\n" +
        "    CLOUDINARY_CLOUD_NAME=...\n" +
        "    CLOUDINARY_API_KEY=...\n" +
        "    CLOUDINARY_API_SECRET=...\n" +
        "  (o CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>)\n" +
        "\n  Entra por env_file, así que alcanza con recrear el backend, sin rebuild:\n" +
        "    docker compose -f docker-compose.prod.yml up -d --force-recreate backend"
    );
    return false;
  }

  const desdeUrl = !process.env.CLOUDINARY_CLOUD_NAME && Boolean(process.env.CLOUDINARY_URL);

  console.log(`  cloud_name   ${ENV_CREDENTIALS.cloud_name}`);
  console.log(`  api_key      ${enmascarar(ENV_CREDENTIALS.api_key)}`);
  console.log(`  api_secret   ${ENV_CREDENTIALS.api_secret ? "cargado" : "(vacío)"}`);
  console.log(`  folder       ${DEFAULTS.CLOUDINARY_FOLDER}`);
  console.log(`  origen       ${desdeUrl ? "CLOUDINARY_URL" : "variables sueltas"}`);

  const resultado = await verifyCredentials({
    cloudName: ENV_CREDENTIALS.cloud_name,
    apiKey: ENV_CREDENTIALS.api_key,
    apiSecret: ENV_CREDENTIALS.api_secret,
  });

  console.log(`  ping         ${describirPing(resultado)}`);
  return resultado.ok;
}

async function checkTenants() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { id: "asc" },
    select: { id: true, slug: true, isActive: true },
  });

  console.log("\n== Qué cuenta usa cada tenant ==\n");

  if (tenants.length === 0) {
    console.log("  No hay tenants todavía.");
    return true;
  }

  const ancho = Math.max(...tenants.map((t) => t.slug.length));
  let todoBien = true;

  for (const tenant of tenants) {
    const etiqueta = `  #${tenant.id}  ${tenant.slug.padEnd(ancho)}${tenant.isActive ? "" : "  [INACTIVO]"}`;

    let credentials;
    try {
      credentials = await credentialsFor(tenant.id);
    } catch (err) {
      // Los dos casos que lanzan: sin cuenta de ningún lado (CLOUDINARY_NOT_CONFIGURED)
      // y credenciales propias que no descifran (CLOUDINARY_CREDENTIALS_UNREADABLE).
      // El segundo es el grave: ese tenant cree que está usando su cuenta.
      console.log(`${etiqueta}  ✖ ${err.code ?? "ERROR"} — ${err.message}`);
      todoBien = false;
      continue;
    }

    if (isEnvAccount(credentials)) {
      console.log(`${etiqueta}  → cuenta de la plataforma (${credentials.cloud_name})`);
      continue;
    }

    const resultado = await verifyCredentials({
      cloudName: credentials.cloud_name,
      apiKey: credentials.api_key,
      apiSecret: credentials.api_secret,
    });

    console.log(
      `${etiqueta}  → cuenta propia (${credentials.cloud_name})  ping ${describirPing(resultado)}`
    );
    if (!resultado.ok) todoBien = false;
  }

  return todoBien;
}

async function main() {
  const plataformaOk = await checkPlataforma();
  const tenantsOk = await checkTenants();

  console.log("");

  // Sin cuenta de plataforma NO es un fallo por sí solo: puede ser la postura elegida.
  // Lo que sí lo es: una cuenta cargada que no responde, o un tenant que no resuelve.
  if (!tenantsOk || (platformAccountConfigured() && !plataformaOk)) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(`\n✖ ${err.message ?? err}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
