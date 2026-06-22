import nodemailer from "nodemailer";
import { DEFAULTS } from "../config.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "mailer" });

let transporter = null;

export function isSmtpConfigured() {
  return !!(DEFAULTS.SMTP.HOST && DEFAULTS.SMTP.PORT);
}

function getTransporter() {
  if (transporter) return transporter;

  if (isSmtpConfigured()) {
    transporter = nodemailer.createTransport({
      host: DEFAULTS.SMTP.HOST,
      port: DEFAULTS.SMTP.PORT,
      secure: DEFAULTS.SMTP.SECURE,
      auth:
        DEFAULTS.SMTP.USER && DEFAULTS.SMTP.PASS
          ? { user: DEFAULTS.SMTP.USER, pass: DEFAULTS.SMTP.PASS }
          : undefined,
    });
  } else {
    transporter = nodemailer.createTransport({
      jsonTransport: true,
    });
  }
  return transporter;
}

export async function sendMail({ to, subject, html, text }) {
  const t = getTransporter();
  const from = DEFAULTS.SMTP.FROM;

  const info = await t.sendMail({ from, to, subject, html, text });

  if (!isSmtpConfigured()) {
    log.info(
      { to, subject, preview: text || html },
      "[DEV] Email no enviado (SMTP no configurado) — log local"
    );
  } else {
    log.info({ to, subject, messageId: info.messageId }, "email enviado");
  }

  return info;
}

const ORDER_STATUS_COPY = {
  PENDING: {
    label: "pendiente",
    message: "Recibimos tu pedido y está pendiente de procesamiento.",
  },
  PROCESSING: {
    label: "en preparación",
    message: "¡Buenas noticias! Estamos preparando tu pedido.",
  },
  COMPLETED: {
    label: "completado",
    message: "Tu pedido fue completado. ¡Gracias por tu compra!",
  },
  CANCELLED: {
    label: "cancelado",
    message: "Tu pedido fue cancelado. Si tenés dudas, contactanos.",
  },
};

export function buildOrderStatusEmail({ orderId, status, tenantName }) {
  const copy = ORDER_STATUS_COPY[status] ?? {
    label: status,
    message: `El estado de tu pedido cambió a ${status}.`,
  };
  const store = tenantName ? ` en ${tenantName}` : "";
  const subject = `Tu pedido #${orderId}${store} está ${copy.label}`;
  const text = [
    `Pedido #${orderId}${store}`,
    ``,
    copy.message,
    ``,
    `Estado actual: ${copy.label.toUpperCase()}`,
  ].join("\n");
  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5">
      <h2>Pedido #${orderId}</h2>
      <p>${copy.message}</p>
      <p>Estado actual: <strong>${copy.label.toUpperCase()}</strong></p>
      ${tenantName ? `<p style="color:#666;font-size:12px">${tenantName}</p>` : ""}
    </div>
  `;
  return { subject, text, html };
}

export function buildVerificationEmail({ verifyUrl, tenantName }) {
  const subject = `Verificá tu email${tenantName ? ` para ${tenantName}` : ""}`;
  const text = [
    `Para activar tu cuenta hacé clic en el siguiente link:`,
    verifyUrl,
    ``,
    `El link expira en 24 horas. Si no creaste esta cuenta, ignorá este mail.`,
  ].join("\n");
  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5">
      <h2>Verificá tu email</h2>
      <p>Para activar tu cuenta hacé clic en el siguiente botón:</p>
      <p><a href="${verifyUrl}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:6px">Verificar email</a></p>
      <p>O copiá esta URL en el navegador:<br/><code>${verifyUrl}</code></p>
      <p style="color:#666;font-size:12px">El link expira en 24 horas. Si no creaste esta cuenta, ignorá este mail.</p>
    </div>
  `;
  return { subject, text, html };
}
