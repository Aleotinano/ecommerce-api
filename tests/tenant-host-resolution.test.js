import { describe, it, expect, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";

// De dónde sale el slug del tenant cuando entra una request: del subdominio del
// host o del header `X-Tenant-Slug`. `API_HOSTNAME` se calcula al cargar el
// módulo a partir de BASE_URL, así que cada escenario necesita su propio import.
//
// Prisma va mockeado: acá se prueba la RESOLUCIÓN del slug, no la búsqueda en la
// base, y un import fresco por escenario crearía un PrismaClient nuevo cada vez.
const loadTenant = async (baseUrl) => {
  vi.resetModules();
  vi.stubEnv("BASE_URL", baseUrl);
  vi.doMock("../lib/prisma.js", () => ({
    default: { tenant: { findUnique: async () => null } },
  }));

  return import("../middleware/tenant.js");
};

const appCon = (resolveTenantSlug) => {
  const app = express();
  app.get("/probe", resolveTenantSlug, (req, res) =>
    res.json({ slug: req.tenantSlug })
  );
  app.use((err, _req, res, _next) =>
    res.status(err.statusCode || 500).json({ code: err.code })
  );
  return app;
};

const slugPara = async ({ baseUrl, host, header }) => {
  const { resolveTenantSlug } = await loadTenant(baseUrl);
  const req = request(appCon(resolveTenantSlug)).get("/probe").set("Host", host);
  if (header) req.set("X-Tenant-Slug", header);
  return req;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("../lib/prisma.js");
});

describe("resolución del tenant por host", () => {
  // El host propio de la API no es un tenant. Sin esto, cualquier dominio de 3+
  // partes que no empiece con www/api/app se comía el slug — y como el host tiene
  // prioridad sobre el header, TODO /store/* moría con TENANT_NOT_FOUND.
  describe("cuando el host es el de la API", () => {
    const baseUrl = "https://micomercio.duckdns.org";

    it("usa el header en vez de leer el subdominio como slug", async () => {
      const res = await slugPara({
        baseUrl,
        host: "micomercio.duckdns.org",
        header: "mesa-dulce",
      });

      expect(res.status).toBe(200);
      expect(res.body.slug).toBe("mesa-dulce");
    });

    it("sin header pide el tenant explícitamente, no inventa uno", async () => {
      const res = await slugPara({ baseUrl, host: "micomercio.duckdns.org" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("TENANT_REQUIRED");
    });

    it("compara el host sin distinguir mayúsculas", async () => {
      const res = await slugPara({
        baseUrl,
        host: "MiComercio.DuckDNS.org",
        header: "mesa-dulce",
      });

      expect(res.body.slug).toBe("mesa-dulce");
    });
  });

  // El diseño de subdominio-por-tenant sigue intacto: sólo se descarta el host
  // de la API, no cualquier subdominio.
  describe("cuando el host NO es el de la API", () => {
    const baseUrl = "https://api.midominio.com";

    it("lee el tenant del subdominio", async () => {
      const res = await slugPara({ baseUrl, host: "acme.midominio.com" });

      expect(res.body.slug).toBe("acme");
    });

    it("el subdominio le gana al header", async () => {
      const res = await slugPara({
        baseUrl,
        host: "acme.midominio.com",
        header: "shopco",
      });

      expect(res.body.slug).toBe("acme");
    });

    it("sigue ignorando los subdominios reservados", async () => {
      const res = await slugPara({
        baseUrl,
        host: "www.midominio.com",
        header: "mesa-dulce",
      });

      expect(res.body.slug).toBe("mesa-dulce");
    });

    it("un dominio de dos partes no tiene subdominio que leer", async () => {
      const res = await slugPara({
        baseUrl,
        host: "midominio.com",
        header: "mesa-dulce",
      });

      expect(res.body.slug).toBe("mesa-dulce");
    });
  });

  it("en local sigue mandando el header", async () => {
    const res = await slugPara({
      baseUrl: "http://localhost:3001",
      host: "localhost",
      header: "mesa-dulce",
    });

    expect(res.body.slug).toBe("mesa-dulce");
  });
});
