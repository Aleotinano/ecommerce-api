import { UserModel } from "../services/users.js";
import { DEFAULTS } from "../config.js";
import jwt from "jsonwebtoken";

const ACCESS_TOKEN_COOKIE = "access_token";
const ACCESS_TOKEN_MAX_AGE = 1000 * 60 * 60 * 8; // 8 h, igual que el JWT
const isProd = DEFAULTS.NODE_ENV === "production";

/**
 * Atributos de identidad de la cookie de sesión del panel, SIN `maxAge`: son los
 * que hay que repetir tal cual en `clearCookie`. Un Set-Cookie de borrado que no
 * los repita el browser lo descarta —cross-site, un Set-Cookie sin
 * `SameSite=None; Secure` no se acepta— y el logout deja la sesión viva.
 *
 * `SameSite=None` en producción no es una relajación gratuita, es la única opción:
 * el panel vive en un dominio (Vercel) y la API en otro (el hostname del Funnel),
 * así que TODA request del panel es cross-site. Con `Strict`, que es lo que había
 * acá, el browser no manda la cookie nunca y **el login no funciona en
 * producción** — mientras que en desarrollo anda perfecto, porque ahí los dos
 * lados son localhost y sí son el mismo site. Es el peor perfil de bug posible:
 * invisible hasta el deploy.
 *
 * `None` exige `Secure`, que sobre el http:// de desarrollo rompería, así que
 * fuera de producción se queda en `Strict`.
 *
 * Lo que esto cambia: `Strict` era la defensa de CSRF de este backend — no hay
 * middleware de CSRF en ningún lado (ver middleware/cors.js). Con `None` la
 * defensa pasa a ser el allowlist de `ORIGINS`: un origen no listado se come un
 * 403 en el preflight, y como la API sólo parsea JSON, un POST de formulario
 * cross-site —el único que no preflightea— no llega a ningún handler con un body
 * que se pueda leer.
 */
const accessTokenCookieAttrs = () => ({
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "strict",
});

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
        .cookie(ACCESS_TOKEN_COOKIE, token, {
          ...accessTokenCookieAttrs(),
          maxAge: ACCESS_TOKEN_MAX_AGE,
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
    // Los atributos van repetidos a propósito: sin ellos el Set-Cookie de borrado
    // no matchea la cookie emitida en el login y la sesión sobrevive al logout.
    return res
      .clearCookie(ACCESS_TOKEN_COOKIE, accessTokenCookieAttrs())
      .json({ message: "Sesion cerrada" });
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
