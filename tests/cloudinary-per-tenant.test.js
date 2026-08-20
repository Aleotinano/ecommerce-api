import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import { randomBytes } from "node:crypto";
import request from "supertest";

// La clave de cifrado se lee de env en runtime, así que va antes de importar nada.
process.env.SECRET_ENC_KEY ||= randomBytes(32).toString("hex");

/**
 * Acá el sujeto es `lib/cloudinary.js`, así que lo que se mockea es el **paquete**
 * `cloudinary`, no nuestro módulo. Lo que se verifica en casi todos los casos es
 * con qué `cloud_name` se llamó al SDK: es la única evidencia real de que dos
 * tenants terminaron en cuentas distintas.
 */
const { uploadMock, destroyMock, signMock, pingMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  destroyMock: vi.fn(),
  signMock: vi.fn(),
  pingMock: vi.fn(),
}));
vi.mock("cloudinary", () => ({
  v2: {
    config: vi.fn(),
    uploader: { upload: uploadMock, destroy: destroyMock },
    utils: { private_download_url: signMock },
    api: { ping: pingMock },
  },
}));

const prisma = (await import("../lib/prisma.js")).default;
const { app } = await import("../app.js");
const { encryptSecret, decryptSecret } = await import("../lib/crypto.js");
const {
  ENV_CREDENTIALS,
  credentialsFor,
  credentialsForCloudName,
  invalidateCredentials,
  platformAccountConfigured,
  resetCredentialsCache,
} = await import("../lib/cloudinary.js");
const { uploadImageToCloudinary, deleteCloudinaryImage } = await import(
  "../lib/imageManager.js"
);
const { seedTenants, seedTenantConfig, cookieFor } = await import(
  "./helpers.js"
);

const CUENTA_PROPIA = {
  cloudName: "cuenta-del-cliente",
  apiKey: "1234567890",
  apiSecret: "secreto-del-cliente",
};

let acme;
let shopco;
let acmeAdminCookie;

/** Carga credenciales propias sin pasar por la API (que valida con un ping). */
async function cargarCredenciales(tenantId, { cloudName, apiKey, apiSecret }) {
  await prisma.tenantConfig.update({
    where: { tenantId },
    data: {
      cloudinaryCloudName: cloudName,
      cloudinaryApiKey: apiKey,
      cloudinaryApiSecret: apiSecret,
    },
  });
  invalidateCredentials(tenantId);
}

async function limpiarCredenciales(tenantId) {
  await prisma.tenantConfig.update({
    where: { tenantId },
    data: {
      cloudinaryCloudName: null,
      cloudinaryApiKey: null,
      cloudinaryApiSecret: null,
    },
  });
  invalidateCredentials(tenantId);
}

beforeAll(async () => {
  const tenants = await seedTenants();
  acme = tenants.acme;
  shopco = tenants.shopco;

  await seedTenantConfig(acme.id);
  await seedTenantConfig(shopco.id);

  acmeAdminCookie = cookieFor(acme.users[0]);
});

