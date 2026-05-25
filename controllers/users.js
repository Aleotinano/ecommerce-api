import { UserModel } from "../services/users.js";
import { DEFAULTS } from "../config.js";
import jwt from "jsonwebtoken";

export class usersController {
  static async register(req, res, next) {
    try {
      const { username, password, email, tenantName } = req.body;
      const { user, tenant } = await UserModel.register({
        username,
        password,
        email,
        tenantName,
      });

      return res.status(201).json({
        message:
          "Tenant y usuario registrados. Revisá tu email para verificar la cuenta.",
        usuario: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          emailVerified: user.emailVerified,
        },
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async login(req, res, next) {
    try {
      const { email, password } = req.body;

      const { user, tenant } = await UserModel.login({ email, password });

      const dataPublic = {
        username: user.username,
        role: user.role,
      };
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

      return res
        .cookie("access_token", token, {
          httpOnly: true,
          secure: DEFAULTS.NODE_ENV === "production",
          sameSite: "strict",
          maxAge: 1000 * 60 * 60 * 8,
        })
        .json({
          message: `Bienvenido ${dataPublic.username}`,
          usuario: dataPublic,
          tenant: { slug: tenant.slug },
        });
    } catch (error) {
      next(error);
    }
  }

  static async me(req, res, next) {
    try {
      const token = req.cookies?.access_token;
      const data = await UserModel.me({ token });

      return res.json({
        usuario: {
          id: data.id,
          username: data.username,
          email: data.email,
          role: data.role,
          tenantId: data.tenantId,
        },
        tenant: { slug: data.tenantSlug },
      });
    } catch (error) {
      if (error.code === "UNAUTHORIZED" || error.code === "INVALID_TOKEN") {
        return res.status(401).json({ message: error.message });
      }

      return next(error);
    }
  }

  static async logout(req, res) {
    return res.clearCookie("access_token").json({ message: "Sesion cerrada" });
  }

  static async verifyEmail(req, res, next) {
    try {
      const { token } = req.search;
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
      await UserModel.resendVerification({ email });
      return res.json({
        message:
          "Si el email existe y no está verificado, te enviamos un nuevo link.",
      });
    } catch (error) {
      next(error);
    }
  }
}
