import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import prisma from "../lib/prisma.js";
import { app } from "../app.js";
import { ProductModel } from "../services/productos.js";
import { CategoryModel } from "../services/categories.js";
import { CartModel } from "../services/cart.js";
import { OrderModel } from "../services/orders.js";
import { buildToolContext } from "../services/chat/tools.js";
import { seedTenants, cookieFor } from "./helpers.js";

let acme;
let acmeAdminCookie;
let acmeCustomer;
let galletaA;
let galletaB;
let galletaC;
let galletaD;
let combo;

beforeAll(async () => {
  ({ acme } = await seedTenants());
  acmeAdminCookie = cookieFor(acme.users.find((u) => u.role === "ADMIN"));
  acmeCustomer = acme.users.find((u) => u.role === "CUSTOMER");

  galletaA = await ProductModel.create({
    tenantId: acme.id,
    name: "Galleta A",
    type: "PRODUCTO",
    variants: [{ price: 800, stock: 20 }],
  });
  galletaB = await ProductModel.create({
    tenantId: acme.id,
    name: "Galleta B",
    type: "PRODUCTO",
    variants: [{ price: 800, stock: 20 }],
  });
  galletaC = await ProductModel.create({
    tenantId: acme.id,
    name: "Galleta C (no permitida)",
    type: "PRODUCTO",
    variants: [{ price: 800, stock: 20 }],
  });
  galletaD = await ProductModel.create({
    tenantId: acme.id,
    name: "Galleta D (poco stock)",
    type: "PRODUCTO",
    variants: [{ price: 800, stock: 1 }],
  });

  combo = await ProductModel.create({
    tenantId: acme.id,
    name: "Combo de galletas",
    price: 3000,
    type: "COMBO",
    comboMinItems: 2,
    comboMaxItems: 4,
    comboOptions: [
      { allowedProductId: galletaA.id, minQty: 0, maxQty: 3 },
      { allowedProductId: galletaB.id, minQty: 0, maxQty: 3 },
      { allowedProductId: galletaD.id, minQty: 0 },
    ],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("ProductModel: crear/editar combos", () => {
  it("create con type=COMBO + comboOptions persiste la whitelist", async () => {
    expect(combo.type).toBe("COMBO");
    expect(combo.comboMinItems).toBe(2);
    expect(combo.comboMaxItems).toBe(4);

    const options = await ProductModel.getComboOptions({
      tenantId: acme.id,
      id: combo.id,
    });

    expect(options.comboMinItems).toBe(2);
    expect(options.comboMaxItems).toBe(4);
    const ids = options.allowedProducts.map((p) => p.productId).sort((a, b) => a - b);
    expect(ids).toEqual([galletaA.id, galletaB.id, galletaD.id].sort((a, b) => a - b));
  });

  it("getComboOptions sobre un producto que no es combo → PRODUCT_NOT_COMBO", async () => {
    await expect(
      ProductModel.getComboOptions({ tenantId: acme.id, id: galletaA.id })
    ).rejects.toMatchObject({ code: "PRODUCT_NOT_COMBO" });
  });

  it("no permite combos anidados en la whitelist", async () => {
    await expect(
      ProductModel.create({
        tenantId: acme.id,
        name: "Combo inválido",
        price: 1000,
        type: "COMBO",
        comboMinItems: 1,
        comboMaxItems: 1,
        comboOptions: [{ allowedProductId: combo.id }],
      })
    ).rejects.toMatchObject({ code: "COMBO_NESTED_NOT_ALLOWED" });
  });

  it("edit reemplaza la whitelist completa", async () => {
    const edited = await ProductModel.edit(
      { tenantId: acme.id, id: combo.id },
      { comboOptions: [{ allowedProductId: galletaC.id, minQty: 0, maxQty: 4 }] }
    );
    expect(edited.type).toBe("COMBO");

    const options = await ProductModel.getComboOptions({
      tenantId: acme.id,
      id: combo.id,
    });
    expect(options.allowedProducts.map((p) => p.productId)).toEqual([galletaC.id]);

    // Restaura la whitelist original para el resto de los tests de este archivo.
    await ProductModel.edit(
      { tenantId: acme.id, id: combo.id },
      {
        comboOptions: [
          { allowedProductId: galletaA.id, minQty: 0, maxQty: 3 },
          { allowedProductId: galletaB.id, minQty: 0, maxQty: 3 },
          { allowedProductId: galletaD.id, minQty: 0 },
        ],
      }
    );
  });

  it("edit rechaza que un combo se permita a sí mismo", async () => {
    await expect(
      ProductModel.edit(
        { tenantId: acme.id, id: combo.id },
        { comboOptions: [{ allowedProductId: combo.id }] }
      )
    ).rejects.toMatchObject({ code: "COMBO_PRODUCT_NOT_ALLOWED" });
  });
});

describe("GET /products/:id/combo-options", () => {
  it("ADMIN puede leer la whitelist del combo", async () => {
    const res = await request(app)
      .get(`/products/${combo.id}/combo-options`)
      .set("Cookie", acmeAdminCookie);

    expect(res.status).toBe(200);
    expect(res.body.comboMinItems).toBe(2);
    expect(res.body.allowedProducts).toHaveLength(3);
  });
});

describe("POST /cart/combo/:productId", () => {
  it("selección válida dentro del whitelist y del min/max → 201", async () => {
    const res = await request(app)
      .post(`/cart/combo/${combo.id}`)
      .set("Cookie", cookieFor(acmeCustomer))
      .send({
        selection: [
          { productId: galletaA.id, quantity: 2 },
          { productId: galletaB.id, quantity: 1 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.cantidad).toBe(1);
    expect(res.body.data.seleccion).toHaveLength(2);
  });

  it("selección por debajo del mínimo → 400 COMBO_SELECTION_OUT_OF_RANGE", async () => {
    const res = await request(app)
      .post(`/cart/combo/${combo.id}`)
      .set("Cookie", cookieFor(acmeCustomer))
      .send({ selection: [{ productId: galletaA.id, quantity: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("COMBO_SELECTION_OUT_OF_RANGE");
  });

  it("producto fuera de la whitelist → 400 COMBO_PRODUCT_NOT_ALLOWED", async () => {
    const res = await request(app)
      .post(`/cart/combo/${combo.id}`)
      .set("Cookie", cookieFor(acmeCustomer))
      .send({
        selection: [
          { productId: galletaA.id, quantity: 1 },
          { productId: galletaC.id, quantity: 1 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("COMBO_PRODUCT_NOT_ALLOWED");
  });

  it("excede maxQty permitido para ese producto → 400 COMBO_ITEM_QTY_OUT_OF_RANGE", async () => {
    const res = await request(app)
      .post(`/cart/combo/${combo.id}`)
      .set("Cookie", cookieFor(acmeCustomer))
      .send({ selection: [{ productId: galletaA.id, quantity: 4 }] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("COMBO_ITEM_QTY_OUT_OF_RANGE");
  });

  it("stock insuficiente de un componente → 409 INSUFFICIENT_STOCK", async () => {
    // galletaD tiene stock=1 y sin maxQty propio; pedir 2 respeta comboMinItems/
    // comboMaxItems (2-4) pero excede el stock real del componente.
    const res = await request(app)
      .post(`/cart/combo/${combo.id}`)
      .set("Cookie", cookieFor(acmeCustomer))
      .send({ selection: [{ productId: galletaD.id, quantity: 2 }] });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");
  });
});

describe("Orden con combo: precio fijo, stock sobre componentes", () => {
  it("total = precio fijo del combo (no suma de partes) y arma childItems", async () => {
    // El customer puede tener una línea de combo residual de los tests de
    // carrito de arriba; se limpia para que `quantity` (cantidad de combos
    // comprados) parta de 0 y las aserciones de total/quantity sean exactas.
    await CartModel.clear({ tenantId: acme.id, userId: acmeCustomer.id }).catch(() => {});

    await CartModel.addCombo({
      tenantId: acme.id,
      userId: acmeCustomer.id,
      comboProductId: combo.id,
      selection: [
        { productId: galletaA.id, quantity: 2 },
        { productId: galletaB.id, quantity: 1 },
      ],
    });

    const order = await OrderModel.create({ tenantId: acme.id, userId: acmeCustomer.id });

    expect(order.total).toBe(3000);
    expect(order.orderItems).toHaveLength(1);

    const parent = order.orderItems[0];
    expect(parent.productId).toBe(combo.id);
    expect(parent.variantId).toBeNull();
    expect(parent.price).toBe(3000);
    expect(parent.childItems).toHaveLength(2);
    expect(parent.childItems.every((c) => c.price === 0)).toBe(true);

    const childA = parent.childItems.find((c) => c.productId === galletaA.id);
    const childB = parent.childItems.find((c) => c.productId === galletaB.id);
    expect(childA.quantity).toBe(2);
    expect(childB.quantity).toBe(1);
  });

  it("al completar la orden descuenta stock de los componentes, no del combo", async () => {
    await CartModel.addCombo({
      tenantId: acme.id,
      userId: acmeCustomer.id,
      comboProductId: combo.id,
      selection: [{ productId: galletaA.id, quantity: 2 }],
    });
    const order = await OrderModel.create({ tenantId: acme.id, userId: acmeCustomer.id });

    const galletaAVariantId = galletaA.variants[0].id;
    const stockBeforeA = (
      await prisma.productVariant.findUnique({ where: { id: galletaAVariantId } })
    ).stock;

    await OrderModel.updateOrderStatus({
      tenantId: acme.id,
      orderId: order.id,
      status: "COMPLETED",
    });

    const stockAfterA = (
      await prisma.productVariant.findUnique({ where: { id: galletaAVariantId } })
    ).stock;

    expect(stockAfterA).toBe(stockBeforeA - 2);
    // El combo no tiene stock propio: `Product.stock` ni siquiera existe como
    // columna (se eliminó en el colapso a 2 tipos) — no hay nada que descontar acá.
  });
});

describe("Combos: whitelist por categoría", () => {
  let categoriaPromos;
  let galletaE;
  let galletaF;
  let comboCategoria;

  beforeAll(async () => {
    categoriaPromos = await CategoryModel.create({
      tenantId: acme.id,
      name: "Categoría Promos",
    });

    galletaE = await ProductModel.create({
      tenantId: acme.id,
      name: "Galleta E (categoría promos)",
      type: "PRODUCTO",
      variants: [{ price: 800, stock: 20 }],
      categoryId: categoriaPromos.id,
    });
    galletaF = await ProductModel.create({
      tenantId: acme.id,
      name: "Galleta F (categoría promos)",
      type: "PRODUCTO",
      variants: [{ price: 800, stock: 20 }],
      categoryId: categoriaPromos.id,
    });

    comboCategoria = await ProductModel.create({
      tenantId: acme.id,
      name: "Combo por categoría",
      price: 2500,
      type: "COMBO",
      // Ignorados a propósito: con comboCategoryOptions presentes el rango total
      // se DERIVA de la suma por categoría (acá: min 0 / max 2).
      comboMinItems: 1,
      comboMaxItems: 3,
      // galletaA queda whitelisteada explícitamente (standalone legacy, prioridad
      // sobre la categoría); el resto de la categoría "Promos" (galletaE, galletaF)
      // entra vía comboCategoryOptions sin miembros explícitos (= todos).
      comboOptions: [{ allowedProductId: galletaA.id, minQty: 0, maxQty: 2 }],
      comboCategoryOptions: [
        { categoryId: categoriaPromos.id, minQty: 0, maxQty: 2 },
      ],
    });
  });

  it("create con comboCategoryOptions deriva comboMinItems/comboMaxItems de la suma por categoría", () => {
    expect(comboCategoria.comboMinItems).toBe(0);
    expect(comboCategoria.comboMaxItems).toBe(2);
  });

  it("comboCategoryOptions inexistente → CATEGORY_NOT_FOUND", async () => {
    await expect(
      ProductModel.create({
        tenantId: acme.id,
        name: "Combo con categoría inválida",
        price: 1000,
        type: "COMBO",
        comboMinItems: 1,
        comboMaxItems: 1,
        comboCategoryOptions: [{ categoryId: 999999 }],
      })
    ).rejects.toMatchObject({ code: "CATEGORY_NOT_FOUND" });
  });

  it("getComboOptions expone allowedCategories con los productos activos de la categoría", async () => {
    const options = await ProductModel.getComboOptions({
      tenantId: acme.id,
      id: comboCategoria.id,
    });

    expect(options.allowedCategories).toHaveLength(1);
    const group = options.allowedCategories[0];
    expect(group.categoryId).toBe(categoriaPromos.id);
    expect(group.minQty).toBe(0);
    expect(group.maxQty).toBe(2);
    // Sin miembros explícitos: la categoría expande a todos sus productos activos.
    expect(group.memberProductIds).toEqual([]);

    const groupProductIds = group.products.map((p) => p.productId).sort((a, b) => a - b);
    expect(groupProductIds).toEqual([galletaE.id, galletaF.id].sort((a, b) => a - b));

    // galletaA está whitelisteada explícitamente → aparece en allowedProducts, no
    // duplicada dentro de allowedCategories aunque comparta tenant/categoría null.
    expect(options.allowedProducts.map((p) => p.productId)).toEqual([galletaA.id]);
  });

  it("selecciona un producto vía categoría (no explícito) → 201", async () => {
    const res = await request(app)
      .post(`/cart/combo/${comboCategoria.id}`)
      .set("Cookie", cookieFor(acmeCustomer))
      .send({ selection: [{ productId: galletaE.id, quantity: 1 }] });

    expect(res.status).toBe(201);
  });

  it("la cantidad de la categoría acota el total derivado del combo", async () => {
    // maxQty 2 de la única categoría => comboMaxItems derivado 2; pedir 3 cae en el
    // chequeo de total (que corre antes que el de suma por grupo).
    const res = await request(app)
      .post(`/cart/combo/${comboCategoria.id}`)
      .set("Cookie", cookieFor(acmeCustomer))
      .send({ selection: [{ productId: galletaF.id, quantity: 3 }] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("COMBO_SELECTION_OUT_OF_RANGE");
  });

  it("producto fuera de la whitelist explícita y de la categoría permitida → COMBO_PRODUCT_NOT_ALLOWED", async () => {
    const res = await request(app)
      .post(`/cart/combo/${comboCategoria.id}`)
      .set("Cookie", cookieFor(acmeCustomer))
      .send({ selection: [{ productId: galletaC.id, quantity: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("COMBO_PRODUCT_NOT_ALLOWED");
  });

  it("edit reemplaza comboCategoryOptions de forma independiente de comboOptions", async () => {
    const otherCategory = await CategoryModel.create({
      tenantId: acme.id,
      name: "Categoría Promos 2",
    });

    const edited = await ProductModel.edit(
      { tenantId: acme.id, id: comboCategoria.id },
      { comboCategoryOptions: [{ categoryId: otherCategory.id, minQty: 0, maxQty: 1 }] }
    );
    expect(edited.type).toBe("COMBO");

    const options = await ProductModel.getComboOptions({
      tenantId: acme.id,
      id: comboCategoria.id,
    });
    // La categoría vieja ya no está; la whitelist explícita (comboOptions) no se
    // tocó porque no vino en este edit.
    expect(options.allowedCategories.map((c) => c.categoryId)).toEqual([otherCategory.id]);
    expect(options.allowedProducts.map((p) => p.productId)).toEqual([galletaA.id]);
  });
});

describe("Combos: miembros explícitos y cantidad por grupo", () => {
  let categoriaBrownies;
  let categoriaCookies;
  let brownieA;
  let brownieB;
  let brownieC;
  let cookieA;
  let cookieB;
  let comboArmado;

  beforeAll(async () => {
    categoriaBrownies = await CategoryModel.create({
      tenantId: acme.id,
      name: "Categoría Brownies",
    });
    categoriaCookies = await CategoryModel.create({
      tenantId: acme.id,
      name: "Categoría Cookies",
    });

    const mk = (name, categoryId) =>
      ProductModel.create({
        tenantId: acme.id,
        name,
        type: "PRODUCTO",
        variants: [{ price: 900, stock: 20 }],
        categoryId,
      });
    brownieA = await mk("Brownie A", categoriaBrownies.id);
    brownieB = await mk("Brownie B", categoriaBrownies.id);
    brownieC = await mk("Brownie C (excluido)", categoriaBrownies.id);
    cookieA = await mk("Cookie A", categoriaCookies.id);
    cookieB = await mk("Cookie B", categoriaCookies.id);

    // "El combo lleva 2 brownies (solo A y B, C excluido) y cookies sin tope":
    // brownies con miembros explícitos y cantidad exacta (min=max=2); cookies sin
    // miembros (todos) y sin tope (maxQty null => combo sin máximo total).
    comboArmado = await ProductModel.create({
      tenantId: acme.id,
      name: "Combo armado",
      price: 5000,
      type: "COMBO",
      comboCategoryOptions: [
        {
          categoryId: categoriaBrownies.id,
          minQty: 2,
          maxQty: 2,
          productIds: [brownieA.id, brownieB.id],
        },
        { categoryId: categoriaCookies.id, minQty: 1, maxQty: null },
      ],
    });
  });

  it("deriva el rango total: suma de mínimos, sin tope si algún grupo no lo tiene", () => {
    expect(comboArmado.comboMinItems).toBe(3);
    expect(comboArmado.comboMaxItems).toBeNull();
  });

  it("getComboOptions expande solo los miembros explícitos y expone memberProductIds", async () => {
    const options = await ProductModel.getComboOptions({
      tenantId: acme.id,
      id: comboArmado.id,
    });

    expect(options.allowedProducts).toEqual([]);
    expect(options.allowedCategories).toHaveLength(2);

    const brownies = options.allowedCategories.find(
      (c) => c.categoryId === categoriaBrownies.id
    );
    expect(brownies.memberProductIds.sort((a, b) => a - b)).toEqual(
      [brownieA.id, brownieB.id].sort((a, b) => a - b)
    );
    // brownieC existe en la categoría pero NO aparece: quedó fuera de los miembros.
    expect(brownies.products.map((p) => p.productId).sort((a, b) => a - b)).toEqual(
      [brownieA.id, brownieB.id].sort((a, b) => a - b)
    );

    const cookies = options.allowedCategories.find(
      (c) => c.categoryId === categoriaCookies.id
    );
    expect(cookies.memberProductIds).toEqual([]);
    expect(cookies.products.map((p) => p.productId).sort((a, b) => a - b)).toEqual(
      [cookieA.id, cookieB.id].sort((a, b) => a - b)
    );
  });

  it("selección válida mezclando miembros del grupo → 201", async () => {
    const res = await request(app)
      .post(`/cart/combo/${comboArmado.id}`)
      .set("Cookie", cookieFor(acmeCustomer))
      .send({
        selection: [
          { productId: brownieA.id, quantity: 1 },
          { productId: brownieB.id, quantity: 1 },
          { productId: cookieA.id, quantity: 2 },
        ],
      });

    expect(res.status).toBe(201);
  });

  it("producto de la categoría que NO es miembro explícito → COMBO_PRODUCT_NOT_ALLOWED", async () => {
    const res = await request(app)
      .post(`/cart/combo/${comboArmado.id}`)
      .set("Cookie", cookieFor(acmeCustomer))
      .send({
        selection: [
          { productId: brownieA.id, quantity: 1 },
          { productId: brownieC.id, quantity: 1 },
          { productId: cookieA.id, quantity: 1 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("COMBO_PRODUCT_NOT_ALLOWED");
    expect(res.body.error.details.productId).toBe(brownieC.id);
  });

  it("suma del grupo por encima del máximo de su categoría → COMBO_ITEM_QTY_OUT_OF_RANGE", async () => {
    // 3 brownies entre A y B (grupo max 2) con total válido (cookies sin tope).
    const res = await request(app)
      .post(`/cart/combo/${comboArmado.id}`)
      .set("Cookie", cookieFor(acmeCustomer))
      .send({
        selection: [
          { productId: brownieA.id, quantity: 2 },
          { productId: brownieB.id, quantity: 1 },
          { productId: cookieA.id, quantity: 1 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("COMBO_ITEM_QTY_OUT_OF_RANGE");
    expect(res.body.error.details).toMatchObject({
      categoryId: categoriaBrownies.id,
      minQty: 2,
      maxQty: 2,
      selected: 3,
    });
  });

  it("el mínimo de una categoría se exige aunque no se elija nada de ella", async () => {
    // Total 3 cumple el mínimo derivado, pero brownies (min 2) quedó en 0.
    const res = await request(app)
      .post(`/cart/combo/${comboArmado.id}`)
      .set("Cookie", cookieFor(acmeCustomer))
      .send({ selection: [{ productId: cookieA.id, quantity: 3 }] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("COMBO_ITEM_QTY_OUT_OF_RANGE");
    expect(res.body.error.details).toMatchObject({
      categoryId: categoriaBrownies.id,
      selected: 0,
    });
  });

  it("productIds con un producto de otra categoría → COMBO_MEMBER_CATEGORY_MISMATCH", async () => {
    await expect(
      ProductModel.edit(
        { tenantId: acme.id, id: comboArmado.id },
        {
          comboCategoryOptions: [
            {
              categoryId: categoriaBrownies.id,
              minQty: 2,
              maxQty: 2,
              productIds: [cookieA.id],
            },
          ],
        }
      )
    ).rejects.toMatchObject({ code: "COMBO_MEMBER_CATEGORY_MISMATCH" });
  });

  it("edit reemplaza los miembros y rederiva el rango total", async () => {
    const edited = await ProductModel.edit(
      { tenantId: acme.id, id: comboArmado.id },
      {
        comboCategoryOptions: [
          {
            categoryId: categoriaBrownies.id,
            minQty: 3,
            maxQty: 3,
            productIds: [brownieB.id, brownieC.id],
          },
        ],
      }
    );
    expect(edited.comboMinItems).toBe(3);
    expect(edited.comboMaxItems).toBe(3);

    const options = await ProductModel.getComboOptions({
      tenantId: acme.id,
      id: comboArmado.id,
    });
    expect(options.allowedCategories).toHaveLength(1);
    const brownies = options.allowedCategories[0];
    expect(brownies.memberProductIds.sort((a, b) => a - b)).toEqual(
      [brownieB.id, brownieC.id].sort((a, b) => a - b)
    );
  });
});

describe("Bot de WhatsApp: combos rechazados con mensaje amigable", () => {
  it("createDraftOrder sobre un producto combo devuelve error, no crea la orden", async () => {
    const { executeTool } = buildToolContext({
      tenantId: acme.id,
      user: null,
      config: {},
      channel: { kind: "whatsapp", waId: "5491100000000", history: [], message: "quiero el combo" },
    });

    const ordersBefore = await prisma.order.count({ where: { tenantId: acme.id } });

    const result = await executeTool("createDraftOrder", {
      items: [{ productId: combo.id, quantity: 1 }],
    });

    expect(result.error).toBeDefined();
    expect(result.created).toBeUndefined();

    const ordersAfter = await prisma.order.count({ where: { tenantId: acme.id } });
    expect(ordersAfter).toBe(ordersBefore);
  });
});
