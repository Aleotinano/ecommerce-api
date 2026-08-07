import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import request from "supertest";
import prisma from "../lib/prisma.js";
import { app } from "../app.js";
import { decryptSecret } from "../lib/crypto.js";
import { seedTenants, seedTenantConfig, cookieFor } from "./helpers.js";

let acme;
let shopco;
let acmeAdminCookie;
let shopcoAdminCookie;

beforeAll(async () => {
  // El access token de WhatsApp se cifra en reposo (lib/crypto lee la clave de
  // env en runtime). La seteamos para los tests de token de abajo.
  process.env.WHATSAPP_TOKEN_ENC_KEY ||= randomBytes(32).toString("hex");

  const tenants = await seedTenants();
  acme = tenants.acme;
  shopco = tenants.shopco;

  await seedTenantConfig(acme.id);

  acmeAdminCookie = cookieFor(acme.users[0]);
  shopcoAdminCookie = cookieFor(shopco.users[0]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /tenant-config/:tenantId", () => {
  it("devuelve la configuración existente del tenant", async () => {
    const res = await request(app).get(`/tenant-config/${acme.id}`);

    expect(res.status).toBe(200);
    expect(res.body.storeName).toBe("Acme Store");
    expect(res.body.currency).toBe("ARS");
    expect(res.body.locale).toBe("es-AR");
    expect(res.body.allowCartGuest).toBe(true);
  });

  it("incluye el flujo de venta, que el tenant lee pero no escribe", async () => {
    // El storefront necesita `paymentMethodsEnabled` para pintar solo los métodos
    // que el tenant acepta, aunque no pueda cambiarlos desde el panel.
    const res = await request(app).get(`/tenant-config/${acme.id}`);

    expect(res.body.paymentMethodsEnabled).toEqual(["CASH", "TRANSFER", "MIXED"]);
    expect(res.body.fulfillmentMethodsEnabled).toEqual(["DELIVERY", "PICKUP"]);
    expect(res.body.depositEnabled).toBe(false);
    expect(res.body.depositPercentage).toBe(50);
    // Sin esto el storefront no sabe si montar el carrito.
    expect(res.body.storeMode).toBe("SHOP");
  });

  it("tenant sin configuración → 404 TENANT_CONFIG_NOT_FOUND", async () => {
    const res = await request(app).get(`/tenant-config/${shopco.id}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TENANT_CONFIG_NOT_FOUND");
  });

  it("tenantId inválido → 400", async () => {
    const res = await request(app).get(`/tenant-config/abc`);
    expect(res.status).toBe(400);
  });
});

describe("PATCH /tenant-config/:tenantId", () => {
  it("sin sesión → 401", async () => {
    const res = await request(app)
      .patch(`/tenant-config/${acme.id}`)
      .send({ storeName: "Nuevo nombre" });

    expect(res.status).toBe(401);
  });

  it("ADMIN puede actualizar campos válidos", async () => {
    const res = await request(app)
      .patch(`/tenant-config/${acme.id}`)
      .set("Cookie", acmeAdminCookie)
      .send({
        storeName: "Acme Renovado",
        contactEmail: "nuevo@acme.com",
        currency: "usd",
      });

    expect(res.status).toBe(200);
    expect(res.body.config.storeName).toBe("Acme Renovado");
    expect(res.body.config.contactEmail).toBe("nuevo@acme.com");
    expect(res.body.config.currency).toBe("USD");
  });

  it("rechaza los campos de flujo de venta: no los configura el tenant", async () => {
    // El ADMIN de este PATCH es el admin DEL TENANT, así que el rol no alcanza
    // para distinguirlo de nosotros: el bloqueo es que el campo no está en
    // `updateTenantConfigObject`.
    const value = { depositPercentage: 30, storeMode: "MENU" };

    for (const field of [
      "storeMode",
      "paymentMethodsEnabled",
      "fulfillmentMethodsEnabled",
      "depositEnabled",
      "depositPercentage",
    ]) {
      const res = await request(app)
        .patch(`/tenant-config/${acme.id}`)
        .set("Cookie", acmeAdminCookie)
        .send({ [field]: value[field] ?? true });

      expect(res.status, field).toBe(400);
      expect(res.body.errors[field], field).toBeDefined();
    }
  });

  it("un campo de flujo NO se cuela junto a uno válido", async () => {
    // El caso peligroso: sin el rechazo explícito, Zod descartaba la clave y el
    // PATCH devolvía 200 habiendo guardado solo el nombre — la seña se perdía en
    // silencio.
    const res = await request(app)
      .patch(`/tenant-config/${acme.id}`)
      .set("Cookie", acmeAdminCookie)
      .send({ storeName: "Con seña colada", depositEnabled: true });

    expect(res.status).toBe(400);

    const config = await prisma.tenantConfig.findUnique({
      where: { tenantId: acme.id },
      select: { storeName: true, depositEnabled: true },
    });
    expect(config.depositEnabled).toBe(false);
    expect(config.storeName).not.toBe("Con seña colada");
  });

  it("un PATCH que reenvía el payload del GET sigue funcionando", async () => {
    // `.strict()` habría roto esto, y es lo que hace un panel que hace PATCH del
    // objeto completo que leyó: `id` y `logoUrl` no son actualizables.
    const res = await request(app)
      .patch(`/tenant-config/${acme.id}`)
      .set("Cookie", acmeAdminCookie)
      .send({ id: 999, logoUrl: "https://x/y.png", storeName: "Acme con echo" });

    expect(res.status).toBe(200);
    expect(res.body.config.storeName).toBe("Acme con echo");
  });

  it("crea config (upsert) si el tenant no tenía", async () => {
    const res = await request(app)
      .patch(`/tenant-config/${shopco.id}`)
      .set("Cookie", shopcoAdminCookie)
      .send({ storeName: "ShopCo Store" });

    expect(res.status).toBe(200);
    expect(res.body.config.storeName).toBe("ShopCo Store");
  });

  it("body vacío → 400 (no hay cambios)", async () => {
    const res = await request(app)
      .patch(`/tenant-config/${acme.id}`)
      .set("Cookie", acmeAdminCookie)
      .send({});

    expect(res.status).toBe(400);
  });

  it("email inválido → 400", async () => {
    const res = await request(app)
      .patch(`/tenant-config/${acme.id}`)
      .set("Cookie", acmeAdminCookie)
      .send({ contactEmail: "no-es-un-email" });

    expect(res.status).toBe(400);
  });

  it("locale con formato inválido → 400", async () => {
    const res = await request(app)
      .patch(`/tenant-config/${acme.id}`)
      .set("Cookie", acmeAdminCookie)
      .send({ locale: "espanol" });

    expect(res.status).toBe(400);
  });

  it("currency con largo distinto a 3 → 400", async () => {
    const res = await request(app)
      .patch(`/tenant-config/${acme.id}`)
      .set("Cookie", acmeAdminCookie)
      .send({ currency: "PESOS" });

    expect(res.status).toBe(400);
  });
});

describe("PATCH /tenant-config/:tenantId - whatsappAccessToken", () => {
  it("guarda el token cifrado y NO lo devuelve en la respuesta", async () => {
    const plainToken = "EAAG_token_de_la_marca_123";

    const res = await request(app)
      .patch(`/tenant-config/${acme.id}`)
      .set("Cookie", acmeAdminCookie)
      .send({ whatsappAccessToken: plainToken });

    expect(res.status).toBe(200);
    // Nunca se expone por la API.
    expect(res.body.config.whatsappAccessToken).toBeUndefined();

    // En la DB esta cifrado (no es el texto plano) y se puede descifrar de vuelta.
    const row = await prisma.tenantConfig.findUnique({
      where: { tenantId: acme.id },
      select: { whatsappAccessToken: true },
    });
    expect(row.whatsappAccessToken).not.toBe(plainToken);
    expect(decryptSecret(row.whatsappAccessToken)).toBe(plainToken);
  });

  it("null desconecta el token (lo guarda null)", async () => {
    const res = await request(app)
      .patch(`/tenant-config/${acme.id}`)
      .set("Cookie", acmeAdminCookie)
      .send({ whatsappAccessToken: null });

    expect(res.status).toBe(200);

    const row = await prisma.tenantConfig.findUnique({
      where: { tenantId: acme.id },
      select: { whatsappAccessToken: true },
    });
    expect(row.whatsappAccessToken).toBeNull();
  });

  it("token vacío → 400", async () => {
    const res = await request(app)
      .patch(`/tenant-config/${acme.id}`)
      .set("Cookie", acmeAdminCookie)
      .send({ whatsappAccessToken: "" });

    expect(res.status).toBe(400);
  });
});

describe("DELETE /tenant-config/:tenantId/logo", () => {
  it("sin sesión → 401", async () => {
    const res = await request(app).delete(`/tenant-config/${acme.id}/logo`);
    expect(res.status).toBe(401);
  });

  it("ADMIN sin logo cargado → 404 NO_LOGO_TO_DELETE", async () => {
    const res = await request(app)
      .delete(`/tenant-config/${acme.id}/logo`)
      .set("Cookie", acmeAdminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NO_LOGO_TO_DELETE");
  });
});
