import fs from "node:fs";
import path from "node:path";

import multer from "multer";

import { createError } from "../helpers/error.js";
import { removeLocalFile } from "../lib/imageManager.js";

const TEMP_UPLOAD_DIR = path.resolve(process.cwd(), "tmp", "uploads");
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TEMP_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname) || "";
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
  },
});

const uploader = multer({
  storage,
  limits: {
    fileSize: MAX_IMAGE_SIZE,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      cb(
        createError(
          "Formato de imagen no soportado. Use JPG, PNG, WEBP o AVIF.",
          "INVALID_IMAGE_TYPE",
          400
        )
      );
      return;
    }

    cb(null, true);
  },
}).fields([
  { name: "image", maxCount: 1 },
  { name: "img", maxCount: 1 },
]);

export function uploadImage(req, res, next) {
  uploader(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        next(
          createError(
            "La imagen supera el tamano maximo permitido de 5MB.",
            "IMAGE_TOO_LARGE",
            400
          )
        );
        return;
      }

      next(createError(error.message, "UPLOAD_ERROR", 400));
      return;
    }

    next(error);
  });
}

export function getUploadedImageFile(req) {
  if (!req.files) return null;

  return req.files.image?.[0] ?? req.files.img?.[0] ?? null;
}

export async function cleanupUploadedImage(req) {
  const file = getUploadedImageFile(req);
  await removeLocalFile(file?.path);
}

const normalizeBodyValue = (value) => {
  if (Array.isArray(value)) {
    return value.map(normalizeBodyValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        normalizeBodyValue(nestedValue),
      ])
    );
  }

  if (typeof value !== "string") {
    return value;
  }

  const trimmedValue = value.trim();

  if (trimmedValue === "null") return null;
  if (trimmedValue === "true") return true;
  if (trimmedValue === "false") return false;

  if (
    (trimmedValue.startsWith("[") && trimmedValue.endsWith("]")) ||
    (trimmedValue.startsWith("{") && trimmedValue.endsWith("}"))
  ) {
    try {
      return normalizeBodyValue(JSON.parse(trimmedValue));
    } catch {
      return value;
    }
  }

  return value;
};

export function normalizeMultipartBody(req, _res, next) {
  if (req.is("multipart/form-data")) {
    req.body = normalizeBodyValue(req.body);
  }

  next();
}

export function requireBodyOrImage(req, _res, next) {
  const hasBodyFields = Object.keys(req.body ?? {}).length > 0;
  const hasImage = Boolean(getUploadedImageFile(req));

  if (hasBodyFields || hasImage) {
    next();
    return;
  }

  next(
    createError(
      "Debe proporcionar al menos un campo o una imagen para actualizar.",
      "EMPTY_UPDATE",
      400
    )
  );
}
