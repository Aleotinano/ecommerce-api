import { createError } from "../../helpers/error.js";
import * as cloudinaryAdapter from "./cloudinary.js";
import { DEFAULT_STORAGE_PROVIDER, SIGNED_URL_TTL_SECONDS } from "./constants.js";

/**
 * Puerto de almacenamiento de archivos **privados** (hoy: los comprobantes de
 * transferencia). Tres operaciones y un adaptador detrás.
 *
 * Por qué existe teniendo `lib/imageManager.js`: aquel sube imágenes públicas de
 * catálogo y está bien así. Esto guarda documentos con CBU, nombre y a veces el
 * saldo de una cuenta, y el día que haya que mudarlos —a S3, a R2— no quiero
 * buscar llamadas a Cloudinary desparramadas por el servicio. Acá se cambia un
 * archivo y listo.
 *
 * **`tenantId` viaja en la firma desde el día uno**: el modelo de negocio es una
 * cuenta de Cloudinary por cliente, así que el adaptador resuelve credenciales por
 * tenant (ver lib/cloudinary.js). En `putFile` viene en las opciones; en
 * `signedUrl`/`deleteFile` sale de la fila del asset, junto con el `cloudName` que
 * dice en qué cuenta quedó.
 */

const ADAPTERS = {
  cloudinary: cloudinaryAdapter,
};

function adapterFor(provider) {
  const adapter = ADAPTERS[provider];

  if (!adapter) {
    throw createError(
      `Proveedor de almacenamiento desconocido: ${provider}`,
      "STORAGE_PROVIDER_UNKNOWN",
      500
    );
  }

  return adapter;
}

/**
 * Sube un archivo local y devuelve el descriptor que hay que persistir para
 * volver a encontrarlo. El temporal se borra siempre, haya salido bien o mal.
 *
 * @param {string} filePath
 * @param {object} p
 * @param {number} p.tenantId
 * @param {string} p.entity        carpeta lógica, ej. `"receipts"`
 * @param {string} p.mimeType      decide el tipo de recurso (PDF → raw)
 * @param {"private"|"public"} [p.access="private"]
 * @returns {Promise<{ storageProvider, cloudName, publicId, resourceType, deliveryType, format, bytes }>}
 */
export async function putFile(filePath, options) {
  const storageProvider = DEFAULT_STORAGE_PROVIDER;
  const stored = await adapterFor(storageProvider).putFile(filePath, options);

  return { storageProvider, ...stored };
}

/**
 * URL de un solo uso práctico: firmada y con vencimiento
 * (`SIGNED_URL_TTL_SECONDS`). Se emite **en cada respuesta** y no se persiste
 * nunca — persistirla volvería el archivo legible para siempre por cualquiera que
 * viera el link una vez, que es exactamente lo que este diseño evita.
 *
 * Es `async` porque firmar necesita las credenciales del tenant, que salen de la
 * DB (con cache; el camino caliente no pega a la DB, pero la firma tiene que
 * soportar el frío).
 *
 * @param {object} asset fila con `storageProvider`/`tenantId`/`cloudName`/`publicId`/`resourceType`/`deliveryType`/`format`
 */
export async function signedUrl(
  asset,
  { ttlSeconds = SIGNED_URL_TTL_SECONDS } = {}
) {
  return adapterFor(asset.storageProvider).signedUrl(asset, { ttlSeconds });
}

/** Borra el archivo del proveedor. El provider sale de la fila, no del default. */
export async function deleteFile(asset) {
  await adapterFor(asset.storageProvider).deleteFile(asset);
}

export { SIGNED_URL_TTL_SECONDS, RECEIPT_RETENTION_MONTHS } from "./constants.js";
