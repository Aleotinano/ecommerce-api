/**
 * Cifrado simetrico de secretos en reposo (AES-256-GCM).
 *
 * Lo usamos para guardar secretos per-tenant en la DB sin dejarlos en texto plano:
 * el access token de WhatsApp y las credenciales de Cloudinary del cliente. El
 * formato serializado es `iv:authTag:ciphertext`, los tres en base64, en un unico
 * string (cabe en una columna `String?`).
 *
 * La clave sale de env `SECRET_ENC_KEY` (32 bytes en hex de 64 chars o en base64).
 * Si falta o es invalida, cifrar/descifrar lanza: degradamos CERRADO (sin clave no
 * se guardan ni se usan secretos de DB).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // recomendado para GCM
const KEY_BYTES = 32; // AES-256

/**
 * Resuelve la clave de 32 bytes desde env. Acepta hex (64 chars) o base64.
 * @returns {Buffer}
 */
function getKey() {
  // `WHATSAPP_TOKEN_ENC_KEY` es el nombre viejo, de cuando el unico secreto en
  // reposo era el token de WhatsApp. Se sigue aceptando para no tener que tocar
  // ningun `.env` ni el deploy; el nombre a usar de ahora en mas es el generico.
  const raw = process.env.SECRET_ENC_KEY || process.env.WHATSAPP_TOKEN_ENC_KEY;
  if (!raw) {
    throw new Error("SECRET_ENC_KEY no esta configurada");
  }

  let key;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }

  if (key.length !== KEY_BYTES) {
    throw new Error(
      `SECRET_ENC_KEY invalida: se esperan ${KEY_BYTES} bytes (hex de 64 o base64)`,
    );
  }
  return key;
}

/**
 * Cifra un secreto. Cada llamada usa un IV aleatorio, asi que el output difiere
 * aunque el plaintext sea el mismo.
 *
 * @param {string} plaintext
 * @returns {string} `iv:authTag:ciphertext` en base64
 */
export function encryptSecret(plaintext) {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Descifra un payload producido por `encryptSecret`. Lanza si la clave no
 * coincide, el dato esta corrupto o el formato es invalido.
 *
 * @param {string} payload `iv:authTag:ciphertext` en base64
 * @returns {string}
 */
export function decryptSecret(payload) {
  const key = getKey();
  const parts = String(payload).split(":");
  if (parts.length !== 3) {
    throw new Error("payload cifrado con formato invalido");
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/**
 * Falla si no hay una clave de cifrado utilizable, sin cifrar nada.
 *
 * Para chequear ANTES de un flujo caro o que sale a la red (el ping a Cloudinary de
 * `TenantConfigModel.update`). Sin esto, la clave faltante se descubria recien al
 * persistir y como un `Error` pelado, sin `statusCode`: o sea un 500 que en produccion el
 * errorHandler enmascara como "Error interno del servidor", sin ninguna pista de que lo
 * que falta es una variable de entorno.
 */
export function assertEncryptionKey() {
  getKey();
}
