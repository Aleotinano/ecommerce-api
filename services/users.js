import prisma from "../lib/prisma.js";
import { hashPassword, verifyPassword } from "../helpers/password.js";
import { createError } from "../helpers/error.js";
import { slugify, suggestSlugAlternatives } from "../lib/slug.js";
import {
  generateEmailVerificationToken,
  hashToken,
} from "../lib/tokens.js";
import { sendMail, buildVerificationEmail, isSmtpConfigured } from "../lib/mailer.js";
import { normalizeCustomerPhone } from "../lib/phone.js";
import {
  DEFAULT_TENANT_PROFILE,
  resolveProfile,
} from "./tenant-profiles.js";
import { logger } from "../lib/logger.js";
import jwt from "jsonwebtoken";
import { DEFAULTS } from "../config.js";

const log = logger.child({ module: "users" });

const tenantSlugExists = async (slug) =>
  !!(await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true },
  }));

function buildVerifyUrl(token, { audience = "admin" } = {}) {
  if (audience === "customer") {
    const base = DEFAULTS.STORE_APP_URL.replace(/\/$/, "");
    return `${base}/cuenta/verify-email?token=${encodeURIComponent(token)}`;
  }
  const base = DEFAULTS.APP_URL.replace(/\/$/, "");
  return `${base}/auth/verify-email?token=${encodeURIComponent(token)}`;
}

async function dispatchVerificationEmail({ user, tenantName, audience = "admin" }) {
  const { token, tokenHash, expiresAt } = generateEmailVerificationToken();

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: expiresAt,
    },
  });

  const verifyUrl = buildVerifyUrl(token, { audience });
  const { subject, html, text } = buildVerificationEmail({
    verifyUrl,
    tenantName,
  });

  try {
    await sendMail({ to: user.email, subject, html, text });
  } catch (err) {
    log.error({ err, userId: user.id }, "fallo enviando email de verificacion");
  }

  return { verifyUrl, expiresAt };
}

