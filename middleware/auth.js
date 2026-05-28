import jwt from "jsonwebtoken";
import { DEFAULTS } from "../config.js";

function extractToken(req) {
  const authHeader = req.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return req.cookies?.access_token || null;
}

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

    if (!decoded.tenantId) {
      return res.status(401).json({
        message: "Token sin tenant",
      });
    }

    req.user = decoded;
    req.tenantId = decoded.tenantId;
    next();
  } catch (error) {
    return res.status(401).json({
      message: "Error al verificar token",
    });
  }
};

export const attachUser = (req, res, next) => {
  const token = req.cookies?.access_token;

  if (!token) {
    req.user = null;
    req.tenantId = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, DEFAULTS.SECRET_JWT_KEY);
    req.user = decoded;
    req.tenantId = decoded.tenantId ?? null;
  } catch {
    req.user = null;
    req.tenantId = null;
  }

  next();
};

export const verifyStoreToken = (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ message: "Debes iniciar sesión" });
  }

  try {
    const decoded = jwt.verify(token, DEFAULTS.SECRET_JWT_KEY);

    if (!decoded.tenantId) {
      return res.status(401).json({ message: "Token sin tenant" });
    }

    if (decoded.tenantId !== req.tenantId) {
      return res.status(403).json({ message: "Token no corresponde a esta tienda" });
    }

    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: "Token inválido o expirado" });
  }
};

export const optionalStoreAuth = (req, _res, next) => {
  const token = extractToken(req);

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, DEFAULTS.SECRET_JWT_KEY);
    if (decoded.tenantId === req.tenantId) {
      req.user = decoded;
    } else {
      req.user = null;
    }
  } catch {
    req.user = null;
  }

  next();
};
