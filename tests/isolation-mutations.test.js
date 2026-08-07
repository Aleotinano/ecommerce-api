import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";

/**
 * Aislamiento cross-tenant, lado ESCRITURA.
 *
 * `tests/isolation.test.js` cubre lecturas (listados, detalle, alta al carrito).
 * Esto cubre lo otro: autenticado como acme, intentar MUTAR recursos de shopco.
 *
 * Por qué existe un archivo aparte y no dos casos sueltos: como no hay middleware
 * de Prisma que fuerce `tenantId`, buena parte de estas escrituras son correctas
 * por *scoping transitivo* — un `findFirst({ id, tenantId })` que tira 404, y
 * después un `update`/`delete` por `id` pelado. La corrección vive en la distancia
 * entre esos dos statements: reordenarlos, o copiar la mitad de abajo para un
 * método nuevo, rompe el aislamiento **en silencio** (ver docs/ARCHITECTURE.md §11).
 *
 * Cada caso chequea DOS cosas, y las dos importan:
 *
 * 1. El status **y el código de error específico**. Solo el status no alcanza: si
 *    el endpoint rechazara con 400 por payload inválido antes de llegar al chequeo
 *    de tenant, el test daría verde sin haber probado nada. Por eso todos los
 *    bodies de acá son válidos y suficientes para que la mutación ocurra si el
 *    guard no estuviera.
 * 2. Que la fila del otro tenant **siga igual**. Un 404 en la respuesta con la
 *    escritura ya hecha es exactamente el bug que esto busca.
 */

// Cloudinary mockeado: nada sale a la red. Hace falta porque los caminos de
// borrado (producto, variante, comprobante, imagen de sugerencia) llaman al
// proveedor, y porque las imágenes de sugerencia se "suben" para armar el fixture.
const { uploadMock, destroyMock, signMock, CREDS } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  destroyMock: vi.fn(),
  signMock: vi.fn(),
  CREDS: { cloud_name: "cuenta-test", api_key: "key", api_secret: "secret" },
}));
vi.mock("../lib/cloudinary.js", () => ({
  default: {
    uploader: { upload: uploadMock, destroy: destroyMock },
    utils: { private_download_url: signMock },
  },
  ENV_CREDENTIALS: CREDS,
  credentialsFor: vi.fn(async () => CREDS),
  credentialsForCloudName: vi.fn(async () => CREDS),
  isEnvAccount: () => true,
}));

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { OrderModel } = await import("../services/orders.js");
const { persistVariants, chooseVariant, deleteVariant } = await import(
  "../services/content-suggestions/images.js"
);
const { seedTenants, seedTenantConfig, loginAs } = await import("./helpers.js");

let acme;
let shopco;
let acmeCookie;

// Categoría de acme: destino "legítimo" para las mutaciones que necesitan apuntar
// a algo del tenant atacante (así el 404 solo puede venir del recurso ajeno).
let acmeCategoryId;

// Fixtures de shopco — el tenant víctima.
let shopcoCategory; // con productos: sirve para editar
let shopcoEmptyCategory; // sin productos ni hijas: borrable de verdad
let shopcoProduct;
let shopcoVariant;
let shopcoSpareVariant; // 2ª variante: sin ella, borrar chocaría con CANNOT_DELETE_LAST_VARIANT
let shopcoDisposableProduct; // sin órdenes asociadas: borrable de verdad
let shopcoPromo;
let shopcoCashCategory;
let shopcoOrder;
let shopcoReceipt;
let shopcoCustomer;
let shopcoSuggestionId;
let shopcoImages;

const productRow = (id) => prisma.product.findUnique({ where: { id } });
const variantRow = (id) => prisma.productVariant.findUnique({ where: { id } });
const categoryRow = (id) => prisma.categories.findUnique({ where: { id } });
const promoRow = (id) => prisma.promo.findUnique({ where: { id } });
const cashCategoryRow = (id) => prisma.cashCategory.findUnique({ where: { id } });
const receiptRow = (id) => prisma.orderReceipt.findUnique({ where: { id } });
const orderRow = (id) => prisma.order.findUnique({ where: { id } });
const userRow = (id) => prisma.user.findUnique({ where: { id } });

