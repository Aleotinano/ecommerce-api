import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import prisma from "../lib/prisma.js";
import { app } from "../app.js";
import { seedTenants, cookieFor } from "./helpers.js";
import { ProductModel } from "../services/productos.js";

let acme;
let shopco;
let acmeAdmin;

beforeAll(async () => {
  ({ acme, shopco } = await seedTenants());
  acmeAdmin = acme.users.find((u) => u.role === "ADMIN");

  // seedTenants ya crea 1 producto con 1 variante para acme ("Remera básica").
  // Agregamos un segundo producto para poder probar el listado cross-producto.
  await ProductModel.create({
    tenantId: acme.id,
    name: "Gorra básica",
    type: "PRODUCTO",
    price: 3000,
    stock: 20,
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /variants — listado cross-producto", () => {
  it("sin filtro trae variantes de más de un producto del tenant, con el producto embebido", async () => {
    const res = await request(app).get("/variants").set("Cookie", cookieFor(acmeAdmin));

    expect(res.status).toBe(200);
    const productNames = new Set(res.body.variants.map((v) => v.product.name));
    expect(productNames.size).toBeGreaterThan(1);
    expect(res.body.variants[0].product).toHaveProperty("name");
  });

  it("filtra por productId", async () => {
    const gorra = await prisma.product.findFirst({
      where: { tenantId: acme.id, name: "Gorra básica" },
    });

    const res = await request(app)
      .get(`/variants?productId=${gorra.id}`)
      .set("Cookie", cookieFor(acmeAdmin));

    expect(res.status).toBe(200);
    expect(res.body.variants.length).toBeGreaterThan(0);
    expect(res.body.variants.every((v) => v.productId === gorra.id)).toBe(true);
  });

  it("aísla por tenant: variantes de otro tenant no aparecen", async () => {
    const shopcoAdmin = shopco.users.find((u) => u.role === "ADMIN");

    const res = await request(app).get("/variants").set("Cookie", cookieFor(shopcoAdmin));

    expect(res.status).toBe(200);
    const names = res.body.variants.map((v) => v.product.name);
    expect(names).not.toContain("Remera básica");
    expect(names).not.toContain("Gorra básica");
  });
});
