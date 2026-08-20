import { describe, it, expect, vi } from "vitest";
import { errorHandler, notFoundHandler } from "../middleware/errorHandler.js";
import { createError } from "../helpers/error.js";

// El hostname público recibe escaneo automatizado constante (`/.env`,
// `/.git/config`, `/wp-login.php`) y cada 404 escribía el stack completo: ocho
// líneas fijas de `notFoundHandler` y el router de Express, ~1,5 KB de ruido que
// empujaba los logs útiles fuera de la rotación de 10 MB × 3. Lo que fija esta
// suite es dónde queda el corte: el stack sólo en los 5xx, y en los 4xx lo que
// sí sirve para diagnosticar —mensaje y `details`—.
describe("errorHandler: qué del error llega al log", () => {
  const fakeReq = (overrides = {}) => ({
    log: { warn: vi.fn(), error: vi.fn() },
    path: "/.env",
    originalUrl: "/.env",
    ...overrides,
  });

  const fakeRes = () => {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
  };

  // El error se arma con el `notFoundHandler` real, así el test recorre el mismo
  // camino que un bot pidiendo una ruta que no existe.
  const notFound = (req) => {
    let captured;
    notFoundHandler(req, fakeRes(), (err) => {
      captured = err;
    });
    return captured;
  };

  it("un 404 de ruta inexistente se loguea sin stack", () => {
    const req = fakeReq();
    const res = fakeRes();

    errorHandler(notFound(req), req, res, vi.fn());

    expect(req.log.error).not.toHaveBeenCalled();
    expect(req.log.warn).toHaveBeenCalledTimes(1);

    const [payload, message] = req.log.warn.mock.calls[0];
    expect(message).toBe("request error");
    expect(payload.err.stack).toBeUndefined();
    expect(payload.err.message).toBe("ruta: /.env");
    expect(payload).toMatchObject({
      code: "NOT_FOUND",
      path: "/.env",
      statusCode: 404,
    });

    // La respuesta no cambia: esto es un recorte de logging, nada más.
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: { message: "ruta: /.env", code: "NOT_FOUND" },
    });
  });

  it("un 400 de validación conserva details en el log", () => {
    const req = fakeReq({ path: "/products" });
    const details = [{ path: ["price"], message: "debe ser un número" }];

    errorHandler(
      createError("Datos inválidos", "VALIDATION_ERROR", 400, details),
      req,
      fakeRes(),
      vi.fn()
    );

    const [payload] = req.log.warn.mock.calls[0];
    expect(payload.err.stack).toBeUndefined();
    expect(payload.err.details).toEqual(details);
    expect(payload.err.message).toBe("Datos inválidos");
  });

  it("un 5xx sigue llevando el error entero, con su stack", () => {
    const req = fakeReq({ path: "/orders" });
    const err = createError("la base no responde", "INTERNAL_ERROR", 500);

    errorHandler(err, req, fakeRes(), vi.fn());

    expect(req.log.warn).not.toHaveBeenCalled();
    expect(req.log.error).toHaveBeenCalledTimes(1);

    // La instancia misma, no una copia: es lo que garantiza que el serializador
    // de pino tenga un stack que expandir.
    const [payload] = req.log.error.mock.calls[0];
    expect(payload.err).toBe(err);
    expect(payload.err.stack).toBeTypeOf("string");
  });
});
