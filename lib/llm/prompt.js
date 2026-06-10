/**
 * Construye el prompt para el LLM a partir del producto + angulo elegidos
 * (Fase 1) y la config de marca del tenant. Provider-agnostico: devuelve
 * { system, user } en texto plano; cada adapter lo acomoda a su API.
 */

/**
 * Situacion del producto por angulo. Es un DATO para que el modelo escriba el
 * caption, no una orden: se redacta como hecho (no "genera deseo", "destaca",
 * etc.) para que no lo eche de loro en el texto final.
 */
export const ANGLE_BRIEFS = {
  BEST_SELLER:
    "Es el producto mas elegido: mucha gente ya lo compro.",
  NEW_ARRIVAL:
    "Recien llego al catalogo, todavia casi nadie lo vio.",
  LOW_STOCK:
    "Quedan muy pocas unidades en stock.",
  NO_RECENT_SALES:
    "Es una joya del catalogo que paso desapercibida.",
};

const cleanLine = (label, value) => (value ? `${label}: ${value}` : null);

export const buildPrompt = ({ product, angle, config }) => {
  const storeName = config?.storeName || "la tienda";
  const tagline = config?.storeTagline;
  const description = config?.storeDescription;
  const currency = config?.currency || "ARS";
  const angleBrief = ANGLE_BRIEFS[angle] ?? ANGLE_BRIEFS.BEST_SELLER;

  const system = [
    `Sos el community manager de "${storeName}", una tienda online.`,
    tagline ? `Lema de la marca: "${tagline}".` : null,
    description ? `Sobre la marca: ${description}` : null,
    "Escribi en espanol rioplatense (es-AR), cercano y natural, sin sonar a publicidad robotica.",
    "Tu tarea: redactar UNA publicacion breve para redes sociales sobre el producto indicado.",
    "",
    "IMPORTANTE: escribi el texto FINAL que publicaria la marca, hablandole al cliente.",
    "NO describas la estrategia ni expliques que hace el copy. Frases como 'genera deseo',",
    "'usa prueba social' o 'destaca que es el mas vendido' estan PROHIBIDAS: eso es la",
    "consigna, no la publicacion. Si te paso un dato del producto, convertilo en un",
    "caption real, no lo repitas como instruccion.",
    "",
    "Ejemplo para calibrar (NO lo copies, es solo de referencia):",
    'MAL (describe la estrategia, no es un caption): {"copy": "Genera deseo mostrando que es el mas vendido."}',
    `BIEN (caption real, JSON valido): {"copy": "Spoiler: combina con todo y no para de salir. En ${storeName} la tenes 👇", "hashtags": ["#ModaAR", "#LookDelDia", "#OutfitDiario"]}`,
    "",
    "Responde EXCLUSIVAMENTE con un objeto JSON valido, sin markdown, sin fences ```json, sin texto antes ni despues:",
    '{ "copy": string, "hashtags": string[] }',
    "- copy: maximo 280 caracteres, 1 a 3 frases, puede incluir 1 emoji si suma. No incluyas hashtags dentro del copy.",
    "- hashtags: entre 3 y 6, cada uno empezando con # y sin espacios. Que sean buscables (rubro, estilo, ocasion) + la marca. Nada de #MasVendido ni genericos vacios.",
  ]
    .filter(Boolean)
    .join("\n");

  const price = product?.price != null ? `${currency} ${product.price}` : null;

  const user = [
    "Producto a destacar:",
    cleanLine("Nombre", product?.name),
    cleanLine("Descripcion", product?.description),
    cleanLine("Categoria", product?.category?.name),
    cleanLine("Precio", price),
    "",
    `Angulo de la publicacion: ${angleBrief}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
};
