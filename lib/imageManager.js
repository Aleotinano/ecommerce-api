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

export async function deleteCloudinaryImage(imgPublicId) {
  if (!imgPublicId) return;

  await cloudinary.uploader.destroy(imgPublicId, {
    resource_type: "image",
    invalidate: true,
  });
}
