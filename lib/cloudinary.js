/**
 * Cloudinary **por tenant**.
 *
 * Cada cliente que sale a producción se crea su propia cuenta de Cloudinary, pero
 * el deploy es una instancia multi-tenant única: `mesa-dulce` y `acme` conviven en
 * el mismo proceso. O sea que "una cuenta por cliente" no se resuelve con un `.env`
 * distinto por deploy — las credenciales se resuelven **por tenant, en runtime**.
 *
 * **Cómo, sin crear un cliente por tenant:** todos los métodos del SDK
 * (`uploader.upload`, `uploader.destroy`, `utils.private_download_url`, `api.ping`)
 * aceptan `cloud_name`/`api_key`/`api_secret` en el objeto de opciones y los
 * mergean sobre la config global. Así que el "cliente del tenant" es simplemente un
 * objeto de credenciales que el llamador spreadea en las opciones. La alternativa
 * —llamar `cloudinary.config()` por request— es un bug esperando: estado mutable
 * global compartido entre requests concurrentes de tenants distintos.
 *
 * El `default` sigue siendo el mismo singleton configurado desde env, y eso también
 * es a propósito: los tests lo mockean así.
 */
import { v2 as cloudinary } from "cloudinary";

import prisma from "./prisma.js";
import { createError } from "../helpers/error.js";
import { decryptSecret } from "./crypto.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "cloudinary" });

/**
 * Credenciales de la cuenta de la plataforma. Un tenant sin cuenta propia sube acá,
 * y los assets subidos antes de que el cliente cargara la suya se quedan acá.
 *
 * **Puede no estar configurada**, y es una posición válida: un deploy donde cada
 * tienda tiene su cuenta no necesita ninguna, y tenerla vacía es lo que garantiza
 * que ningún archivo de un cliente termine en la nuestra por accidente. Ver
 * `platformAccountConfigured`.
 *
 * Los getters no son adorno: leen `process.env` en cada acceso en vez de congelar
 * el valor al importar el módulo. Spreadearlo (`{ ...ENV_CREDENTIALS }`) los
 * resuelve a valores planos, así que para el que lo usa no cambia nada — pero deja
 * que un test cambie el entorno sin tener que reimportar medio árbol de módulos.
 */
export const ENV_CREDENTIALS = Object.freeze({
  get cloud_name() {
    return process.env.CLOUDINARY_CLOUD_NAME;
  },
  get api_key() {
    return process.env.CLOUDINARY_API_KEY;
  },
  get api_secret() {
    return process.env.CLOUDINARY_API_SECRET;
  },
});

cloudinary.config({ ...ENV_CREDENTIALS });

/** @returns {boolean} si la plataforma tiene cuenta propia cargada. */
export function platformAccountConfigured() {
  return Boolean(
    ENV_CREDENTIALS.cloud_name &&
      ENV_CREDENTIALS.api_key &&
      ENV_CREDENTIALS.api_secret
  );
}

/** @returns {boolean} si estas credenciales son las de la cuenta de la plataforma. */
export function isEnvAccount(credentials) {
  return (
    platformAccountConfigured() &&
    credentials?.cloud_name === ENV_CREDENTIALS.cloud_name
  );
}

function requirePlatformAccount(tenantId) {
  if (platformAccountConfigured()) return ENV_CREDENTIALS;

  // Sin cuenta de plataforma y sin cuenta del tenant no hay dónde subir. El error
  // se arma acá y no se deja reventar al SDK a propósito: `ensureOption` tira
  // `Must supply cloud_name`, que en el panel se ve como un 500 sin explicación.
  throw createError(
    "Este tenant no tiene cuenta de Cloudinary configurada",
    "CLOUDINARY_NOT_CONFIGURED",
    409
  );
}

/**
 * Cache de credenciales resueltas.
 *
 * En memoria y no en Redis: es un objeto de proceso y se invalida solo al guardar
 * la config. El TTL corto va ADEMÁS de la invalidación explícita porque esta última
 * es por proceso — el día que haya más de una instancia, la que no atendió el PATCH
 * seguiría con las credenciales viejas para siempre. Un minuto es el techo.
 */
const CREDENTIALS_TTL_MS = 60_000;
const credentialsCache = new Map();

/** Tira la entrada cacheada de un tenant. La llama `TenantConfigModel.update`. */
export function invalidateCredentials(tenantId) {
  credentialsCache.delete(Number(tenantId));
}

/** Solo para tests: vacía la cache entera. */
export function resetCredentialsCache() {
  credentialsCache.clear();
}

