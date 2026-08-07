/**
 * Imágenes PÚBLICAS de catálogo (productos, categorías, variantes, logo del tenant,
 * sugerencias). Para los archivos privados —comprobantes— está `lib/storage/`.
 *
 * Las tres funciones reciben `tenantId` porque cada cliente puede tener su propia
 * cuenta de Cloudinary: las credenciales se resuelven por tenant en runtime y se
 * pasan en las opciones de cada llamada al SDK (ver lib/cloudinary.js).
 */
import fs from "node:fs/promises";
import path from "node:path";

import { DEFAULTS } from "../config.js";
import cloudinary, {
  ENV_CREDENTIALS,
  credentialsFor,
  isEnvAccount,
  platformAccountConfigured,
} from "./cloudinary.js";

export async function removeLocalFile(filePath) {
  if (!filePath) return;

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

export async function uploadImageToCloudinary(filePath, { tenantId, entity }) {
  const credentials = await credentialsFor(tenantId);

  try {
    const result = await cloudinary.uploader.upload(filePath, {
      ...credentials,
      // La carpeta NO lleva el tenant: el aislamiento entre clientes es la CUENTA,
      // no la carpeta. (En `lib/storage/` sí va, porque ahí lo que se separa son
      // archivos privados dentro de una misma cuenta.)
      folder: path.posix.join(DEFAULTS.CLOUDINARY_FOLDER, entity),
      resource_type: "image",
      use_filename: true,
      unique_filename: true,
    });

    return {
      img: result.secure_url,
      imgPublicId: result.public_id,
    };
  } finally {
    await removeLocalFile(filePath);
  }
}

/**
 * Sube una imagen en base64 (sin archivo en disco) a Cloudinary. La usa la
 * generacion de imagenes publicitarias, cuyas variantes llegan como base64 desde
 * el modelo (lib/llm/image.js), no como upload de un form. Cloudinary acepta un
 * data URI directamente.
 */
export async function uploadBase64ToCloudinary(
  { data, mimeType = "image/png" },
  { tenantId, entity }
) {
  const dataUri = `data:${mimeType};base64,${data}`;
  const credentials = await credentialsFor(tenantId);

  const result = await cloudinary.uploader.upload(dataUri, {
    ...credentials,
    folder: path.posix.join(DEFAULTS.CLOUDINARY_FOLDER, entity),
    resource_type: "image",
  });

  return {
    img: result.secure_url,
    imgPublicId: result.public_id,
  };
}

/**
 * Borra una imagen de catálogo.
 *
 * **El reintento contra la cuenta global no es defensivo, es el caso normal.** Los
 * assets que un tenant subió ANTES de cargar su propia cuenta de Cloudinary se
 * quedaron en la global y no se migran (decisión de producto). Borrarlos contra la
 * cuenta del tenant devuelve `not found` **sin lanzar**, así que sin este reintento
 * cada imagen vieja que alguien borra desde el panel queda huérfana para siempre en
 * la cuenta compartida — pagándola nosotros y sin nadie que se entere.
 *
 * Si la plataforma no tiene cuenta configurada no hay contra qué reintentar, y no
 * hace falta: sin cuenta de plataforma nunca hubo assets viejos ahí.
 */
export async function deleteCloudinaryImage(imgPublicId, { tenantId } = {}) {
  if (!imgPublicId) return;

  const credentials = await credentialsFor(tenantId);
  const result = await destroyImage(imgPublicId, credentials);

  const puedeHaberQuedadoEnLaCuentaDeLaPlataforma =
    platformAccountConfigured() && !isEnvAccount(credentials);

  if (result?.result !== "ok" && puedeHaberQuedadoEnLaCuentaDeLaPlataforma) {
    await destroyImage(imgPublicId, ENV_CREDENTIALS);
  }
}

function destroyImage(imgPublicId, credentials) {
  return cloudinary.uploader.destroy(imgPublicId, {
    ...credentials,
    resource_type: "image",
    invalidate: true,
  });
}
