import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import prisma from "../lib/prisma.js";
import { app } from "../app.js";
import { seedTenants, seedTenantConfig, cookieFor } from "./helpers.js";

let acme;
let shopco;
let acmeAdminCookie;
let shopcoAdminCookie;

beforeAll(async () => {
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
