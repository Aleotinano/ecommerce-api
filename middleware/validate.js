export const validate = (schemas) => {
  return (req, res, next) => {
    try {
      // Validar body
      if (schemas.body) {
        const result = schemas.body.safeParse(req.body);
        if (!result.success) {
          return res.status(400).json({
            message: "Error de validación",
            errors: result.error.flatten().fieldErrors,
          });
        }
        req.body = result.data;
      }

      // Validar params
      if (schemas.params) {
        const result = schemas.params.safeParse(req.params);
        if (!result.success) {
          return res.status(400).json({
            message: "Error de validación en parámetros",
            errors: result.error.flatten().fieldErrors,
          });
        }
        req.params = result.data;
      }

      // Validar query
      if (schemas.query) {
        const result = schemas.query.safeParse(req.query);
        if (!result.success) {
          return res.status(400).json({
            message: "Error de validación en query",
            errors: result.error.flatten().fieldErrors,
          });
        }
        req.search = result.data;
      }

      next();
    } catch (error) {
      return res.status(500).json({
        message: "Error interno de validación",
        error: error.message,
      });
    }
  };
};
