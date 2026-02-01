export const requireRole = (allowedRoles = []) => {
  // allowedRoles = roles con acceso permitidos

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        message: "No autorizado",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: "Acceso denegado",
        requiredRole: [allowedRoles],
        username: req.user.username,
        yourRole: req.user.role,
      });
    }

    // Usuario tiene el rol correcto, continuar
    next();
  };
};
