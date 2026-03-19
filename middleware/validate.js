import { cleanupUploadedImage } from "./upload.js";

export const validate = (schemas) => {
  return (req, res, next) => {
    const fail = (status, message, errors) => {
      void cleanupUploadedImage(req);
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
      void cleanupUploadedImage(req);
      return res.status(500).json({
        message: "Error interno de validacion",
        error: error.message,
      });
    }
  };
};
