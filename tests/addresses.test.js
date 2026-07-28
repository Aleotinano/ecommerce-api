import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { seedTenants, bearerFor } = await import("./helpers.js");

let acme;
let acmeCustomer;
let acmeAdmin;
let customerBearer;

const VALID = { label: "mi casa", addressText: "Av. Siempre Viva 742" };

function post(body, bearer = customerBearer) {
  return request(app)
    .post("/store/addresses")
    .set("X-Tenant-Slug", "acme")
    .set("Authorization", bearer)
    .send(body);
}

function patch(id, body, bearer = customerBearer) {
  return request(app)
    .patch(`/store/addresses/${id}`)
    .set("X-Tenant-Slug", "acme")
    .set("Authorization", bearer)
    .send(body);
}

beforeAll(async () => {
  ({ acme } = await seedTenants());
  acmeCustomer = acme.users.find((u) => u.role === "CUSTOMER");
  acmeAdmin = acme.users.find((u) => u.role === "ADMIN");
  customerBearer = bearerFor(acmeCustomer);
});

beforeEach(async () => {
  await prisma.userAddress.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /store/addresses", () => {
  it("sin token → 401", async () => {
    const res = await request(app)
      .post("/store/addresses")
      .set("X-Tenant-Slug", "acme")
      .send(VALID);

    expect(res.status).toBe(401);
  });

  it("la primera dirección del usuario queda default sola", async () => {
    const res = await post(VALID);

    expect(res.status).toBe(201);
    expect(res.body.address.isDefault).toBe(true);
    expect(res.body.address.addressText).toBe("Av. Siempre Viva 742");
  });

  it("una segunda con isDefault desmarca la primera", async () => {
    const first = await post(VALID);
    const second = await post({
      label: "casa de mi mamá",
      addressText: "Calle Falsa 123",
      isDefault: true,
    });

    expect(second.status).toBe(201);
    expect(second.body.address.isDefault).toBe(true);

    // Assert en DB: prueba el índice único parcial, no solo la respuesta.
    const stored = await prisma.userAddress.findMany({
      where: { userId: acmeCustomer.id },
      select: { id: true, isDefault: true },
    });
    const defaults = stored.filter((a) => a.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(second.body.address.id);
    expect(
      stored.find((a) => a.id === first.body.address.id).isDefault
    ).toBe(false);
  });

  it("label repetido para el mismo usuario → 409 ADDRESS_LABEL_DUPLICATE", async () => {
    await post(VALID);
    const res = await post({ ...VALID, addressText: "Otra calle 1" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ADDRESS_LABEL_DUPLICATE");
  });

  it("sin addressText ni addressMapsUrl → 400", async () => {
    const res = await post({ label: "sin ubicación" });

    expect(res.status).toBe(400);
  });

  it("addressMapsUrl de un host no whitelisteado → 400", async () => {
    const res = await post({
      label: "sospechosa",
      addressMapsUrl: "https://evil.com/maps",
    });

    expect(res.status).toBe(400);
  });

  it("addressMapsUrl de maps.app.goo.gl → 201 y alcanza sin addressText", async () => {
    const res = await post({
      label: "compartida desde el celu",
      addressMapsUrl: "https://maps.app.goo.gl/xYz",
    });

    expect(res.status).toBe(201);
    expect(res.body.address.addressMapsUrl).toBe("https://maps.app.goo.gl/xYz");
    expect(res.body.address.addressText).toBeNull();
  });

  it("addressLat sin addressLng → 400", async () => {
    const res = await post({ ...VALID, addressLat: -34.6 });

    expect(res.status).toBe(400);
  });

  it("la dirección 11 → 409 ADDRESS_LIMIT_REACHED", async () => {
    for (let i = 0; i < 10; i += 1) {
      const res = await post({ label: `dir ${i}`, addressText: `Calle ${i}` });
      expect(res.status).toBe(201);
    }

    const res = await post({ label: "dir 10", addressText: "Calle 10" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ADDRESS_LIMIT_REACHED");
  });
});

describe("GET /store/addresses", () => {
  it("devuelve solo las del usuario logueado", async () => {
    await post(VALID);
    await post({ label: "del admin", addressText: "Oficina 1" }, bearerFor(acmeAdmin));

    const res = await request(app)
      .get("/store/addresses")
      .set("X-Tenant-Slug", "acme")
      .set("Authorization", customerBearer);

    expect(res.status).toBe(200);
    expect(res.body.addresses).toHaveLength(1);
    expect(res.body.addresses[0].label).toBe("mi casa");
  });
});

describe("PATCH /store/addresses/:id", () => {
  it("borrar addressText sin addressMapsUrl → 400 ADDRESS_LOCATION_REQUIRED", async () => {
    const created = await post(VALID);
    const res = await patch(created.body.address.id, { addressText: null });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("ADDRESS_LOCATION_REQUIRED");
  });

  it("renombrar sin tocar la ubicación funciona", async () => {
    const created = await post(VALID);
    const res = await patch(created.body.address.id, { label: "casa vieja" });

    expect(res.status).toBe(200);
    expect(res.body.address.label).toBe("casa vieja");
    expect(res.body.address.addressText).toBe("Av. Siempre Viva 742");
  });

  it("isDefault true mueve la default", async () => {
    const first = await post(VALID);
    const second = await post({ label: "otra", addressText: "Calle Falsa 123" });

    const res = await patch(second.body.address.id, { isDefault: true });

    expect(res.status).toBe(200);
    expect(res.body.address.isDefault).toBe(true);
    const stored = await prisma.userAddress.findUnique({
      where: { id: first.body.address.id },
      select: { isDefault: true },
    });
    expect(stored.isDefault).toBe(false);
  });
});

describe("DELETE /store/addresses/:id", () => {
  it("borrar la default promueve la más vieja restante", async () => {
    const first = await post(VALID);
    const second = await post({ label: "otra", addressText: "Calle Falsa 123" });
    const third = await post({ label: "tercera", addressText: "Calle 3" });

    // La default es la primera (creada sola en libreta vacía).
    const res = await request(app)
      .delete(`/store/addresses/${first.body.address.id}`)
      .set("X-Tenant-Slug", "acme")
      .set("Authorization", customerBearer);

    expect(res.status).toBe(200);
    const stored = await prisma.userAddress.findMany({
      where: { userId: acmeCustomer.id },
      select: { id: true, isDefault: true },
      orderBy: { id: "asc" },
    });
    expect(stored).toHaveLength(2);
    expect(stored.find((a) => a.id === second.body.address.id).isDefault).toBe(true);
    expect(stored.find((a) => a.id === third.body.address.id).isDefault).toBe(false);
  });

  it("una dirección inexistente → 404 ADDRESS_NOT_FOUND", async () => {
    const res = await request(app)
      .delete("/store/addresses/999999")
      .set("X-Tenant-Slug", "acme")
      .set("Authorization", customerBearer);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ADDRESS_NOT_FOUND");
  });
});
