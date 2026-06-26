import fs from "node:fs/promises";
import path from "node:path";

import { DEFAULTS } from "../config.js";
import cloudinary from "./cloudinary.js";

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

export async function uploadImageToCloudinary(filePath, { entity }) {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
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
export async function uploadBase64ToCloudinary({ data, mimeType = "image/png" }, { entity }) {
  const dataUri = `data:${mimeType};base64,${data}`;

  const result = await cloudinary.uploader.upload(dataUri, {
    folder: path.posix.join(DEFAULTS.CLOUDINARY_FOLDER, entity),
    resource_type: "image",
  });

  return {
    img: result.secure_url,
    imgPublicId: result.public_id,
  };
}

export async function deleteCloudinaryImage(imgPublicId) {
  if (!imgPublicId) return;

  await cloudinary.uploader.destroy(imgPublicId, {
    resource_type: "image",
    invalidate: true,
  });
}