beforeEach(() => {
  resetCredentialsCache();
  uploadMock.mockReset().mockResolvedValue({
    secure_url: "https://cdn.test/img.jpg",
    public_id: "carpeta/img",
  });
  destroyMock.mockReset().mockResolvedValue({ result: "ok" });
  signMock.mockReset().mockReturnValue("https://firmada.test/asset");
  // `cloudinary.v2.api.ping` toma las opciones PRIMERAS (el mapping `ping: 0` de
  // lib/v2/api.js: cero argumentos posicionales antes de options). Este mock decía lo
  // contrario y por eso la suite entera pasaba en verde mientras producción devolvía
  // "Cloudinary rechazó esas credenciales" con las credenciales correctas. El mock exige
  // verlas en el lugar correcto; que ese lugar sea el correcto lo fija, contra el SDK de
  // verdad, el describe "el orden de los argumentos de api.ping".
  pingMock.mockReset().mockImplementation(async (options) => {
    if (!options?.api_secret) throw new Error("ping sin credenciales");
    return { status: "ok" };
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("el orden de los argumentos de api.ping", () => {
  // Este archivo mockea el paquete `cloudinary` entero, así que ningún caso de acá puede
  // ver el adapter real — y eso es justo lo que dejó pasar el bug: el mock fijaba una
  // convención inventada y la suite daba verde mientras el ping de producción salía sin
  // credenciales. Estos dos casos importan el SDK de verdad.
  //
  // **No salen a la red**: `ensureOption` valida `cloud_name` de forma SÍNCRONA, antes de
  // abrir ningún socket. Con las opciones en el lugar equivocado eso lanza y no hay
  // request; con las opciones en el lugar correcto sí habría, así que se lo manda a un
  // `upload_prefix` muerto en loopback.
  const credenciales = {
    cloud_name: "cuenta-inventada",
    api_key: "1",
    api_secret: "2",
  };

  let sdkReal;
  const envGuardadas = {};

  beforeAll(async () => {
    sdkReal = (await vi.importActual("cloudinary")).v2;
  });

  beforeEach(() => {
    // La cuenta de plataforma vacía es lo que hace visible el error, y es la forma del
    // deploy real: cada cliente trae la suya. Con credenciales globales cargadas, el ping
    // mal llamado no falla — valida contra NUESTRA cuenta y dice "ok" con cualquier cosa.
    for (const key of [
      "CLOUDINARY_CLOUD_NAME",
      "CLOUDINARY_API_KEY",
      "CLOUDINARY_API_SECRET",
    ]) {
      envGuardadas[key] = process.env[key];
      delete process.env[key];
    }
    sdkReal.config({
      cloud_name: undefined,
      api_key: undefined,
      api_secret: undefined,
    });
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(envGuardadas)) {
      process.env[key] = value;
    }
  });

  it("con las opciones SEGUNDAS las credenciales NO llegan", () => {
    // La forma que teníamos. El objeto se toma como callback, el ping se queda sin
    // opciones y cae a la config global: sin cuenta de plataforma, ni siquiera sale.
    expect(() => sdkReal.api.ping(undefined, credenciales)).toThrow(
      /Must supply cloud_name/
    );
  });

  it("con las opciones PRIMERAS el cloud_name llega", async () => {
    // El try/catch envuelve al await porque el SDK mezcla las dos formas de fallar: lo
    // que valida antes de abrir el socket lo lanza SÍNCRONAMENTE (`Must supply`, el
    // protocolo), y sólo lo de la red llega como rechazo. Un `.catch()` pelado se comería
    // el rechazo y dejaría pasar el throw.
    let error;
    try {
      await sdkReal.api.ping({
        ...credenciales,
        upload_prefix: "https://127.0.0.1:1",
      });
    } catch (err) {
      error = err;
    }

    // Falla igual —no hay nadie escuchando en ese puerto— pero por la red, y eso es la
    // prueba de que la llamada se armó con las credenciales que le pasamos.
    expect(String(error?.message ?? error)).not.toMatch(/Must supply/);
  });
});

describe("credentialsFor", () => {
  it("sin credenciales propias usa la cuenta global", async () => {
    await limpiarCredenciales(acme.id);

    const creds = await credentialsFor(acme.id);

    expect(creds.cloud_name).toBe(ENV_CREDENTIALS.cloud_name);
  });

  it("con credenciales propias usa la cuenta del cliente, descifrada", async () => {
    await cargarCredenciales(acme.id, {
      cloudName: CUENTA_PROPIA.cloudName,
      apiKey: encryptSecret(CUENTA_PROPIA.apiKey),
      apiSecret: encryptSecret(CUENTA_PROPIA.apiSecret),
    });

    const creds = await credentialsFor(acme.id);

    expect(creds).toEqual({
      cloud_name: CUENTA_PROPIA.cloudName,
      api_key: CUENTA_PROPIA.apiKey,
      api_secret: CUENTA_PROPIA.apiSecret,
    });
  });

  it("si el dato cifrado está corrupto FALLA en vez de caer a la global", async () => {
    // El caso peligroso: el tenant configuró su cuenta y cree que la está usando.
    // Caer a la global acá le mandaría los archivos a NUESTRA cuenta en silencio,
    // que es exactamente lo que la cuenta por cliente viene a evitar. Distinto del
    // tenant que no cargó nada, que eligió la global.
    await cargarCredenciales(acme.id, {
      cloudName: CUENTA_PROPIA.cloudName,
      apiKey: "esto-no-descifra",
      apiSecret: "esto-tampoco",
    });

    await expect(credentialsFor(acme.id)).rejects.toMatchObject({
      code: "CLOUDINARY_CREDENTIALS_UNREADABLE",
    });
  });

  it("una subida con credenciales rotas no llega a tocar Cloudinary", async () => {
    await cargarCredenciales(acme.id, {
      cloudName: CUENTA_PROPIA.cloudName,
      apiKey: "esto-no-descifra",
      apiSecret: "esto-tampoco",
    });

    await expect(
      uploadImageToCloudinary("/tmp/no-existe.jpg", {
        tenantId: acme.id,
        entity: "productos",
      })
    ).rejects.toMatchObject({ code: "CLOUDINARY_CREDENTIALS_UNREADABLE" });

    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("cambiar las credenciales invalida la cache", async () => {
    await cargarCredenciales(acme.id, {
      cloudName: "cuenta-vieja",
      apiKey: encryptSecret("k"),
      apiSecret: encryptSecret("s"),
    });
    expect((await credentialsFor(acme.id)).cloud_name).toBe("cuenta-vieja");

    await cargarCredenciales(acme.id, {
      cloudName: "cuenta-nueva",
      apiKey: encryptSecret("k2"),
      apiSecret: encryptSecret("s2"),
    });

    expect((await credentialsFor(acme.id)).cloud_name).toBe("cuenta-nueva");
  });
});

describe("sin cuenta de plataforma configurada", () => {
  // El deploy donde CADA tienda tiene su cuenta: el `.env` no lleva credenciales,
  // y eso es lo que garantiza que ningún archivo de un cliente pueda terminar en la
  // nuestra por accidente. `ENV_CREDENTIALS` lee `process.env` en cada acceso justo
  // para que esto se pueda probar sin reimportar medio árbol de módulos.
  const guardadas = {};

  beforeEach(() => {
    // `CLOUDINARY_URL` va en la lista desde que es un alias de las otras tres:
    // dejarla puesta alcanza para que este bloque entero deje de probar lo que dice.
    for (const key of [
      "CLOUDINARY_CLOUD_NAME",
      "CLOUDINARY_API_KEY",
      "CLOUDINARY_API_SECRET",
      "CLOUDINARY_URL",
    ]) {
      guardadas[key] = process.env[key];
      delete process.env[key];
    }
    resetCredentialsCache();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(guardadas)) {
      // Asignar `undefined` a `process.env` deja la STRING "undefined", que para una
      // variable opcional es peor que no tenerla.
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetCredentialsCache();
  });

  it("un tenant sin cuenta propia no puede subir, con un error entendible", async () => {
    await limpiarCredenciales(acme.id);
    expect(platformAccountConfigured()).toBe(false);

    await expect(
      uploadImageToCloudinary("/tmp/no-existe.jpg", {
        tenantId: acme.id,
        entity: "productos",
      })
    ).rejects.toMatchObject({
      // Y no el `Must supply cloud_name` que tiraría el SDK, que del lado del panel
      // se ve como un 500 sin explicación.
      code: "CLOUDINARY_NOT_CONFIGURED",
      statusCode: 409,
    });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("un tenant con cuenta propia sigue funcionando normal", async () => {
    await cargarCredenciales(acme.id, {
      cloudName: CUENTA_PROPIA.cloudName,
      apiKey: encryptSecret(CUENTA_PROPIA.apiKey),
      apiSecret: encryptSecret(CUENTA_PROPIA.apiSecret),
    });

    await uploadImageToCloudinary("/tmp/no-existe.jpg", {
      tenantId: acme.id,
      entity: "productos",
    });

    const [, opciones] = uploadMock.mock.calls[0];
    expect(opciones.cloud_name).toBe(CUENTA_PROPIA.cloudName);
  });

  it("borrar no reintenta contra una cuenta de plataforma que no existe", async () => {
    await cargarCredenciales(acme.id, {
      cloudName: CUENTA_PROPIA.cloudName,
      apiKey: encryptSecret(CUENTA_PROPIA.apiKey),
      apiSecret: encryptSecret(CUENTA_PROPIA.apiSecret),
    });
    destroyMock.mockResolvedValue({ result: "not found" });

    await deleteCloudinaryImage("carpeta/x", { tenantId: acme.id });

    // Sin cuenta de plataforma nunca hubo assets viejos ahí: el reintento no tiene
    // contra qué correr y reventaría adentro del SDK.
    expect(destroyMock).toHaveBeenCalledTimes(1);
  });
});

describe("CLOUDINARY_URL como alias de las tres variables", () => {
  // `cloudinary://api_key:api_secret@cloud_name` es la línea que el dashboard da para
  // copiar y pegar, o sea la forma en que la cuenta llega a mano. Pegarla en el .env
  // dejaba el deploy IGUAL que sin cuenta: el SDK sí la parsea al importar, pero el
  // `config({ ...ENV_CREDENTIALS })` la pisaba con undefined (el merge es un `extend`
  // de lodash, que copia los undefined) y `platformAccountConfigured()` seguía
  // diciendo que no hay cuenta. Resultado: 409 para todo tenant sin cuenta propia,
  // sin nada en la mano que lo explicara.
  const CLAVES = [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
    "CLOUDINARY_URL",
  ];
  const guardadas = {};

  beforeEach(() => {
    for (const key of CLAVES) {
      guardadas[key] = process.env[key];
      delete process.env[key];
    }
    resetCredentialsCache();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(guardadas)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetCredentialsCache();
  });

  it("resuelve las tres partes y da la cuenta por configurada", () => {
    process.env.CLOUDINARY_URL = "cloudinary://123456789:se-cre-to@la-nube";

    expect(platformAccountConfigured()).toBe(true);
    expect({ ...ENV_CREDENTIALS }).toEqual({
      cloud_name: "la-nube",
      api_key: "123456789",
      api_secret: "se-cre-to",
    });
  });

  it("desencoda el secreto, que puede venir percent-encoded", () => {
    process.env.CLOUDINARY_URL = "cloudinary://123:a%2Fb%40c@la-nube";

    expect(ENV_CREDENTIALS.api_secret).toBe("a/b@c");
  });

  it("las variables explícitas le ganan a la URL", () => {
    // Una URL vieja olvidada en el entorno no puede cambiarle la cuenta a un deploy
    // que ya tenía las tres cargadas: ahí terminarían archivos de un cliente.
    process.env.CLOUDINARY_URL = "cloudinary://vieja:vieja@nube-vieja";
    process.env.CLOUDINARY_CLOUD_NAME = "nube-explicita";
    process.env.CLOUDINARY_API_KEY = "key-explicita";
    process.env.CLOUDINARY_API_SECRET = "secreto-explicito";

    expect({ ...ENV_CREDENTIALS }).toEqual({
      cloud_name: "nube-explicita",
      api_key: "key-explicita",
      api_secret: "secreto-explicito",
    });
  });

  it("una URL rota se ignora y deja el deploy sin cuenta de plataforma", () => {
    // Y sobre todo NO tira: es una variable opcional, y dejar el server sin arrancar
    // por una línea mal pegada es peor que operar sin cuenta global (que es un
    // estado válido). El formato lo valida `schemas/env.schema.js`, con un mensaje.
    process.env.CLOUDINARY_URL = "esto-no-es-una-url";

    expect(platformAccountConfigured()).toBe(false);
    expect(ENV_CREDENTIALS.cloud_name).toBeUndefined();
  });

  it("un tenant sin cuenta propia sube a la cuenta de la URL", async () => {
    process.env.CLOUDINARY_URL = "cloudinary://123456789:se-cre-to@la-nube";
    await limpiarCredenciales(acme.id);

    await uploadImageToCloudinary("/tmp/no-existe.jpg", {
      tenantId: acme.id,
      entity: "productos",
    });

    const [, opciones] = uploadMock.mock.calls[0];
    expect(opciones.cloud_name).toBe("la-nube");
  });
});

describe("credentialsForCloudName", () => {
  it("un asset de la cuenta global se sigue firmando contra la global", async () => {
    // El caso del cliente que carga su cuenta DESPUÉS de tener archivos subidos:
    // los viejos no se migran y hay que seguir llegando a ellos.
    await cargarCredenciales(acme.id, {
      cloudName: CUENTA_PROPIA.cloudName,
      apiKey: encryptSecret(CUENTA_PROPIA.apiKey),
      apiSecret: encryptSecret(CUENTA_PROPIA.apiSecret),
    });

    const creds = await credentialsForCloudName(acme.id, null);

    expect(creds.cloud_name).toBe(ENV_CREDENTIALS.cloud_name);
  });

  it("un comprobante viejo se abre aunque las credenciales del tenant estén rotas", async () => {
    // Se resuelve sin mirar las del tenant: leer un archivo que está en la cuenta
    // global no depende de que la cuenta nueva esté bien cargada.
    await cargarCredenciales(acme.id, {
      cloudName: CUENTA_PROPIA.cloudName,
      apiKey: "esto-no-descifra",
      apiSecret: "esto-tampoco",
    });

    const creds = await credentialsForCloudName(acme.id, null);

    expect(creds.cloud_name).toBe(ENV_CREDENTIALS.cloud_name);
  });

  it("un asset de la cuenta del cliente se firma con la del cliente", async () => {
    await cargarCredenciales(acme.id, {
      cloudName: CUENTA_PROPIA.cloudName,
      apiKey: encryptSecret(CUENTA_PROPIA.apiKey),
      apiSecret: encryptSecret(CUENTA_PROPIA.apiSecret),
    });

    const creds = await credentialsForCloudName(acme.id, CUENTA_PROPIA.cloudName);

    expect(creds.cloud_name).toBe(CUENTA_PROPIA.cloudName);
  });
});

describe("subidas de catálogo", () => {
  it("dos tenants con cuentas distintas suben a cuentas distintas", async () => {
    await cargarCredenciales(acme.id, {
      cloudName: "cuenta-de-acme",
      apiKey: encryptSecret("k-acme"),
      apiSecret: encryptSecret("s-acme"),
    });
    await limpiarCredenciales(shopco.id);

    await uploadImageToCloudinary("/tmp/no-existe.jpg", {
      tenantId: acme.id,
      entity: "productos",
    });
    await uploadImageToCloudinary("/tmp/no-existe.jpg", {
      tenantId: shopco.id,
      entity: "productos",
    });

    const [, primera] = uploadMock.mock.calls[0];
    const [, segunda] = uploadMock.mock.calls[1];

    expect(primera.cloud_name).toBe("cuenta-de-acme");
    expect(segunda.cloud_name).toBe(ENV_CREDENTIALS.cloud_name);
  });
});

describe("deleteCloudinaryImage con assets viejos", () => {
  it("reintenta contra la cuenta global cuando el asset no está en la del cliente", async () => {
    // Los assets subidos antes de que el cliente tuviera cuenta propia se quedaron
    // en la global. `destroy` contra la cuenta equivocada devuelve "not found" SIN
    // fallar: sin el reintento, cada imagen vieja que alguien borra desde el panel
    // queda huérfana para siempre en la cuenta compartida.
    await cargarCredenciales(acme.id, {
      cloudName: CUENTA_PROPIA.cloudName,
      apiKey: encryptSecret(CUENTA_PROPIA.apiKey),
      apiSecret: encryptSecret(CUENTA_PROPIA.apiSecret),
    });
    destroyMock
      .mockResolvedValueOnce({ result: "not found" })
      .mockResolvedValueOnce({ result: "ok" });

    await deleteCloudinaryImage("carpeta/vieja", { tenantId: acme.id });

    expect(destroyMock).toHaveBeenCalledTimes(2);
    expect(destroyMock.mock.calls[0][1].cloud_name).toBe(CUENTA_PROPIA.cloudName);
    expect(destroyMock.mock.calls[1][1].cloud_name).toBe(
      ENV_CREDENTIALS.cloud_name
    );
  });

  it("no reintenta si el borrado salió bien", async () => {
    await cargarCredenciales(acme.id, {
      cloudName: CUENTA_PROPIA.cloudName,
      apiKey: encryptSecret(CUENTA_PROPIA.apiKey),
      apiSecret: encryptSecret(CUENTA_PROPIA.apiSecret),
    });

    await deleteCloudinaryImage("carpeta/nueva", { tenantId: acme.id });

    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  it("no reintenta si el tenant ya estaba usando la cuenta global", async () => {
    await limpiarCredenciales(acme.id);
    destroyMock.mockResolvedValue({ result: "not found" });

    await deleteCloudinaryImage("carpeta/fantasma", { tenantId: acme.id });

    expect(destroyMock).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH /tenant-config/:tenantId — credenciales de Cloudinary", () => {
  beforeEach(async () => {
    await limpiarCredenciales(acme.id);
  });

  it("guarda las tres, cifradas, y valida contra Cloudinary antes", async () => {
    const res = await request(app)
      .patch(`/tenant-config/${acme.id}`)
      .set("Cookie", acmeAdminCookie)
      .send({
        cloudinaryCloudName: CUENTA_PROPIA.cloudName,
        cloudinaryApiKey: CUENTA_PROPIA.apiKey,
        cloudinaryApiSecret: CUENTA_PROPIA.apiSecret,
      });

    expect(res.status).toBe(200);
    expect(pingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cloud_name: CUENTA_PROPIA.cloudName,
        api_key: CUENTA_PROPIA.apiKey,
        api_secret: CUENTA_PROPIA.apiSecret,
      })
    );

    const row = await prisma.tenantConfig.findUnique({
      where: { tenantId: acme.id },
    });
    expect(row.cloudinaryCloudName).toBe(CUENTA_PROPIA.cloudName);
    // Cifradas en reposo: en la columna no está el valor en claro.
    expect(row.cloudinaryApiSecret).not.toBe(CUENTA_PROPIA.apiSecret);
    expect(decryptSecret(row.cloudinaryApiSecret)).toBe(CUENTA_PROPIA.apiSecret);
    expect(decryptSecret(row.cloudinaryApiKey)).toBe(CUENTA_PROPIA.apiKey);
  });

  it("credenciales que Cloudinary rechaza → 400, con el motivo, y NO se persisten", async () => {
    // Forma real del rechazo del SDK: un objeto plano con la respuesta del proveedor
    // anidada en `error` y el status en `http_code` (ver
    // node_modules/cloudinary/lib/api_client/execute_request.js). No es un `Error`, y la
    // diferencia importa: es `http_code` lo que distingue "contestó que no" de "no
    // contestó".
    pingMock.mockRejectedValue({
      error: { message: "unknown api_key", http_code: 401 },
    });

    const res = await request(app)
      .patch(`/tenant-config/${acme.id}`)
      .set("Cookie", acmeAdminCookie)
      .send({
        cloudinaryCloudName: "cuenta-mal-pegada",
        cloudinaryApiKey: "1",
        cloudinaryApiSecret: "2",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CLOUDINARY_CREDENTIALS_INVALID");
    // Sin esto el que carga la cuenta sólo sabe que "falló", y la causa real queda en un
    // log adentro del contenedor.
    expect(res.body.error.details).toEqual({
      status: 401,
      reason: "unknown api_key",
    });

    const row = await prisma.tenantConfig.findUnique({
      where: { tenantId: acme.id },
    });
    expect(row.cloudinaryCloudName).toBeNull();
  });

  it("si no se llega a Cloudinary → 502, y no se culpa a las credenciales", async () => {
    // El server sin salida a internet daba el MISMO 400 que un secret mal pegado, o sea
    // que mandaba a repegar por tiempo indefinido unas credenciales que estaban bien.
    // Un error de red del SDK es un Error de Node pelado: tiene `code`, no `http_code`.
    pingMock.mockRejectedValue(
      Object.assign(new Error("getaddrinfo ENOTFOUND api.cloudinary.com"), {
        code: "ENOTFOUND",
      })
    );

    const res = await request(app)
      .patch(`/tenant-config/${acme.id}`)
      .set("Cookie", acmeAdminCookie)
      .send({
        cloudinaryCloudName: CUENTA_PROPIA.cloudName,
        cloudinaryApiKey: CUENTA_PROPIA.apiKey,
        cloudinaryApiSecret: CUENTA_PROPIA.apiSecret,
      });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("CLOUDINARY_UNREACHABLE");

    // Tampoco se persisten: no se validaron, así que no se sabe si sirven.
    const row = await prisma.tenantConfig.findUnique({
      where: { tenantId: acme.id },
    });
    expect(row.cloudinaryCloudName).toBeNull();
  });

  it("el API secret no vuelve en el detalle del error, aunque Cloudinary lo ecoe", async () => {
    // El mensaje del proveedor se le muestra a quien carga la cuenta: no puede ser el
    // vehículo por el que un secreto sale a la red.
    pingMock.mockRejectedValue({
      error: {
        message: `Invalid Signature for api_secret=${CUENTA_PROPIA.apiSecret}`,
        http_code: 401,
      },
    });

    const res = await request(app)
      .patch(`/tenant-config/${acme.id}`)
      .set("Cookie", acmeAdminCookie)
      .send({
        cloudinaryCloudName: CUENTA_PROPIA.cloudName,
        cloudinaryApiKey: CUENTA_PROPIA.apiKey,
        cloudinaryApiSecret: CUENTA_PROPIA.apiSecret,
      });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain(CUENTA_PROPIA.apiSecret);
  });

  it("mandar una sola de las tres → 400 de validación", async () => {
    const res = await request(app)
      .patch(`/tenant-config/${acme.id}`)
      .set("Cookie", acmeAdminCookie)
      .send({ cloudinaryCloudName: "solo-el-cloud-name" });

    expect(res.status).toBe(400);
    expect(pingMock).not.toHaveBeenCalled();
  });

  it("las tres en null vuelven a la cuenta global", async () => {
    await cargarCredenciales(acme.id, {
      cloudName: CUENTA_PROPIA.cloudName,
      apiKey: encryptSecret(CUENTA_PROPIA.apiKey),
      apiSecret: encryptSecret(CUENTA_PROPIA.apiSecret),
    });

    const res = await request(app)
      .patch(`/tenant-config/${acme.id}`)
      .set("Cookie", acmeAdminCookie)
      .send({
        cloudinaryCloudName: null,
        cloudinaryApiKey: null,
        cloudinaryApiSecret: null,
      });

    expect(res.status).toBe(200);
    // Sin ping: no hay nada que validar cuando se desconecta.
    expect(pingMock).not.toHaveBeenCalled();
    expect((await credentialsFor(acme.id)).cloud_name).toBe(
      ENV_CREDENTIALS.cloud_name
    );
  });
});

describe("GET /tenant-config/:tenantId — el secreto no sale nunca", () => {
  it("devuelve el cloud name pero no la API key ni el API secret", async () => {
    await cargarCredenciales(acme.id, {
      cloudName: CUENTA_PROPIA.cloudName,
      apiKey: encryptSecret(CUENTA_PROPIA.apiKey),
      apiSecret: encryptSecret(CUENTA_PROPIA.apiSecret),
    });

    const res = await request(app).get(`/tenant-config/${acme.id}`);

    expect(res.status).toBe(200);
    // El cloud name sí: le alcanza al panel para mostrar que hay cuenta propia.
    expect(res.body.cloudinaryCloudName).toBe(CUENTA_PROPIA.cloudName);
    expect(res.body).not.toHaveProperty("cloudinaryApiKey");
    expect(res.body).not.toHaveProperty("cloudinaryApiSecret");
    // Ni siquiera cifradas: no hay motivo para que el ciphertext salga a la red.
    expect(JSON.stringify(res.body)).not.toContain(CUENTA_PROPIA.apiSecret);
  });
});
