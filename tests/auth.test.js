import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import prisma from "../lib/prisma.js";
import { app } from "../app.js";
import { seedTenants, loginAs } from "./helpers.js";

beforeAll(async () => {
  await seedTenants();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("auth multi-tenant (login por email)", () => {
  it("login sin email → 400", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ password: "password123" });

    expect(res.status).toBe(400);
  });

  it("login con email inexistente → 401 INVALID_CREDENTIALS", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "nadie@fantasma.com", password: "password123" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("login con password incorrecta → 401 INVALID_CREDENTIALS", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "admin@acme.com", password: "wrong" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("login válido devuelve cookie, tenant.slug y /me incluye tenantId", async () => {
    const login = await loginAs(app, { email: "admin@acme.com" });

    expect(login.res.status).toBe(200);
    expect(login.res.body.tenant.slug).toBe("acme");
    expect(login.cookie).toBeDefined();

    const me = await request(app).get("/auth/me").set("Cookie", login.cookie);
    expect(me.status).toBe(200);
    expect(me.body.usuario.tenantId).toBeTypeOf("number");
    expect(me.body.tenant.slug).toBe("acme");
  });

  it("emails distintos resuelven a tenants distintos", async () => {
    const acme = await loginAs(app, { email: "admin@acme.com" });
    const shopco = await loginAs(app, { email: "admin@shopco.com" });

    expect(acme.res.status).toBe(200);
    expect(shopco.res.status).toBe(200);
    expect(acme.res.body.tenant.slug).toBe("acme");
    expect(shopco.res.body.tenant.slug).toBe("shopco");
  });
});
