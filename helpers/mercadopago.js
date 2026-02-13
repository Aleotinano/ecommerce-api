export function createError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function getBackUrls() {
  return {
    success: `${process.env.BASE_URL}/mercadopago/success`,
    failure: `${process.env.BASE_URL}/mercadopago/failure`,
    pending: `${process.env.BASE_URL}/mercadopago/pending`,
  };
}

export function getPaymentMethods() {
  return {
    excluded_payment_methods: [],
    excluded_payment_types: [],
    installments: 1,
  };
}
