import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";

// Comportamiento que SOLO existe con NODE_ENV=production y que por lo tanto no
// ejercita ninguna otra suite (todas corren en "test"). Los dos casos de acá se
// descubrieron preparando el deploy y los dos rompían producción entera, así que
// quedan fijados: ver docs/DEPLOY.md.
//
// `isProd` se evalúa al cargar el módulo, así que cada import va después de
// `vi.resetModules()` con la env ya pisada.
describe("modo producción", () => {
  let middleWare, storeCors, DEFAULTS, envSchema;

  beforeAll(async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRUST_PROXY", "1");
    // La lista trae a propósito una entrada con barra final, un espacio después
    // de la coma y una coma colgada: las tres son formas realistas de escribir
    // mal el .env y ninguna debería dejar al panel afuera.
    vi.stubEnv(
      "ORIGINS",
      "https://panel.permitido.test, https://con-barra.test/,"
    );
    vi.resetModules();

    ({ middleWare, storeCors } = await import("../middleware/cors.js"));
    ({ DEFAULTS } = await import("../config.js"));
    ({ envSchema } = await import("../schemas/env.schema.js"));
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const appCon = (cors) => {
    const app = express();
    app.use(cors);
    app.get("/health", (req, res) => res.json({ status: "ok", ip: req.ip }));
    // Misma forma de respuesta que middleware/errorHandler.js, para poder
    // afirmar sobre el `code` sin arrastrar acá el logger real.
    app.use((err, _req, res, _next) =>
      res
        .status(err.statusCode || 500)
        .json({ error: { message: err.message, code: err.code } })
    );
    return app;
  };

  describe("CORS sin header Origin", () => {
    // curl, el HEALTHCHECK del Dockerfile y los webhooks de MercadoPago y Meta
    // llegan sin `Origin`. Rechazarlos dejaba el contenedor unhealthy para
    // siempre y hacía que los webhooks contestaran 500.
    it("deja pasar la request al panel admin", async () => {
      const res = await request(appCon(middleWare())).get("/health");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
    });

    it("deja pasar la request al storefront", async () => {
      const res = await request(appCon(storeCors())).get("/health");

      expect(res.status).toBe(200);
    });

    it("no emite headers de CORS: no hay origen que autorizar", async () => {
      const res = await request(appCon(middleWare())).get("/health");

      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  describe("CORS con header Origin", () => {
    it("acepta un origen de ORIGINS", async () => {
      const res = await request(appCon(middleWare()))
        .get("/health")
        .set("Origin", "https://panel.permitido.test");

      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe(
        "https://panel.permitido.test"
      );
    });

    // 403, no 500: un origen que no está en la lista es el cliente pidiendo mal,
    // no el server roto. Con 500 el errorHandler enmascaraba el mensaje en prod y
    // el front recibía un INTERNAL_ERROR que no decía nada.
    it("rechaza un origen ajeno con 403 y código propio", async () => {
      const res = await request(appCon(middleWare()))
        .get("/health")
        .set("Origin", "https://atacante.test");

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("CORS_ORIGIN_NOT_ALLOWED");
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    // El header `Origin` del browser nunca lleva barra final, así que sin
    // normalizar, un ORIGINS con barra no matchea jamás y el panel queda afuera.
    // La contracara del bypass de dev (tests/cors-dev.test.js): en producción un
    // `*.localhost` no tiene ningún trato especial y se evalúa contra ORIGINS
    // como cualquier otro origen. Fijarlo acá es lo que impide que aflojar el
    // desarrollo se filtre al deploy sin que nadie lo note.
    it("rechaza un subdominio de localhost: el bypass es sólo de dev", async () => {
      const res = await request(appCon(middleWare()))
        .get("/health")
        .set("Origin", "http://mesa-dulce.localhost:3000");

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("CORS_ORIGIN_NOT_ALLOWED");
    });

    it("acepta un origen configurado con barra final", async () => {
      const res = await request(appCon(middleWare()))
        .get("/health")
        .set("Origin", "https://con-barra.test");

      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe(
        "https://con-barra.test"
      );
    });

    it("ignora la coma colgada de la lista", () => {
      expect(DEFAULTS.ORIGINS).toEqual([
        "https://panel.permitido.test",
        "https://con-barra.test",
      ]);
    });
  });

  describe("preflight", () => {
    // Sin `maxAge` el browser re-preflightea en cada request no-simple: se paga
    // el viaje de ida y vuelta dos veces por llamada.
    it("permite cachear el preflight del panel admin", async () => {
      const res = await request(appCon(middleWare()))
        .options("/health")
        .set("Origin", "https://panel.permitido.test")
        .set("Access-Control-Request-Method", "GET");

      expect(res.headers["access-control-max-age"]).toBe("86400");
    });

    it("permite cachear el preflight del storefront", async () => {
      const res = await request(appCon(storeCors()))
        .options("/health")
        .set("Origin", "https://cualquier-tienda.test")
        .set("Access-Control-Request-Method", "GET");

      expect(res.headers["access-control-max-age"]).toBe("86400");
    });
  });

  describe("ORIGINS es obligatoria en producción", () => {
    // Vacía, en prod, no degrada: rechaza TODAS las requests del panel. Antes la
    // app arrancaba igual y el síntoma era un panel muerto sin ninguna pista.
    const envBase = {
      NODE_ENV: "production",
      DATABASE_URL: "postgres://x:x@localhost:5432/x",
      SECRET_JWT_KEY: "x",
      BASE_URL: "https://api.test",
    };

    it("falla al validar si falta", () => {
      const res = envSchema.safeParse(envBase);

      expect(res.success).toBe(false);
      expect(res.error.issues.some((i) => i.path.includes("ORIGINS"))).toBe(true);
    });

    it("falla también si viene en blanco", () => {
      const res = envSchema.safeParse({ ...envBase, ORIGINS: "   " });

      expect(res.success).toBe(false);
    });

    it("valida bien con al menos un origen", () => {
      const res = envSchema.safeParse({
        ...envBase,
        ORIGINS: "https://panel.test",
      });

      expect(res.success).toBe(true);
    });

    it("no la exige fuera de producción", () => {
      const res = envSchema.safeParse({ ...envBase, NODE_ENV: "development" });

      expect(res.success).toBe(true);
    });
  });

  describe("TRUST_PROXY", () => {
    // La trampa: Express interpreta un `trust proxy` STRING como lista de IPs a
    // confiar, no como cantidad de saltos. Con "1" sin convertir, proxy-addr
    // intenta parsear "1" como IP y el conteo de saltos nunca ocurre — `req.ip`
    // se queda siendo la IP del proxy y el rate limiting deja de discriminar.
    it("convierte la env var a número de saltos, no a string", () => {
      expect(DEFAULTS.TRUST_PROXY).toBe(1);
    });

    it("con 1 salto configurado, req.ip es el cliente y no el proxy", async () => {
      const app = appCon(middleWare());
      app.set("trust proxy", DEFAULTS.TRUST_PROXY);

      const res = await request(app)
        .get("/health")
        .set("X-Forwarded-For", "203.0.113.7");

      expect(res.body.ip).toBe("203.0.113.7");
    });

    it("sin configurar, req.ip ignora X-Forwarded-For", async () => {
      const app = appCon(middleWare());

      const res = await request(app)
        .get("/health")
        .set("X-Forwarded-For", "203.0.113.7");

      expect(res.body.ip).not.toBe("203.0.113.7");
    });
  });
});
