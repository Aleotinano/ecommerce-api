import { MercadoPagoConfig, Preference, Payment } from "mercadopago";

const accessToken = process.env.ACCESS_TOKEN;

if (!accessToken) {
  throw new Error("ACCESS_TOKEN no configurado en el entorno");
}

const client = new MercadoPagoConfig({
  accessToken,
  options: { timeout: 5000 },
});

export const payment = new Payment(client);
export const preference = new Preference(client);
