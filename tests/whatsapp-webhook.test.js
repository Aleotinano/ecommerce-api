import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import request from "supertest";

// El modulo de WhatsApp se activa con estas env vars. Las seteamos ANTES de
// importar config/app para que queden parseadas en DEFAULTS.WHATSAPP.
const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "test-verify-token";
process.env.WHATSAPP_APP_SECRET = APP_SECRET;
process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;
process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "111222333";

// Mock del motor: el procesamiento real (tenant + LLM + Redis + red) no se ejerce
// aca; solo verificamos el comportamiento del webhook (firma, 200, parseo).
const { processInboundMock } = vi.hoisted(() => ({ processInboundMock: vi.fn() }));
vi.mock("../services/whatsapp/index.js", () => ({
  WhatsappModel: { processInbound: processInboundMock },
}));

const { app } = await import("../app.js");

/** Firma valida (sha256=...) del raw body con el app secret de prueba. */
function sign(rawBody) {
  const hmac = crypto.createHmac("sha256", APP_SECRET).update(rawBody).digest("hex");
  return `sha256=${hmac}`;
}

/** Payload de un mensaje de texto entrante. */
function textPayload({ phoneNumberId = "111222333", from = "5491100000000", body = "hola" } = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550000000", phone_number_id: phoneNumberId },
              contacts: [{ wa_id: from }],
              messages: [{ from, id: "wamid.TEST", type: "text", text: { body } }],
            },
          },
        ],
      },
    ],
  };
}

/** POST firmado: serializamos a string y firmamos ese byte-string exacto. */
function postSigned(payload, { sign: doSign = true } = {}) {
  const raw = JSON.stringify(payload);
  const req = request(app)
    .post("/webhooks/whatsapp")
    .set("Content-Type", "application/json");
  if (doSign) req.set("X-Hub-Signature-256", sign(raw));
  return req.send(raw);
}

beforeAll(() => {
  // nada que sembrar: el procesamiento esta mockeado.
});

beforeEach(() => {
  processInboundMock.mockReset();
  processInboundMock.mockResolvedValue(undefined);
});

describe("GET /webhooks/whatsapp (verificacion)", () => {
  it("verify_token correcto → 200 y devuelve el challenge en texto plano", async () => {
    const res = await request(app)
      .get("/webhooks/whatsapp")
      .query({ "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "12345" });

    expect(res.status).toBe(200);
    expect(res.text).toBe("12345");
  });

  it("verify_token incorrecto → 403", async () => {
    const res = await request(app)
      .get("/webhooks/whatsapp")
      .query({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "12345" });

    expect(res.status).toBe(403);
  });
});

describe("POST /webhooks/whatsapp (recepcion)", () => {
  it("firma invalida → 401 y no procesa", async () => {
    const res = await postSigned(textPayload(), { sign: false });

    expect(res.status).toBe(401);
    expect(processInboundMock).not.toHaveBeenCalled();
  });

  it("mensaje de texto con firma valida → 200 y dispara processInbound", async () => {
    const res = await postSigned(textPayload({ from: "5491155550000", body: "tenes remeras?" }));

    expect(res.status).toBe(200);
    expect(processInboundMock).toHaveBeenCalledTimes(1);
    expect(processInboundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberId: "111222333",
        waId: "5491155550000",
        text: "tenes remeras?",
      })
    );
  });

  it("mensaje no-texto (imagen) → 200 y NO procesa", async () => {
    const payload = textPayload();
    payload.entry[0].changes[0].value.messages = [
      { from: "5491100000000", id: "wamid.IMG", type: "image", image: { id: "x" } },
    ];

    const res = await postSigned(payload);

    expect(res.status).toBe(200);
    expect(processInboundMock).not.toHaveBeenCalled();
  });

  it("status update (sin messages) → 200 y NO procesa", async () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "111222333" },
                statuses: [{ id: "wamid.X", status: "delivered" }],
              },
            },
          ],
        },
      ],
    };

    const res = await postSigned(payload);

    expect(res.status).toBe(200);
    expect(processInboundMock).not.toHaveBeenCalled();
  });
});
