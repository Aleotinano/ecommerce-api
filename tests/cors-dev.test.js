import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";

// El bypass de localhost de middleware/cors.js sólo existe fuera de producción y
// hasta acá no lo ejercitaba NINGUNA suite: tests/production-mode.test.js fuerza
// "production" y el resto corre en "test", donde la rama se toma pero nadie
// afirma sobre ella. El agujero se notó cuando `mesa-dulce.localhost:3000` —la
// forma de abrir un tenant en dev— empezó a comerse un 403 en cada preflight.
//
// `isProd` y la lista de orígenes se evalúan al cargar el módulo, así que el
// import va después de `vi.resetModules()` con la env ya pisada.
describe("modo desarrollo", () => {
  let middleWare;

  beforeAll(async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ORIGINS", "https://panel.produccion.test");
    vi.resetModules();

    ({ middleWare } = await import("../middleware/cors.js"));
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const appCon = (cors) => {
    const app = express();
    app.use(cors);
    app.get("/health", (req, res) => res.json({ status: "ok" }));
    // Misma forma de respuesta que middleware/errorHandler.js, para poder
    // afirmar sobre el `code` sin arrastrar acá el logger real.
    app.use((err, _req, res, _next) =>
      res
        .status(err.statusCode || 500)
        .json({ error: { message: err.message, code: err.code } })
    );
    return app;
  };

  const get = (origin) =>
    request(appCon(middleWare())).get("/health").set("Origin", origin);

  describe("subdominio de localhost", () => {
    // El storefront resuelve el tenant desde el host, así que en dev se entra por
    // `<slug>.localhost`. Sin esto no carga ni el catálogo: /store/config,
    // /store/products, /store/categories y /store/cart mueren en el preflight.
    it("acepta el origen de un tenant", async () => {
      const res = await get("http://mesa-dulce.localhost:3000");

      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe(
        "http://mesa-dulce.localhost:3000"
      );
    });

    it("responde el preflight con el origen reflejado y credentials", async () => {
      const res = await request(appCon(middleWare()))
        .options("/health")
        .set("Origin", "http://mesa-dulce.localhost:3000")
        .set("Access-Control-Request-Method", "GET")
        .set("Access-Control-Request-Headers", "x-tenant-slug");

      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe(
        "http://mesa-dulce.localhost:3000"
      );
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
      expect(res.headers["access-control-allow-headers"]).toContain(
        "x-tenant-slug"
      );
    });

    it("sigue aceptando localhost y 127.0.0.1 pelados", async () => {
      for (const origin of ["http://localhost:4001", "http://127.0.0.1:5173"]) {
        const res = await get(origin);

        expect(res.status).toBe(200);
        expect(res.headers["access-control-allow-origin"]).toBe(origin);
      }
    });
  });

  describe("lo que el bypass NO abre", () => {
    it("rechaza un origen ajeno", async () => {
      const res = await get("https://atacante.test");

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("CORS_ORIGIN_NOT_ALLOWED");
    });

    // Un solo nivel de subdominio: `evil.com.localhost` no es la forma en que
    // entra ningún storefront, y `notlocalhost` es otro host entero.
    it("rechaza un subdominio de más de un nivel", async () => {
      const res = await get("http://evil.com.localhost:3000");

      expect(res.status).toBe(403);
    });

    it("rechaza un host que apenas termina en localhost", async () => {
      const res = await get("http://notlocalhost:3000");

      expect(res.status).toBe(403);
    });

    it("rechaza localhost como subdominio de otro dominio", async () => {
      const res = await get("http://localhost.atacante.test");

      expect(res.status).toBe(403);
    });
  });
});
