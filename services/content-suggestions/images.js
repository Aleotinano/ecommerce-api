/**
 * Persistencia de las variantes de imagen publicitaria generadas para una
 * sugerencia (modelo 1->N SuggestionImage). Capa de almacenamiento: sube a
 * Cloudinary y escribe/borra filas. No genera imagenes (eso es lib/llm/image.js)
 * ni decide angulos: solo guarda y limpia.
 *
 * Ver docs: "Sugerencias de contenido — Imagenes (propuesta)".
 */
import prisma from "../../lib/prisma.js";
import { createError } from "../../helpers/error.js";
import {
  uploadBase64ToCloudinary,
  deleteCloudinaryImage,
} from "../../lib/imageManager.js";

/** Carpeta logica en Cloudinary para los assets de sugerencias. */
const ENTITY = "content-suggestions";

/**
 * Sube las variantes generadas a Cloudinary y las persiste como SuggestionImage
 * (todas con chosen=false; el usuario elige despues con chooseVariant). Tolera
 * fallos parciales de subida: guarda las que suben y descarta las que fallan, sin
 * romper la operacion. Devuelve las filas creadas.
 *
 * @param {object} args
 * @param {number} args.suggestionId
 * @param {number} args.tenantId
 * @param {Array<{ data: string, mimeType: string }>} args.variants - imagenes base64.
 * @param {object} [args.options] - toggles usados (imagen/info/precio en pantalla).
 * @param {string|null} [args.model] - modelo de imagen (null si hubo degradacion).
 * @param {string} args.prompt - prompt final que genero las variantes.
 * @returns {Promise<Array>} filas SuggestionImage creadas.
 */
export const persistVariants = async ({
  suggestionId,
  tenantId,
  variants = [],
  options = {},
  model = null,
  prompt,
}) => {
  const uploaded = [];
  for (const variant of variants) {
    try {
      const { img, imgPublicId } = await uploadBase64ToCloudinary(variant, {
        entity: ENTITY,
      });
      uploaded.push({ imageUrl: img, imagePublicId: imgPublicId });
    } catch {
      // Subida fallida de una variante: la salteamos (best-effort).
    }
  }

  if (!uploaded.length) return [];

  return prisma.$transaction(
    uploaded.map((u) =>
      prisma.suggestionImage.create({
        data: {
          suggestionId,
          tenantId,
          imageUrl: u.imageUrl,
          imagePublicId: u.imagePublicId,
          options,
          model,
          prompt,
        },
      })
    )
  );
};

/**
 * Marca una variante como elegida (chosen=true) y limpia las demas de la misma
 * sugerencia: borra sus assets de Cloudinary (best-effort) y sus filas. Asi no se
 * acumulan assets huerfanos. Lanza 404 si la variante no es del tenant/sugerencia.
 *
 * @returns {Promise<object>} la variante elegida (chosen=true).
 */
export const chooseVariant = async ({ tenantId, suggestionId, imageId }) => {
  const target = await prisma.suggestionImage.findFirst({
    where: { id: imageId, suggestionId, tenantId },
  });
  if (!target) {
    throw createError(
      "Variante de imagen no encontrada",
      "SUGGESTION_IMAGE_NOT_FOUND",
      404
    );
  }

  const others = await prisma.suggestionImage.findMany({
    where: { suggestionId, tenantId, id: { not: imageId } },
  });

  // Borrar los assets de Cloudinary de las otras variantes (best-effort: un fallo
  // de borrado en el CDN no debe abortar la eleccion).
  await Promise.allSettled(
    others.map((o) => deleteCloudinaryImage(o.imagePublicId))
  );
  await prisma.suggestionImage.deleteMany({
    where: { suggestionId, tenantId, id: { not: imageId } },
  });

  return prisma.suggestionImage.update({
    where: { id: imageId },
    data: { chosen: true },
  });
};

/**
 * Borra una variante puntual: su asset en Cloudinary (best-effort) y su fila.
 * Lanza 404 si no es del tenant.
 */
export const deleteVariant = async ({ tenantId, imageId }) => {
  const target = await prisma.suggestionImage.findFirst({
    where: { id: imageId, tenantId },
  });
  if (!target) {
    throw createError(
      "Variante de imagen no encontrada",
      "SUGGESTION_IMAGE_NOT_FOUND",
      404
    );
  }

  await deleteCloudinaryImage(target.imagePublicId).catch(() => {});
  await prisma.suggestionImage.delete({ where: { id: imageId } });

  return { id: imageId };
};