beforeAll(async () => {
  ({ acme, shopco } = await seedTenants());

  // El módulo de caja se chequea contra el tenant que HACE el request: sin esto,
  // `/cash-register/*` respondería 404 CASH_REGISTER_DISABLED y los tests de caja
  // pasarían sin haber tocado nunca el chequeo de tenant.
  await seedTenantConfig(acme.id, { cashRegisterEnabled: true });
  await seedTenantConfig(shopco.id, { cashRegisterEnabled: true });

  ({ cookie: acmeCookie } = await loginAs(app, { email: "admin@acme.com" }));

  acmeCategoryId = acme.categories[0].id;

  shopcoCategory = shopco.categories[0];
  shopcoProduct = shopcoCategory.products[0];
  shopcoVariant = shopcoProduct.variants[0];
  shopcoCustomer = shopco.users.find((u) => u.role === "CUSTOMER");

  uploadMock.mockImplementation(async () => ({
    secure_url: "https://cdn.test/shopco.png",
    public_id: `cs/shopco-${Math.random().toString(36).slice(2)}`,
  }));
  destroyMock.mockResolvedValue({ result: "ok" });
  signMock.mockImplementation((publicId) => `https://firmada.test/${publicId}`);

  shopcoSpareVariant = await prisma.productVariant.create({
    data: {
      tenantId: shopco.id,
      productId: shopcoProduct.id,
      attributes: { color: "blanco" },
      price: 26000,
      stock: 5,
      sku: "SHC-AUR-B",
    },
  });

  shopcoEmptyCategory = await prisma.categories.create({
    data: { tenantId: shopco.id, name: "Vacía ShopCo" },
  });

  shopcoDisposableProduct = await prisma.product.create({
    data: {
      tenantId: shopco.id,
      name: "Cargador USB",
      type: "PRODUCTO",
      categoryId: shopcoCategory.id,
    },
  });

  shopcoPromo = await prisma.promo.create({
    data: {
      tenantId: shopco.id,
      name: "2x1 ShopCo",
      isActive: true,
      tiers: { create: [{ tenantId: shopco.id, minQty: 2, discountPercentage: 10 }] },
      products: { create: [{ tenantId: shopco.id, productId: shopcoProduct.id }] },
    },
  });

  shopcoCashCategory = await prisma.cashCategory.create({
    data: {
      tenantId: shopco.id,
      key: "insumos",
      label: "Insumos",
      applies: "EXPENSE",
    },
  });

  // Orden BOT: nace NEW/PENDING (estado / pago), que es el punto desde el que todas las
  // mutaciones de orden que probamos acá son alcanzables.
  shopcoOrder = await OrderModel.createDraft({
    tenantId: shopco.id,
    items: [
      { productId: shopcoProduct.id, variantId: shopcoVariant.id, quantity: 1 },
    ],
  });

  shopcoReceipt = await prisma.orderReceipt.create({
    data: {
      tenantId: shopco.id,
      orderId: shopcoOrder.id,
      storageProvider: "cloudinary",
      cloudName: CREDS.cloud_name,
      publicId: "receipts/shopco-comprobante",
      resourceType: "image",
      deliveryType: "authenticated",
      format: "jpg",
      mimeType: "image/jpeg",
      bytes: 1234,
      originalName: "comprobante.jpg",
    },
  });

  const suggestion = await prisma.contentSuggestion.create({
    data: {
      tenantId: shopco.id,
      productId: shopcoProduct.id,
      angle: "BEST_SELLER",
      date: new Date("2026-07-30"),
    },
  });
  shopcoSuggestionId = suggestion.id;
  shopcoImages = await persistVariants({
    suggestionId: shopcoSuggestionId,
    tenantId: shopco.id,
    variants: [
      { data: "a", mimeType: "image/png" },
      { data: "b", mimeType: "image/png" },
    ],
    prompt: "fixture shopco",
  });
});

