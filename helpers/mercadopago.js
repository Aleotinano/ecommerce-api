import { DEFAULTS } from "../config.js";

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