export const UserModel = {
  /**
   * Alta de tenant + su primer ADMIN.
   *
   * @param {string} [p.profile] perfil de flujo de venta a aplicar a la config del
   *   tenant (ver `services/tenant-profiles.js`). **No está en `registerSchema` a
   *   propósito**: es un parámetro de service, no un campo que pueda mandar un
   *   cliente HTTP — quién vende con seña y quién solo contra entrega lo decidimos
   *   nosotros, no quien se registra. Por defecto, `estandar` (todo habilitado,
   *   sin seña), que es el comportamiento de siempre.
   * @param {boolean} [p.trusted] el alta la hace un operador desde la consola del
   *   servidor (`prisma/create-tenant.js`), no un desconocido por HTTP. Deja el
   *   email verificado y no manda el correo: pedirle que confirme su propio email
   *   a quien tiene la base de datos delante no prueba nada, y con SMTP
   *   configurado el mail saldría igual hacia una casilla que nadie mira. Mismo
   *   criterio que `profile` — parámetro de service, nunca un campo del request.
   */
  async register({
    username,
    password,
    email,
    tenantName,
    profile = DEFAULT_TENANT_PROFILE,
    trusted = false,
  }) {
    const slug = slugify(tenantName);
    // El alta solo pide el nombre de la tienda; el admin recibe un username
    // genérico. Es el primer usuario del tenant, así que "admin" siempre queda
    // libre (unicidad es por tenant: tenantId_username).
    const adminUsername = username?.trim() || "admin";

    if (await tenantSlugExists(slug)) {
      const suggestions = await suggestSlugAlternatives(slug, tenantSlugExists);
      throw createError("El tenant ya existe", "TENANT_EXISTS", 409, {
        slug,
        suggestions,
      });
    }

    // Antes de la transacción: un nombre de perfil inválido tiene que fallar sin
    // haber creado el tenant a medias.
    const profileValues = resolveProfile(profile);

    const hashedPassword = await hashPassword(password);
    // En dev (sin SMTP) no se puede enviar el correo, así que auto-verificamos
    // para no dejar al usuario trabado. En prod el flujo normal sigue intacto.
    // El alta por consola (`trusted`) tampoco verifica: ver el JSDoc de arriba.
    const autoVerify = trusted || !isSmtpConfigured();

    const { user, tenant } = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { slug, name: tenantName },
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          username: adminUsername,
          email,
          password: hashedPassword,
          role: "ADMIN",
          emailVerified: autoVerify,
        },
      });

      // Inicializa la configuración del tenant para que la pantalla de config
      // tenga un row (sino GET /tenant-config/:id devuelve 404). Los valores del
      // perfil se MATERIALIZAN acá: de ahí en adelante la fuente de verdad son
      // estas columnas, no el perfil — editar un perfil no puede cambiarle las
      // reglas de plata a un tenant que ya está vendiendo.
      await tx.tenantConfig.create({
        data: {
          tenantId: tenant.id,
          storeName: tenantName,
          ...profileValues,
        },
      });

      return { user, tenant };
    });

    if (!autoVerify) {
      await dispatchVerificationEmail({ user, tenantName: tenant.name });
    }

    return { user, tenant };
  },

  /**
   * Datos de contacto guardados del cliente, para prellenar el checkout.
   * El `tenantId` va en el where —y no solo el id— por el mismo motivo que en
   * el resto del service: un id de otro tenant no puede devolver nada.
   */
  async getContactInfo({ userId, tenantId }) {
    return prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { phone: true, username: true, email: true },
    });
  },

  /**
   * Alta de un cliente del storefront.
   *
   * El teléfono es OPCIONAL en el alta aunque el tenant lo tenga en "required":
   * el momento en que se vuelve obligatorio es el checkout, que es cuando hace
   * falta poder contactar a alguien. Exigirlo acá agrega fricción al registro
   * —el punto más frágil del embudo— por un dato que todavía no se usa.
   */
  async registerCustomer({ tenantId, username, email, password, phone }) {
    const emailTaken = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
      select: { id: true },
    });
    if (emailTaken) {
      throw createError("El email ya está registrado en esta tienda", "EMAIL_EXISTS", 409);
    }

    const usernameTaken = await prisma.user.findUnique({
      where: { tenantId_username: { tenantId, username } },
      select: { id: true },
    });
    if (usernameTaken) {
      throw createError("El nombre de usuario ya está en uso", "USERNAME_EXISTS", 409);
    }

    const hashedPassword = await hashPassword(password);
    const autoVerify = !isSmtpConfigured();

    // Un teléfono ilegible se descarta en silencio en vez de cortar el alta:
    // acá todavía no se necesita, y el checkout lo vuelve a pedir (ahí sí con
    // error visible). Se normaliza con los prefijos del tenant.
    const config = await prisma.tenantConfig.findUnique({
      where: { tenantId },
      select: { customerPhoneCountry: true, customerPhoneArea: true },
    });

    const user = await prisma.user.create({
      data: {
        tenantId,
        username,
        email,
        password: hashedPassword,
        role: "CUSTOMER",
        emailVerified: autoVerify,
        phone: normalizeCustomerPhone(phone, {
          country: config?.customerPhoneCountry ?? "54",
          area: config?.customerPhoneArea ?? null,
        }),
      },
    });

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });

    if (!autoVerify) {
      await dispatchVerificationEmail({ user, tenantName: tenant.name, audience: "customer" });
    }

    return { user };
  },

  async loginForTenant({ email, password, tenantId }) {
    const user = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
      include: {
        tenant: { select: { slug: true, isActive: true } },
      },
    });

    const invalidCredentials = createError(
      "Credenciales inválidas",
      "INVALID_CREDENTIALS",
      401
    );

    if (!user || !user.tenant || !user.tenant.isActive) {
      throw invalidCredentials;
    }

    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      throw invalidCredentials;
    }

    if (!user.emailVerified) {
      throw createError(
        "Debes verificar tu email antes de iniciar sesión",
        "EMAIL_NOT_VERIFIED",
        403,
        { email: user.email }
      );
    }

    return { user, tenant: { slug: user.tenant.slug } };
  },

  async login({ email, password }) {
    const user = await prisma.user.findFirst({
      where: { email, role: { in: ["ADMIN", "STAFF"] } },
      include: {
        tenant: { select: { slug: true, isActive: true } },
      },
    });

    const invalidCredentials = createError(
      "Credenciales inválidas",
      "INVALID_CREDENTIALS",
      401
    );

    if (!user || !user.tenant || !user.tenant.isActive) {
      throw invalidCredentials;
    }

    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      throw invalidCredentials;
    }

    if (!user.emailVerified) {
      throw createError(
        "Debes verificar tu email antes de iniciar sesión",
        "EMAIL_NOT_VERIFIED",
        403,
        { email: user.email }
      );
    }

    return { user, tenant: { slug: user.tenant.slug } };
  },

  async verifyEmail({ token }) {
    if (!token || typeof token !== "string") {
      throw createError("Token inválido", "INVALID_VERIFICATION_TOKEN", 400);
    }

    const tokenHash = hashToken(token);

    const user = await prisma.user.findFirst({
      where: { emailVerificationTokenHash: tokenHash },
      select: {
        id: true,
        emailVerified: true,
        emailVerificationExpiresAt: true,
      },
    });

    if (!user) {
      throw createError("Token inválido", "INVALID_VERIFICATION_TOKEN", 400);
    }

    if (user.emailVerified) {
      return { alreadyVerified: true };
    }

    if (
      !user.emailVerificationExpiresAt ||
      user.emailVerificationExpiresAt.getTime() < Date.now()
    ) {
      throw createError(
        "El token de verificación expiró",
        "VERIFICATION_TOKEN_EXPIRED",
        400
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
      },
    });

    return { alreadyVerified: false };
  },

  async resendVerification({ email, tenantId }) {
    const where = tenantId
      ? { tenantId_email: { tenantId, email } }
      : undefined;

    const user = tenantId
      ? await prisma.user.findUnique({ where, include: { tenant: { select: { name: true } } } })
      : await prisma.user.findFirst({ where: { email }, include: { tenant: { select: { name: true } } } });

    if (!user || user.emailVerified) {
      return { sent: false };
    }

    await dispatchVerificationEmail({
      user,
      tenantName: user.tenant?.name,
      audience: user.role === "CUSTOMER" ? "customer" : "admin",
    });

    return { sent: true };
  },

  async me({ token }) {
    if (!token) {
      throw createError("No autenticado", "UNAUTHORIZED", 401);
    }

    let decoded;
    try {
      decoded = jwt.verify(token, DEFAULTS.SECRET_JWT_KEY);
    } catch (error) {
      throw createError("Token invalido", "INVALID_TOKEN", 401);
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: decoded.tenantId },
      select: { slug: true },
    });

    return {
      id: decoded.id,
      username: decoded.username,
      email: decoded.email,
      role: decoded.role,
      tenantId: decoded.tenantId,
      tenantSlug: tenant?.slug ?? null,
    };
  },
};
