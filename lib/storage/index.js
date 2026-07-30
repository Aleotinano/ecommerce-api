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
 * **`tenantId` viaja en la firma de `putFile` desde el día uno** aunque el
 * adaptador de hoy lo use solo para armar la carpeta: el modelo de negocio es una
 * cuenta de Cloudinary por cliente, y cuando eso se implemente el cambio tiene que
 * quedar adentro del adaptador y no subir hasta acá.
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
 * @returns {Promise<{ storageProvider, publicId, resourceType, deliveryType, format, bytes }>}
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
 * @param {object} asset fila con `storageProvider`/`publicId`/`resourceType`/`deliveryType`/`format`
 */
export function signedUrl(asset, { ttlSeconds = SIGNED_URL_TTL_SECONDS } = {}) {
  return adapterFor(asset.storageProvider).signedUrl(asset, { ttlSeconds });
}

/** Borra el archivo del proveedor. El provider sale de la fila, no del default. */
export async function deleteFile(asset) {
  await adapterFor(asset.storageProvider).deleteFile(asset);
}

export { SIGNED_URL_TTL_SECONDS, RECEIPT_RETENTION_MONTHS } from "./constants.js";
