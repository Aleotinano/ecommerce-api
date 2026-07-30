import { cleanupUploadedImage, cleanupUploadedReceipt } from "./upload.js";

// Multer ya escribió el archivo en disco cuando esto corre: si la validación
// rechaza el request, el temporal se queda ahí para siempre. Se limpian los dos
// campos posibles porque `validate` es genérico y no sabe qué ruta lo montó.
const cleanupUploads = (req) => {
  void cleanupUploadedImage(req);
  void cleanupUploadedReceipt(req);
};

export const validate = (schemas) => {
  return (req, res, next) => {
    const fail = (status, message, errors) => {
      cleanupUploads(req);
      return res.status(status).json({ message, errors });
    };

    try {
      if (schemas.body) {
        const result = schemas.body.safeParse(req.body);
        if (!result.success) {
          return fail(400, "Error de validacion", result.error.flatten().fieldErrors);
        }
        req.body = result.data;
      }

      if (schemas.params) {
        const result = schemas.params.safeParse(req.params);
        if (!result.success) {
          return fail(
            400,
            "Error de validacion en parametros",
            result.error.flatten().fieldErrors
          );
        }
        req.params = result.data;
      }

      if (schemas.query) {
        const result = schemas.query.safeParse(req.query);
        if (!result.success) {
          return fail(400, "Error de validacion en query", result.error.flatten().fieldErrors);
        }
        req.search = result.data;
      }

      next();
    } catch (error) {
      cleanupUploads(req);
      return res.status(500).json({
        message: "Error interno de validacion",
        error: error.message,
      });
    }
  };
};
