import path from "node:path";

import { DEFAULTS } from "../../config.js";
import cloudinary, {
  credentialsFor,
  credentialsForCloudName,
} from "../cloudinary.js";
import { removeLocalFile } from "../imageManager.js";

/**
 * Adaptador de Cloudinary para el puerto de almacenamiento. **Único archivo del
 * subsistema que importa `lib/cloudinary.js`**: todo lo de arriba habla con
 * `lib/storage/index.js`, así que cambiar de proveedor (S3, R2) es escribir otro
 * adaptador y no tocar el servicio.
 *
 * No reemplaza a `lib/imageManager.js`, que sigue siendo el camino de las imágenes
 * de catálogo (productos, categorías, logo del tenant). La diferencia real entre
 * los dos no es el proveedor sino el **acceso**: aquellas son públicas y estas no.
 */

const PDF_MIME = "application/pdf";

/**
 * Cloudinary separa `image` (transformable, con miniatura) de `raw` (se sirve tal
 * cual). El PDF va como `raw` a propósito: entregarlo como `image` depende de que
 * la cuenta tenga habilitada la entrega de PDF —viene bloqueada por defecto en
 * varias— y no quiero que el comportamiento dependa de una casilla del dashboard.
 * El costo es que no hay miniatura y el panel muestra un link.
 */
export function resourceTypeFor(mimeType) {
  return mimeType === PDF_MIME ? "raw" : "image";
}

function folderFor(tenantId, entity) {
  // Los assets públicos van a `{folder}/{entity}`; los privados se separan además
  // POR TENANT. La carpeta se mantiene aunque el cliente ya tenga su propia cuenta
  // de Cloudinary: los tenants sin cuenta propia siguen compartiendo la global, y
  // ahí adentro esta separación es lo único que hay.
  return path.posix.join(
    DEFAULTS.CLOUDINARY_FOLDER,
    "tenants",
    String(tenantId),
    entity
  );
}

/**
 * Sube un archivo y devuelve con qué volver a encontrarlo. Borra el temporal en un
 * `finally`, igual que `uploadImageToCloudinary`.
 *
 * `access: "private"` (el default) sube como `authenticated`: el archivo deja de
 * ser legible por URL pública y solo se llega con una URL firmada (`signedUrl`).
 */
export async function putFile(
  filePath,
  { tenantId, entity, access = "private", mimeType }
) {
  const resourceType = resourceTypeFor(mimeType);
  const deliveryType = access === "public" ? "upload" : "authenticated";
  const credentials = await credentialsFor(tenantId);

  try {
    const result = await cloudinary.uploader.upload(filePath, {
      ...credentials,
      folder: folderFor(tenantId, entity),
      resource_type: resourceType,
      type: deliveryType,
      use_filename: true,
      unique_filename: true,
    });

    return {
      // En QUÉ cuenta quedó. Se persiste con el asset porque el tenant puede
      // cargar su cuenta propia después: sin esto, un comprobante viejo se
      // firmaría contra la cuenta nueva y daría una URL que 404ea. Sale de las
      // credenciales y no de `result` porque la respuesta del upload no trae el
      // cloud name.
      cloudName: credentials.cloud_name,
      publicId: result.public_id,
      resourceType: result.resource_type ?? resourceType,
      deliveryType: result.type ?? deliveryType,
      // En `raw` la extensión suele venir dentro del public_id y `format` vacío;
      // el caller completa con la del archivo original si hace falta.
      format: result.format || null,
      bytes: result.bytes ?? 0,
    };
  } finally {
    await removeLocalFile(filePath);
  }
}

/**
 * URL firmada y con vencimiento para UN acceso puntual.
 *
 * `private_download_url` firma contra el `api_secret` e incluye `expires_at`, que
 * es lo que hace que el link muera solo. Los *auth tokens* sobre URLs de delivery
 * darían lo mismo sin pasar por el endpoint de descarga, pero son de planes
 * superiores — este camino funciona en los básicos.
 *
 * > Si en la cuenta de algún cliente `expires_at` no estuviera disponible, el
 * > fallback es `cloudinary.url(publicId, { type, sign_url: true })`: no vence,
 * > pero tampoco es derivable sin el secreto, o sea sigue siendo mejor que la URL
 * > pública que usan las imágenes. El cambio queda contenido en esta función.
 *
 * Es `async` porque firmar necesita el `api_secret` **del tenant**, y eso sale de
 * la DB. Se firma contra la cuenta donde el archivo está de verdad (`cloudName`),
 * no contra la que el tenant tenga configurada hoy.
 */
export async function signedUrl(
  { tenantId, cloudName, publicId, resourceType, deliveryType, format },
  { ttlSeconds }
) {
  const credentials = await credentialsForCloudName(tenantId, cloudName);

  return cloudinary.utils.private_download_url(publicId, format ?? "", {
    ...credentials,
    resource_type: resourceType,
    type: deliveryType,
    expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
}

/**
 * Borra el archivo del proveedor de verdad.
 *
 * **`type` y `resource_type` van los dos, y no es decorativo**: `destroy` asume
 * `image`/`upload` si no se los pasás, así que borrar un PDF (`raw`) o cualquier
 * asset `authenticated` con los defaults devuelve "not found" **sin fallar** y el
 * archivo se queda ahí para siempre. Es justo el modo de falla que no queremos en
 * algo que guarda CBUs. (`deleteCloudinaryImage` en lib/imageManager.js fija
 * `resource_type: "image"` — correcto para lo suyo, inservible para esto.)
 */
export async function deleteFile({
  tenantId,
  cloudName,
  publicId,
  resourceType,
  deliveryType,
}) {
  if (!publicId) return;

  // Contra la cuenta donde el archivo está, no contra la configurada hoy: si el
  // cliente cargó su cuenta después de recibir comprobantes, los viejos siguen en
  // la global (y `destroy` en la cuenta equivocada devuelve "not found" sin fallar,
  // que es justo el modo de falla que este archivo evita en otros lados).
  const credentials = await credentialsForCloudName(tenantId, cloudName);

  await cloudinary.uploader.destroy(publicId, {
    ...credentials,
    resource_type: resourceType,
    type: deliveryType,
    invalidate: true,
  });
}
