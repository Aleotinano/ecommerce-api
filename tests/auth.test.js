import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import prisma from "../lib/prisma.js";
import { app } from "../app.js";
import { seedTenants } from "./helpers.js";

beforeAll(async () => {
  await seedTenants();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("auth multi-tenant", () => {
  it("login sin tenant slug (ni subdominio ni header) → 400 TENANT_REQUIRED", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ username: "admin_acme", password: "password123" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("TENANT_REQUIRED");
  });

  it("login con tenant inexistente → 401 INVALID_TENANT", async () => {
    const res = await request(app)
      .post("/auth/login")
      .set("X-Tenant-Slug", "fantasma")
      .send({ username: "admin_acme", password: "password123" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_TENANT");
  });

  it("login válido devuelve cookie y /me incluye tenantId", async () => {
    const login = await request(app)
      .post("/auth/login")
      .set("X-Tenant-Slug", "acme")
      .send({ username: "admin_acme", password: "password123" });

    expect(login.status).toBe(200);
    const cookie = login.headers["set-cookie"][0];

    const me = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body.usuario.tenantId).toBeTypeOf("number");
  });

  it("usuario de un tenant no logea con slug de otro tenant", async () => {
    const res = await request(app)
      .post("/auth/login")
      .set("X-Tenant-Slug", "shopco")
      .send({ username: "admin_acme", password: "password123" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("USER_NOT_FOUND");
  });
});
