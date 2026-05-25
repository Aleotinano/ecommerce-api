import { randomBytes, createHash } from "node:crypto";

export const EMAIL_VERIFICATION_TTL_MS = 1000 * 60 * 60 * 24;

export function generateEmailVerificationToken() {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);
  return { token, tokenHash, expiresAt };
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