beforeEach(() => {
  // Reseteado por test: varios casos asertan que el proveedor NO fue llamado.
  destroyMock.mockClear();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("productos", () => {
  it("acme no puede editar un producto de shopco", async () => {
    const res = await request(app)
      .patch(`/products/${shopcoProduct.id}`)
      .set("Cookie", acmeCookie)
      .send({ name: "Producto robado", isActive: false });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");

    const row = await productRow(shopcoProduct.id);
    expect(row.name).toBe("Auriculares BT");
    expect(row.isActive).toBe(true);
  });

  it("acme no puede mover un producto de shopco a una categoría suya", async () => {
    const res = await request(app)
      .patch(`/products/${shopcoProduct.id}/category`)
      .set("Cookie", acmeCookie)
      // Categoría del PROPIO acme: si el guard del producto no estuviera, la
      // mutación sería perfectamente válida y se escribiría.
      .send({ categoryId: acmeCategoryId });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");

    const row = await productRow(shopcoProduct.id);
    expect(row.categoryId).toBe(shopcoCategory.id);
  });

  it("acme no puede borrar un producto de shopco", async () => {
    const res = await request(app)
      .delete(`/products/${shopcoDisposableProduct.id}`)
      .set("Cookie", acmeCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");

    expect(await productRow(shopcoDisposableProduct.id)).not.toBeNull();
  });
});

describe("variantes", () => {
  it("acme no puede editar una variante de shopco", async () => {
    const res = await request(app)
      .patch(`/variants/${shopcoProduct.id}/${shopcoVariant.id}`)
      .set("Cookie", acmeCookie)
      .send({ price: 1, stock: 0 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("VARIANT_NOT_FOUND");

    const row = await variantRow(shopcoVariant.id);
    expect(row.price).toBe(25000);
    expect(row.stock).toBe(15);
  });

  it("acme no puede borrar una variante de shopco", async () => {
    const res = await request(app)
      .delete(`/variants/${shopcoProduct.id}/${shopcoSpareVariant.id}`)
      .set("Cookie", acmeCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("VARIANT_NOT_FOUND");

    expect(await variantRow(shopcoSpareVariant.id)).not.toBeNull();
  });
});

describe("categorías", () => {
  it("acme no puede editar una categoría de shopco", async () => {
    const res = await request(app)
      .patch(`/categories/${shopcoCategory.id}`)
      .set("Cookie", acmeCookie)
      .send({ name: "Categoría robada", isActive: false });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CATEGORY_NOT_FOUND");

    const row = await categoryRow(shopcoCategory.id);
    expect(row.name).toBe("Electrónica");
    expect(row.isActive).toBe(true);
  });

  it("acme no puede borrar una categoría de shopco", async () => {
    const res = await request(app)
      .delete(`/categories/${shopcoEmptyCategory.id}`)
      .set("Cookie", acmeCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CATEGORY_NOT_FOUND");

    expect(await categoryRow(shopcoEmptyCategory.id)).not.toBeNull();
  });
});

describe("promos", () => {
  it("acme no puede editar una promo de shopco", async () => {
    const res = await request(app)
      .patch(`/promos/${shopcoPromo.id}`)
      .set("Cookie", acmeCookie)
      .send({ name: "Promo robada", isActive: false });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PROMO_NOT_FOUND");

    const row = await promoRow(shopcoPromo.id);
    expect(row.name).toBe("2x1 ShopCo");
    expect(row.isActive).toBe(true);
  });

  it("acme no puede borrar una promo de shopco", async () => {
    const res = await request(app)
      .delete(`/promos/${shopcoPromo.id}`)
      .set("Cookie", acmeCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PROMO_NOT_FOUND");

    expect(await promoRow(shopcoPromo.id)).not.toBeNull();
  });
});

describe("caja: etiquetas", () => {
  it("acme no puede editar una etiqueta de caja de shopco", async () => {
    const res = await request(app)
      .patch(`/cash-register/categories/${shopcoCashCategory.id}`)
      .set("Cookie", acmeCookie)
      .send({ label: "Etiqueta robada", isActive: false });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CASH_CATEGORY_NOT_FOUND");

    const row = await cashCategoryRow(shopcoCashCategory.id);
    expect(row.label).toBe("Insumos");
    expect(row.isActive).toBe(true);
  });

  it("acme no puede borrar una etiqueta de caja de shopco", async () => {
    const res = await request(app)
      .delete(`/cash-register/categories/${shopcoCashCategory.id}`)
      .set("Cookie", acmeCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CASH_CATEGORY_NOT_FOUND");

    expect(await cashCategoryRow(shopcoCashCategory.id)).not.toBeNull();
  });
});

describe("órdenes", () => {
  it("acme no puede cambiar el estado de una orden de shopco", async () => {
    const res = await request(app)
      .patch(`/orders/${shopcoOrder.id}`)
      .set("Cookie", acmeCookie)
      .send({ status: "PROCESSING", note: "avanzada desde otro tenant" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORDER_NOT_FOUND");

    expect((await orderRow(shopcoOrder.id)).status).toBe("NEW");
    // Tampoco quedó rastro en la bitácora: `createDraft` deja una sola entrada.
    const historial = await prisma.orderStatusHistory.count({
      where: { orderId: shopcoOrder.id },
    });
    expect(historial).toBe(1);
  });

  it("acme no puede cancelar una orden de shopco", async () => {
    // CANCELLED es la transición SIEMPRE permitida (no pasa por `assertCanProduce`):
    // si el guard de tenant no estuviera, esta escritura se concretaría seguro.
    const res = await request(app)
      .patch(`/orders/${shopcoOrder.id}`)
      .set("Cookie", acmeCookie)
      .send({ status: "CANCELLED" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORDER_NOT_FOUND");

    expect((await orderRow(shopcoOrder.id)).status).toBe("NEW");
  });

  it("acme no puede revisar una orden de shopco", async () => {
    const res = await request(app)
      .post(`/orders/${shopcoOrder.id}/review`)
      .set("Cookie", acmeCookie)
      .send({ fulfillmentMethod: "PICKUP", paymentMethod: "CASH" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORDER_NOT_FOUND");

    const row = await orderRow(shopcoOrder.id);
    expect(row.reviewedAt).toBeNull();
    expect(row.reviewedById).toBeNull();
    expect(row.paymentMethod).toBeNull();
  });

  it("acme no puede registrar un cobro en una orden de shopco", async () => {
    const res = await request(app)
      .post(`/orders/${shopcoOrder.id}/payments`)
      .set("Cookie", acmeCookie)
      .send({ kind: "PAYMENT", channel: "CASH", amount: 1000, note: "cobro ajeno" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORDER_NOT_FOUND");

    const cobros = await prisma.orderPayment.count({
      where: { orderId: shopcoOrder.id },
    });
    expect(cobros).toBe(0);
    expect((await orderRow(shopcoOrder.id)).paymentStatus).toBe("PENDING");
  });

  it("acme no puede dar por cobrada una orden de shopco", async () => {
    const res = await request(app)
      .post(`/orders/${shopcoOrder.id}/confirm-payment`)
      .set("Cookie", acmeCookie)
      .send({ channel: "CASH" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORDER_NOT_FOUND");

    const row = await orderRow(shopcoOrder.id);
    expect(row.paymentStatus).toBe("PENDING");
    expect(row.paymentConfirmedAt).toBeNull();
  });

  it("acme no puede borrar un comprobante de una orden de shopco", async () => {
    const res = await request(app)
      .delete(`/orders/${shopcoOrder.id}/receipts/${shopcoReceipt.id}`)
      .set("Cookie", acmeCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("RECEIPT_NOT_FOUND");

    const row = await receiptRow(shopcoReceipt.id);
    expect(row.deletedAt).toBeNull();
    // Y el archivo sigue vivo en el proveedor: el borrado remoto va ANTES del
    // soft-delete, así que un 404 con `destroy` ya llamado sería una fuga igual.
    expect(destroyMock).not.toHaveBeenCalled();
  });
});

describe("roles", () => {
  it("acme no puede cambiarle el rol a un usuario de shopco", async () => {
    const res = await request(app)
      .patch(`/users/${shopcoCustomer.id}`)
      .set("Cookie", acmeCookie)
      .send({ role: "ADMIN" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("USER_NOT_FOUND");

    expect((await userRow(shopcoCustomer.id)).role).toBe("CUSTOMER");
  });
});

/**
 * Estas dos no tienen ruta HTTP todavía (`routes/content-suggestions.js` expone
 * timeline, ángulos, generate y refine; nada de imágenes). Se ejercen contra el
 * service, que es la superficie real que existe hoy — y son de las que más
 * dependen del scoping transitivo: `chooseVariant` termina en un
 * `update({ where: { id } })` pelado. Si mañana se montan por HTTP, estos casos
 * se mudan al bloque de arriba.
 */
describe("sugerencias de contenido: imágenes (service, sin ruta HTTP)", () => {
  it("acme no puede elegir una variante de imagen de shopco", async () => {
    await expect(
      chooseVariant({
        tenantId: acme.id,
        suggestionId: shopcoSuggestionId,
        imageId: shopcoImages[0].id,
      })
    ).rejects.toMatchObject({
      code: "SUGGESTION_IMAGE_NOT_FOUND",
      statusCode: 404,
    });

    const filas = await prisma.suggestionImage.findMany({
      where: { suggestionId: shopcoSuggestionId },
    });
    // Elegir borra las hermanas: que sigan las dos prueba que no se ejecutó nada.
    expect(filas).toHaveLength(2);
    expect(filas.every((f) => f.chosen === false)).toBe(true);
    expect(destroyMock).not.toHaveBeenCalled();
  });

  it("acme no puede borrar una variante de imagen de shopco", async () => {
    await expect(
      deleteVariant({ tenantId: acme.id, imageId: shopcoImages[0].id })
    ).rejects.toMatchObject({
      code: "SUGGESTION_IMAGE_NOT_FOUND",
      statusCode: 404,
    });

    const fila = await prisma.suggestionImage.findUnique({
      where: { id: shopcoImages[0].id },
    });
    expect(fila).not.toBeNull();
    expect(destroyMock).not.toHaveBeenCalled();
  });
});
