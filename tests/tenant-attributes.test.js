import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import prisma from "../lib/prisma.js";
import { app } from "../app.js";
import { hashPassword } from "../helpers/password.js";
import { seedTenants, cookieFor } from "./helpers.js";
import { ProductModel } from "../services/productos.js";
import { VariantModel } from "../services/variants.js";
import { TenantAttributeModel } from "../services/tenant-attributes.js";

let acme;
// Tenant nuevo SIN catálogo de atributos (el caso "mesa dulce" del onboarding).
let dulce;
let dulceAdmin;

async function createBareTenant({ slug, name, adminEmail, adminUsername }) {
  const password = await hashPassword("password123");
  return prisma.tenant.create({
    data: {
      slug,
      name,
      users: {
        create: [
          {
            username: adminUsername,
            email: adminEmail,
            password,
            role: "ADMIN",
            emailVerified: true,
          },
        ],
      },
    },
    include: { users: true },
  });
}

beforeAll(async () => {
  ({ acme } = await seedTenants());

  dulce = await createBareTenant({
    slug: "dulce",
    name: "Mesa Dulce",
    adminUsername: "admin_dulce",
    adminEmail: "admin@dulce.com",
  });
  dulceAdmin = dulce.users[0];
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PUT /tenant-attributes/:tenantId — setup one-time del catálogo", () => {
  it("sin auth → 401", async () => {
    const res = await request(app)
      .put(`/tenant-attributes/${dulce.id}`)
      .send({ attributes: [{ key: "sabor", label: "Sabor" }] });
    expect(res.status).toBe(401);
  });

  it("define el catálogo del tenant (mesa dulce: sabor + tamaño)", async () => {
    const res = await request(app)
      .put(`/tenant-attributes/${dulce.id}`)
      .set("Cookie", cookieFor(dulceAdmin))
      .send({
        attributes: [
          { key: "sabor", label: "Sabor" },
          { key: "tamanio", label: "Tamaño" },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.attributes.map((a) => a.key)).toEqual(["sabor", "tamanio"]);
    expect(res.body.attributes[0]).toMatchObject({
      key: "sabor",
      label: "Sabor",
      type: "TEXT",
      position: 0,
    });
  });

  it("segundo setup → 409 (el catálogo es one-time)", async () => {
    const res = await request(app)
      .put(`/tenant-attributes/${dulce.id}`)
      .set("Cookie", cookieFor(dulceAdmin))
      .send({ attributes: [{ key: "relleno", label: "Relleno" }] });

    expect(res.status).toBe(409);
  });

  it("key repetida en el mismo setup → 400", async () => {
    const fresh = await createBareTenant({
      slug: "dup-attrs",
      name: "Dup",
      adminUsername: "admin_dup",
      adminEmail: "admin@dup.com",
    });

    const res = await request(app)
      .put(`/tenant-attributes/${fresh.id}`)
      .set("Cookie", cookieFor(fresh.users[0]))
      .send({
        attributes: [
          { key: "sabor", label: "Sabor" },
          { key: "sabor", label: "Sabor otra vez" },
        ],
      });

    expect(res.status).toBe(400);
  });

  it("GET devuelve el catálogo ordenado por position", async () => {
    const res = await request(app).get(`/tenant-attributes/${dulce.id}`);
    expect(res.status).toBe(200);
    expect(res.body.attributes.map((a) => a.key)).toEqual(["sabor", "tamanio"]);
  });
});

describe("validación de attributes de variante contra el catálogo", () => {
  let torta;

  beforeAll(async () => {
    torta = await ProductModel.create({
      tenantId: dulce.id,
      name: "Torta de chocolate",
      type: "PRODUCTO",
    });
  });

  it("key desconocida → UNKNOWN_ATTRIBUTE", async () => {
    await expect(
      VariantModel.createVariant({
        tenantId: dulce.id,
        productId: torta.id,
        attributes: { color: "rojo" },
        price: 100,
        stock: 1,
      })
    ).rejects.toMatchObject({ code: "UNKNOWN_ATTRIBUTE" });
  });

  it("crea la variante y normaliza las keys en el orden del catálogo", async () => {
    const variant = await VariantModel.createVariant({
      tenantId: dulce.id,
      productId: torta.id,
      // Keys desordenadas y con mayúsculas: deben salir normalizadas.
      attributes: { TAMANIO: "12 porciones", sabor: "chocolate" },
      price: 15000,
      stock: 3,
    });

    expect(Object.keys(variant.attributes)).toEqual(["sabor", "tamanio"]);
    expect(variant.attributes).toEqual({
      sabor: "chocolate",
      tamanio: "12 porciones",
    });
    expect(variant.isDefault).toBe(true);
  });

  it("atributo COLOR exige HEX válido", async () => {
    const paleta = await createBareTenant({
      slug: "paleta",
      name: "Paleta",
      adminUsername: "admin_paleta",
      adminEmail: "admin@paleta.com",
    });
    await TenantAttributeModel.setup({
      tenantId: paleta.id,
      attributes: [{ key: "color", label: "Color", type: "COLOR" }],
    });

    await expect(
      TenantAttributeModel.validateAttributes({
        tenantId: paleta.id,
        attributes: { color: "rojo" },
      })
    ).rejects.toMatchObject({ code: "INVALID_ATTRIBUTE_VALUE" });

    await expect(
      TenantAttributeModel.validateAttributes({
        tenantId: paleta.id,
        attributes: { color: "#A1B2C3" },
      })
    ).resolves.toEqual({ color: "#A1B2C3" });
  });
});

describe("storefront: filtro y opciones por attributes", () => {
  it("GET /store/products?attributes= filtra por atributo de variante", async () => {
    const match = await request(app)
      .get("/store/products")
      .set("X-Tenant-Slug", "acme")
      .query({ attributes: JSON.stringify({ talle: "M" }) });

    expect(match.status).toBe(200);
    expect(match.body.some((p) => p.name === "Remera básica")).toBe(true);

    const noMatch = await request(app)
      .get("/store/products")
      .set("X-Tenant-Slug", "acme")
      .query({ attributes: JSON.stringify({ talle: "XXL" }) });

    expect(noMatch.status).toBe(200);
    expect(noMatch.body).toHaveLength(0);
  });

  it("attributes con JSON inválido → 400", async () => {
    const res = await request(app)
      .get("/store/products")
      .set("X-Tenant-Slug", "acme")
      .query({ attributes: "{no-es-json" });

    expect(res.status).toBe(400);
  });

  it("GET /store/products/options agrega valores por atributo del catálogo", async () => {
    const res = await request(app)
      .get("/store/products/options")
      .set("X-Tenant-Slug", "acme");

    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(
      res.body.attributes.map((a) => [a.key, a])
    );
    expect(byKey.color).toMatchObject({ label: "Color", type: "TEXT" });
    expect(byKey.color.values).toContain("negro");
    expect(byKey.talle.values).toContain("M");
  });
});

describe("bot: desambiguación con los labels del catálogo", () => {
  it("createDraftOrder ambiguo pide los atributos del tenant (sabor/tamaño)", async () => {
    const { buildToolContext } = await import("../services/chat/tools.js");

    const alfajores = await ProductModel.create({
      tenantId: dulce.id,
      name: "Alfajores",
      type: "PRODUCTO",
      variants: [
        { attributes: { sabor: "maicena" }, price: 500, stock: 10 },
        { attributes: { sabor: "chocolate" }, price: 600, stock: 10 },
      ],
    });

    const { executeTool } = buildToolContext({
      tenantId: dulce.id,
      user: null,
      config: { showOutOfStock: true },
      channel: { kind: "whatsapp", waId: "549110000", history: [], message: "quiero alfajores" },
    });

    const res = await executeTool("createDraftOrder", {
      items: [{ productId: alfajores.id, quantity: 1 }],
    });
    expect(res.error).toMatch(/sabor/);

    const ok = await executeTool("createDraftOrder", {
      items: [
        { productId: alfajores.id, quantity: 2, attributes: { sabor: "chocolate" } },
      ],
    });
    expect(ok.created).toBe(true);
  });
});
