import crypto from "node:crypto";
import { DEFAULTS } from "../config.js";

export function validateWebhookSignature({
  signature,
  requestId,
  dataId,
  secret,
}) {
  if (!signature || !secret) return false;

  const parts = Object.fromEntries(
    signature.split(",").map((p) => p.split("="))
  );
  const ts = parts["ts"];
  const v1 = parts["v1"];

  if (!ts || !v1) return false;

  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const hash = crypto
    .createHmac("sha256", secret)
    .update(manifest)
    .digest("hex");

  return hash === v1;
}

export function getBackUrls() {
  return {
    success: `${DEFAULTS.BASE_URL}/mercadopago/success`,
    failure: `${DEFAULTS.BASE_URL}/mercadopago/failure`,
    pending: `${DEFAULTS.BASE_URL}/mercadopago/pending`,
  };
}

export function getPaymentMethods() {
  return {
    excluded_payment_methods: [],
    excluded_payment_types: [],
    installments: 1,
  };
}
