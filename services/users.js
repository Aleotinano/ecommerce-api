import prisma from "../lib/prisma.js";
import { hashPassword, verifyPassword } from "../helpers/password.js";
import { createError } from "../helpers/error.js";
import { slugify, suggestSlugAlternatives } from "../lib/slug.js";
import {
  generateEmailVerificationToken,
  hashToken,
} from "../lib/tokens.js";
import { sendMail, buildVerificationEmail } from "../lib/mailer.js";
import { logger } from "../lib/logger.js";
import jwt from "jsonwebtoken";
import { DEFAULTS } from "../config.js";

const log = logger.child({ module: "users" });

const tenantSlugExists = async (slug) =>
  !!(await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true },
  }));

function buildVerifyUrl(token) {
  const base = DEFAULTS.APP_URL.replace(/\/$/, "");
  return `${base}/auth/verify-email?token=${encodeURIComponent(token)}`;
}

async function dispatchVerificationEmail({ user, tenantName }) {
  const { token, tokenHash, expiresAt } = generateEmailVerificationToken();

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: expiresAt,
    },
  });

  const verifyUrl = buildVerifyUrl(token);
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
  async register({ username, password, email, tenantName }) {
    const slug = slugify(tenantName);

    if (await tenantSlugExists(slug)) {
      const suggestions = await suggestSlugAlternatives(slug, tenantSlugExists);
      throw createError("El tenant ya existe", "TENANT_EXISTS", 409, {
        slug,
        suggestions,
      });
    }

    const emailTaken = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (emailTaken) {
      throw createError("El email ya está registrado", "EMAIL_EXISTS", 409);
    }

    const hashedPassword = await hashPassword(password);

    const { user, tenant } = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { slug, name: tenantName },
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          username,
          email,
          password: hashedPassword,
          role: "ADMIN",
        },
      });

      return { user, tenant };
    });

    await dispatchVerificationEmail({ user, tenantName: tenant.name });

    return { user, tenant };
  },

  async login({ email, password }) {
    const user = await prisma.user.findUnique({
      where: { email },
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

  async resendVerification({ email }) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { tenant: { select: { name: true } } },
    });

    if (!user || user.emailVerified) {
      return { sent: false };
    }

    await dispatchVerificationEmail({
      user,
      tenantName: user.tenant?.name,
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
