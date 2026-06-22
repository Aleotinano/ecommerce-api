/**
 * Resolucion de tenant por el `phone_number_id` del numero de WhatsApp.
 *
 * El webhook NO trae slug ni host: trae el `phone_number_id` del numero de la
 * marca que recibe el mensaje. Lo mapeamos al tenant via
 * `TenantConfig.whatsappPhoneNumberId` (la DB es la fuente de verdad, igual en
 * dev y en prod). Sin match o tenant inactivo -> null (el caller ignora).
 *
 * Tambien resolvemos aca el access token saliente: el de la marca (cifrado en
 * `whatsappAccessToken`, descifrado on-the-fly) y, si no hay, el token global de
 * env. El token NUNCA viene del cliente ni del LLM.
 */
import prisma from "../../lib/prisma.js";
import { DEFAULTS } from "../../config.js";
import { decryptSecret } from "../../lib/crypto.js";
import { logger } from "../../lib/logger.js";

const log = logger.child({ module: "whatsapp:tenant-resolver" });

/**
 * @param {string} phoneNumberId
 * @returns {Promise<{ tenantId: number, accessToken: string | undefined } | null>}
 */
export async function resolveTenantByPhoneNumberId(phoneNumberId) {
  if (!phoneNumberId) return null;

  const config = await prisma.tenantConfig.findUnique({
    where: { whatsappPhoneNumberId: phoneNumberId },
    select: {
      tenantId: true,
      whatsappAccessToken: true,
      tenant: { select: { isActive: true } },
    },
  });

  if (!config || !config.tenant?.isActive) return null;

  return {
    tenantId: config.tenantId,
    accessToken: resolveAccessToken(config),
  };
}

/**
 * Token de la marca (descifrado) o, si no hay / falla el descifrado, el token
 * global de env. Un dato corrupto no debe romper el envio: logueamos y caemos
 * al fallback.
 */
function resolveAccessToken({ tenantId, whatsappAccessToken }) {
  if (!whatsappAccessToken) return DEFAULTS.WHATSAPP.ACCESS_TOKEN;
  try {
    return decryptSecret(whatsappAccessToken);
  } catch (err) {
    log.error(
      { err: err.message, tenantId },
      "no se pudo descifrar el access token del tenant, usando token de env",
    );
    return DEFAULTS.WHATSAPP.ACCESS_TOKEN;
  }
}
