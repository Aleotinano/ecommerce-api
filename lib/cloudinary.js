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
 * `CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>` es la línea que
 * el dashboard de Cloudinary muestra para copiar y pegar, y es la forma en que la
 * gente tiene la cuenta a mano. Se acepta como **alias** de las tres variables
 * sueltas.
 *
 * El SDK la parsea solo cuando no le pasás nada, pero acá no alcanzaba: el
 * `cloudinary.config({ ...ENV_CREDENTIALS })` de más abajo mergea con el `extend`
 * de lodash, que **copia los `undefined`**, así que con sólo la URL cargada el
 * spread borraba lo que el SDK había resuelto. Y `platformAccountConfigured()`
 * seguía diciendo que no hay cuenta, con lo cual todo tenant sin cuenta propia se
 * comía un 409 sin nada que lo explicara. De ahí que se parsee acá también: la
 * respuesta a "¿hay cuenta de plataforma?" tiene que salir del mismo lugar que las
 * credenciales.
 *
 * Se memoiza contra el string crudo y no contra el primer acceso, para no romper la
 * propiedad de la que dependen los tests (ver `ENV_CREDENTIALS`).
 */
let urlCredentialsCache = { raw: null, parsed: {} };

function envUrlCredentials() {
  const raw = process.env.CLOUDINARY_URL;
  if (!raw) return {};
  if (urlCredentialsCache.raw === raw) return urlCredentialsCache.parsed;

  let parsed = {};
  try {
    const uri = new URL(raw);
    if (uri.protocol === "cloudinary:") {
      parsed = {
        cloud_name: uri.hostname || undefined,
        // Vienen percent-encoded si el secreto trae caracteres raros.
        api_key: decodeURIComponent(uri.username) || undefined,
        api_secret: decodeURIComponent(uri.password) || undefined,
      };
    } else {
      log.warn(
        { protocol: uri.protocol },
        "CLOUDINARY_URL no arranca con cloudinary://, se ignora"
      );
    }
  } catch {
    // Se ignora en vez de propagar: es una variable OPCIONAL, y dejar el server sin
    // arrancar por una URL mal pegada es peor que operar sin cuenta de plataforma
    // (que es un estado válido). El schema de env la valida antes y con un mensaje
    // que se entiende.
    log.warn("CLOUDINARY_URL no se pudo parsear, se ignora");
  }

  urlCredentialsCache = { raw, parsed };
  return parsed;
}

/**
 * Credenciales de la cuenta de la plataforma. Un tenant sin cuenta propia sube acá,
 * y los assets subidos antes de que el cliente cargara la suya se quedan acá.
 *
 * **Puede no estar configurada**, y es una posición válida: un deploy donde cada
 * tienda tiene su cuenta no necesita ninguna, y tenerla vacía es lo que garantiza
 * que ningún archivo de un cliente termine en la nuestra por accidente. Ver
 * `platformAccountConfigured`.
 *
 * Salen de las tres variables sueltas o de `CLOUDINARY_URL`, con la **explícita
 * ganando**: un deploy que ya tiene las tres no cambia de comportamiento porque
 * quedó una URL vieja olvidada en el entorno.
 *
 * Los getters no son adorno: leen `process.env` en cada acceso en vez de congelar
 * el valor al importar el módulo. Spreadearlo (`{ ...ENV_CREDENTIALS }`) los
 * resuelve a valores planos, así que para el que lo usa no cambia nada — pero deja
 * que un test cambie el entorno sin tener que reimportar medio árbol de módulos.
 */
export const ENV_CREDENTIALS = Object.freeze({
  get cloud_name() {
    return process.env.CLOUDINARY_CLOUD_NAME || envUrlCredentials().cloud_name;
  },
  get api_key() {
    return process.env.CLOUDINARY_API_KEY || envUrlCredentials().api_key;
  },
  get api_secret() {
    return process.env.CLOUDINARY_API_SECRET || envUrlCredentials().api_secret;
  },
});