/**
 * Credenciales con las que operar en nombre de un tenant. Sin cuenta propia
 * cargada, las de la cuenta global.
 *
 * **Si tiene credenciales cargadas y no se pueden descifrar, LANZA.** Es la
 * diferencia entre los dos casos y no es un detalle: un tenant sin credenciales
 * eligió usar la cuenta global, pero uno con credenciales rotas cree que está
 * usando la suya. Caer a la global ahí sería mandarle los archivos a nuestra
 * cuenta sin que nadie se entere — justo lo que la cuenta por cliente evita.
 * (Distinto criterio que `resolveAccessToken` en whatsapp/tenant-resolver.js, que
 * sí degrada: ahí el fallback manda un mensaje igual; acá deja archivos del cliente
 * en el lugar equivocado, y eso no se deshace solo.)
 *
 * @param {number} tenantId
 * @returns {Promise<{ cloud_name: string, api_key: string, api_secret: string }>}
 */
export async function credentialsFor(tenantId) {
  if (!tenantId) {
    log.warn("credentialsFor sin tenantId, usando la cuenta de la plataforma");
    return requirePlatformAccount();
  }

  const key = Number(tenantId);
  const cached = credentialsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.credentials;
  }

  const credentials = await resolveCredentials(key);
  credentialsCache.set(key, {
    credentials,
    expiresAt: Date.now() + CREDENTIALS_TTL_MS,
  });
  return credentials;
}

async function resolveCredentials(tenantId) {
  const config = await prisma.tenantConfig.findUnique({
    where: { tenantId },
    select: {
      cloudinaryCloudName: true,
      cloudinaryApiKey: true,
      cloudinaryApiSecret: true,
    },
  });

  // Los tres van juntos (CHECK en la DB), pero se chequean los tres igual: la
  // config puede no existir todavía.
  if (
    !config?.cloudinaryCloudName ||
    !config.cloudinaryApiKey ||
    !config.cloudinaryApiSecret
  ) {
    return requirePlatformAccount(tenantId);
  }

  try {
    return {
      cloud_name: config.cloudinaryCloudName,
      api_key: decryptSecret(config.cloudinaryApiKey),
      api_secret: decryptSecret(config.cloudinaryApiSecret),
    };
  } catch (err) {
    log.error(
      { err: err.message, tenantId, cloudName: config.cloudinaryCloudName },
      "no se pudieron descifrar las credenciales de Cloudinary del tenant"
    );
    throw createError(
      "Las credenciales de Cloudinary de este tenant no se pueden leer: volvé a cargarlas desde la configuración",
      "CLOUDINARY_CREDENTIALS_UNREADABLE",
      500
    );
  }
}

/**
 * Credenciales para tocar un asset que YA existe y del que sabemos en qué cuenta
 * quedó (`cloudName` persistido junto al asset).
 *
 * Existe porque un tenant puede cargar su cuenta propia **después** de tener assets
 * subidos: esos se quedan en la global y hay que seguir firmándolos y borrándolos
 * ahí. `null` = cuenta global (las filas anteriores a que existiera la columna).
 *
 * El atajo de arriba tiene un efecto que conviene notar: un asset de la cuenta
 * global se resuelve **sin mirar** las credenciales del tenant, así que los
 * comprobantes viejos se siguen pudiendo abrir aunque las del tenant estén rotas.
 */
export async function credentialsForCloudName(tenantId, cloudName) {
  if (!cloudName || cloudName === ENV_CREDENTIALS.cloud_name) {
    return requirePlatformAccount(tenantId);
  }

  const credentials = await credentialsFor(tenantId);
  if (credentials.cloud_name === cloudName) return credentials;

  // El asset está en una cuenta que ya no es ni la del tenant ni la global (el
  // cliente cambió de cuenta dos veces). No hay con qué firmarlo; que se vea en el
  // log y no como un 404 misterioso del lado del panel.
  log.warn(
    { tenantId, cloudName, current: credentials.cloud_name },
    "el asset está en una cuenta de Cloudinary que ya no está configurada"
  );
  return credentials;
}

/**
 * Ping a la cuenta con credenciales sueltas, para validarlas ANTES de guardarlas.
 * Un `api_secret` mal pegado se descubre acá y no seis horas después, cuando
 * alguien sube una foto.
 *
 * **El `undefined` no es un descuido**: `api.ping` tiene la firma vieja del SDK,
 * `ping(callback, options)` — las opciones van SEGUNDAS. Pasarlas primeras no
 * falla: se toman como callback, las credenciales nunca llegan y el ping valida
 * contra la cuenta global, o sea que cualquier credencial inventada daría "ok".
 * (Las demás llamadas del SDK sí toman las opciones al final: ver `sign_request` y
 * `base_api_url`, que resuelven `api_key`/`api_secret`/`cloud_name` con
 * `ensureOption(options, ...)` y solo caen a la config global si no vienen.)
 *
 * @returns {Promise<boolean>}
 */
export async function verifyCredentials({ cloudName, apiKey, apiSecret }) {
  try {
    const result = await cloudinary.api.ping(undefined, {
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
    });
    return result?.status === "ok";
  } catch (err) {
    log.warn(
      { err: err.message, cloudName },
      "el ping a Cloudinary con las credenciales nuevas falló"
    );
    return false;
  }
}

export default cloudinary;
