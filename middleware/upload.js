import fs from "node:fs";
import path from "node:path";

import multer from "multer";

import { createError } from "../helpers/error.js";
import { removeLocalFile } from "../lib/imageManager.js";

const TEMP_UPLOAD_DIR = path.resolve(process.cwd(), "tmp", "uploads");
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
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
            "La imagen supera el tamano maximo permitido de 10MB.",
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

/* ------------------------------------------------------------------ *
 * Comprobantes de transferencia
 *
 * Middleware aparte y NO una flexibilización de `uploadImage`: aquel lo
 * comparten productos, categorías y el logo del tenant, así que aflojarle el
 * filtro para aceptar PDF habilitaría subir un PDF como imagen de producto.
 * ------------------------------------------------------------------ */

const RECEIPT_PDF_TYPE = "application/pdf";

// Las mismas imágenes que acepta el catálogo, más PDF: los home banking exportan
// el comprobante en PDF, y si no lo aceptamos la persona termina sacándole una
// captura (que además pesa ~3× más que el PDF original).
const ALLOWED_RECEIPT_TYPES = new Set([
  ...ALLOWED_IMAGE_TYPES,
  RECEIPT_PDF_TYPE,
]);

const receiptUploader = multer({
  storage,
  limits: {
    fileSize: MAX_IMAGE_SIZE,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_RECEIPT_TYPES.has(file.mimetype)) {
      cb(
        createError(
          "Formato de comprobante no soportado. Use JPG, PNG, WEBP, AVIF o PDF.",
          "INVALID_RECEIPT_TYPE",
          400
        )
      );
      return;
    }

    cb(null, true);
  },
}).fields([{ name: "receipt", maxCount: 1 }]);

/**
 * Firmas reales de cada formato. El `mimetype` que trae multer lo **declara el
 * cliente** en el multipart: no es una comprobación de nada. Ahora que aceptamos
 * un tipo que puede transportar contenido activo, vale los pocos bytes que cuesta
 * mirar el archivo de verdad.
 */
const RECEIPT_MAGIC = {
  "image/jpeg": (head) =>
    head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
  "image/png": (head) =>
    head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (head) =>
    head.subarray(0, 4).toString("ascii") === "RIFF" &&
    head.subarray(8, 12).toString("ascii") === "WEBP",
  // AVIF es un ISO-BMFF: caja `ftyp` en el byte 4 y una marca conocida detrás.
  "image/avif": (head) => {
    if (head.subarray(4, 8).toString("ascii") !== "ftyp") return false;
    const brand = head.subarray(8, 12).toString("ascii");
    return ["avif", "avis", "mif1", "msf1"].includes(brand);
  },
  [RECEIPT_PDF_TYPE]: (head) => head.subarray(0, 5).toString("ascii") === "%PDF-",
};

async function readFileHead(filePath, length = 16) {
  const handle = await fs.promises.open(filePath, "r");

  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Rechaza el archivo cuyo contenido no se corresponde con el tipo declarado.
 * Borra el temporal antes de cortar: si no llega al controller, nadie más lo va a
 * limpiar.
 */
async function assertReceiptContent(req, _res, next) {
  const file = getUploadedReceiptFile(req);

  if (!file) {
    next();
    return;
  }

  try {
    const head = await readFileHead(file.path);
    const matches = RECEIPT_MAGIC[file.mimetype];

    if (!matches || !matches(head)) {
      await removeLocalFile(file.path);
      next(
        createError(
          "El contenido del archivo no coincide con el formato declarado.",
          "INVALID_RECEIPT_TYPE",
          400
        )
      );
      return;
    }

    next();
  } catch (error) {
    await removeLocalFile(file.path).catch(() => {});
    next(error);
  }
}

/**
 * Cadena completa de subida de un comprobante: multer + verificación real del
 * contenido. Va como array para que ninguna ruta pueda quedarse con la mitad.
 *
 * El archivo es **opcional** en todas las rutas que lo usan: `confirm-transfer`
 * acepta el mismo request en JSON puro, sin comprobante.
 */
export const uploadReceipt = [
  function uploadReceiptFile(req, res, next) {
    receiptUploader(req, res, (error) => {
      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          next(
            createError(
              "El comprobante supera el tamaño máximo permitido de 10MB.",
              "RECEIPT_TOO_LARGE",
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
  },
  assertReceiptContent,
];

export function getUploadedReceiptFile(req) {
  if (!req.files) return null;

  return req.files.receipt?.[0] ?? null;
}

export async function cleanupUploadedReceipt(req) {
  const file = getUploadedReceiptFile(req);
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
