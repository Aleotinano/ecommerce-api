import jwt from "jsonwebtoken";
import { DEFAULTS } from "../config.js";

export const verifyToken = (req, res, next) => {
  const token = req.cookies.access_token;
  req.session = { user: null };

  if (!token) {
    return res.status(401).json({
      message: "Debes iniciar sesión",
    });
  }

  try {
    const decoded = jwt.verify(token, DEFAULTS.SECRET_JWT_KEY);

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      message: "Error al verificar token",
    });
  }
};
