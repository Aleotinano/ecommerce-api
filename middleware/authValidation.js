import { z } from "zod";

export const authValidation = ({ body }) => {
  return (req, res, next) => {
    const result = body.safeParse(req.body);

    if (!result.success) {
      const flattened = z.flattenError(result.error);

      return res.status(400).json({
        message: "Error de validación",
        errors: flattened.fieldErrors,
      });
    }

    req.body = result.data;
    next();
  };
};