// Sin las claves en `undefined`: el merge del SDK es un `extend` de lodash, que las
// copia igual y desconfigura lo que ya estaba resuelto.
cloudinary.config(
  Object.fromEntries(
    Object.entries({ ...ENV_CREDENTIALS }).filter(
      ([, value]) => value !== undefined
    )
  )
);

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
  //
  // El mensaje nombra las DOS salidas porque las dos faltan, y el que lo lee no
  // tiene cómo saber cuál le toca: decir sólo "este tenant no tiene cuenta" mandaba
  // a cargar una cuenta propia a alguien cuyo deploy simplemente no tiene la global.
  // Es el texto que ve quien sube una foto —de producto, de variante, de categoría o
  // el logo—, porque todos esos puntos muestran el mensaje del backend tal cual.
  throw createError(
    "No hay dónde subir la imagen: esta tienda no tiene cuenta de Cloudinary propia y la plataforma tampoco tiene una configurada. Conectá una cuenta en Configuración → Cuenta de Cloudinary, o pedile al equipo que cargue la de la plataforma",
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
 * **Las opciones van PRIMERAS, y no es lo que parece.** `lib/api.js` declara
 * `ping(callback, options)`, pero eso NO es lo que estamos llamando: `v2/api.js` publica
 * los métodos a través de `v1_adapter` (`lib/utils/index.js`), que toma
 * `args[num_pass_args]` como options y recién adentro reordena a la firma vieja. Para
 * `ping` el mapping es `ping: 0` — cero argumentos posicionales—, así que el PRIMER
 * argumento es el objeto de opciones.
 *
 * Pasarlas segundas —`ping(undefined, opciones)`— no da error de tipos: el objeto se toma
 * como callback, las credenciales nunca llegan y el ping termina resolviéndose contra la
 * config global. Con la cuenta de plataforma cargada eso devuelve "ok" **para cualquier
 * credencial inventada**; sin ella (el deploy donde cada cliente trae la suya) revienta con
 * `Must supply cloud_name` y el usuario ve "Cloudinary rechazó esas credenciales" con las
 * credenciales correctas en la mano. Las dos caras del mismo error costaron un día.
 *
 * `uploader.upload` y `uploader.destroy` sí llevan las opciones al final, y tampoco es
 * casualidad: su mapping es `upload: 1` / `destroy: 1`, o sea un argumento posicional
 * (el archivo, el public_id) y las opciones después. La regla del SDK es "options va
 * justo después de los argumentos posicionales", no "options va al final".
 *
 * **Devuelve el motivo y no un booleano**, y `rejected` es el campo que importa. Un
 * `false` pelado obligaba al llamador a inventar una causa, y la que inventaba era
 * siempre "las credenciales están mal": un DNS que no resuelve desde el server, un
 * timeout o el tope del Admin API se le mostraban al que carga la cuenta como "revisá el
 * API secret", mandándolo a arreglar lo único que no estaba roto. Son dos preguntas
 * distintas —si Cloudinary CONTESTÓ rechazando, o si no llegamos a Cloudinary— y la
 * respuesta HTTP que corresponde a cada una tampoco es la misma.
 *
 * @returns {Promise<{ok: boolean, rejected: boolean, status?: number, reason?: string}>}
 */
export async function verifyCredentials({ cloudName, apiKey, apiSecret }) {
  // El mensaje del proveedor sale al log y ahora también al panel. No hay motivo para
  // confiar en que nunca ecoe lo que le mandamos: si el secreto aparece ahí, se tacha.
  const sinSecreto = (texto) =>
    typeof texto === "string" && apiSecret
      ? texto.split(apiSecret).join("«api secret»")
      : texto;

  try {
    const result = await cloudinary.api.ping({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
    });

    if (result?.status === "ok") return { ok: true, rejected: false };

    // Contestó algo que no es "ok". No debería pasar, pero es una respuesta del
    // proveedor igual: cae del lado de "contestó que no", no del de "no contestó".
    return {
      ok: false,
      rejected: true,
      reason: `Cloudinary respondió "${result?.status ?? "sin status"}"`,
    };
  } catch (err) {
    // El SDK anida la respuesta del proveedor en `err.error`; un error de red llega como
    // Error de Node, con `code` (ENOTFOUND, ETIMEDOUT, EAI_AGAIN) y sin `http_code`. Que
    // haya código HTTP es exactamente la diferencia entre las dos preguntas de arriba.
    const status = err?.error?.http_code ?? err?.http_code;
    const reason = sinSecreto(err?.error?.message || err?.message) || err?.code;
    const rejected = typeof status === "number";

    // El log se queda igual de completo aunque el panel muestre el detalle: es lo único
    // que hay cuando el que reporta el problema no puede copiar la respuesta.
    log.warn(
      { err: reason, status, rejected, cloudName },
      "el ping a Cloudinary con las credenciales nuevas falló"
    );

    return { ok: false, rejected, status, reason };
  }
}

export default cloudinary;
