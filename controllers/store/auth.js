import { UserModel } from "../../services/users.js";
import { DEFAULTS } from "../../config.js";
import jwt from "jsonwebtoken";

export class StoreAuthController {
  static async register(req, res, next) {
    try {
      const { username, password, email } = req.body;
      const { user } = await UserModel.registerCustomer({
        tenantId: req.tenantId,
        username,
        password,
        email,
      });

      return res.status(201).json({
        message: "Cuenta creada. Revisá tu email para verificar la cuenta.",
        usuario: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          emailVerified: user.emailVerified,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async login(req, res, next) {
    try {
      const { email, password } = req.body;

      const { user, tenant } = await UserModel.loginForTenant({
        email,
        password,
        tenantId: req.tenantId,
      });

      const tokenData = {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email,
        tenantId: user.tenantId,
      };

      const token = jwt.sign(tokenData, DEFAULTS.SECRET_JWT_KEY, {
        expiresIn: "8h",
      });

      return res.json({
        message: `Bienvenido ${user.username}`,
        token,
        usuario: {
          id: user.id,
          username: user.username,
          role: user.role,
        },
        tenant: { slug: tenant.slug },
      });
    } catch (error) {
      next(error);
    }
  }

  static async me(req, res, next) {
    try {
      return res.json({
        usuario: {
          id: req.user.id,
          username: req.user.username,
          email: req.user.email,
          role: req.user.role,
          tenantId: req.user.tenantId,
        },
        tenant: { slug: req.tenantSlug },
      });
    } catch (error) {
      next(error);
    }
  }

  static async logout(_req, res) {
    return res.clearCookie("access_token").json({ message: "Sesión cerrada" });
  }

  static async verifyEmail(req, res, next) {
    try {
      const { token } = req.query;
      const { alreadyVerified } = await UserModel.verifyEmail({ token });
      return res.json({
        message: alreadyVerified
          ? "El email ya estaba verificado"
          : "Email verificado correctamente",
        alreadyVerified,
      });
    } catch (error) {
      next(error);
    }
  }

  static async resendVerification(req, res, next) {
    try {
      const { email } = req.body;
      await UserModel.resendVerification({ email, tenantId: req.tenantId });
      return res.json({
        message: "Si el email existe y no está verificado, te enviamos un nuevo link.",
      });
    } catch (error) {
      next(error);
    }
  }
}
