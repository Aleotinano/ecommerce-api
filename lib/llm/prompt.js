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
  BEST_SELLER: "Es el producto mas elegido: mucha gente ya lo compro.",
  NEW_ARRIVAL: "Recien llego al catalogo, todavia casi nadie lo vio.",
  LOW_STOCK: "Quedan muy pocas unidades en stock.",
  NO_RECENT_SALES: "Es una joya del catalogo que paso desapercibida.",
};

/**
 * Consignas de refinamiento. Cada modo reescribe un copy ya generado sin cambiar
 * de producto ni de angulo; `custom` usa la instruccion libre del usuario.
 */
export const REFINEMENT_BRIEFS = {
  shorter: "Reescribilo mas corto y directo, sin perder el gancho.",
  informal: "Reescribilo en un tono mas informal y canchero, mas de amigo.",
  salesy: "Reescribilo mas vendedor, reforzando el deseo y el llamado a la accion.",
};

const cleanLine = (label, value) => (value ? `${label}: ${value}` : null);

export const buildPrompt = ({ product, angle, config, refinement }) => {
  const storeName = config?.storeName || "la tienda";
  const tagline = config?.storeTagline;
  const description = config?.storeDescription;
  const currency = config?.currency || "ARS";
  const angleBrief = ANGLE_BRIEFS[angle] ?? ANGLE_BRIEFS.BEST_SELLER;

  const system = [
    `Sos el community manager de "${storeName}", una tienda de ropa online.`,
    tagline ? `Lema de la marca: "${tagline}".` : null,
    description ? `Sobre la marca: ${description}` : null,
    "Escribi en espanol rioplatense (es-AR), cercano y natural, sin sonar a publicidad robotica.",
    "Tu tarea: redactar UNA publicacion breve para redes sociales sobre el producto indicado.",
    "",
    "Te voy a pasar un 'angulo' (el motivo de la publicacion: mas vendido, novedad, stock bajo, etc.).",
    "Usalo para definir el TONO del caption (prueba social, urgencia, entusiasmo por lo nuevo),",
    "pero nunca lo menciones literalmente ni lo conviertas en hashtag.",
    "",
    "IMPORTANTE: escribi el texto FINAL que publicaria la marca, hablandole al cliente.",
    "NO describas la estrategia ni expliques que hace el copy. Frases como 'genera deseo',",
    "'usa prueba social' o 'destaca que es el mas vendido' estan PROHIBIDAS: eso es la",
    "consigna, no la publicacion. Si te paso un dato del producto, convertilo en un",
    "caption real, no lo repitas como instruccion.",
    "",
    "Ejemplo para calibrar (NO lo copies, es solo de referencia):",
    'MAL (describe la estrategia, no es un caption): {"copy": "Genera deseo mostrando que es el mas vendido."}',
    'BIEN (caption real, JSON valido): {"copy": "Spoiler: combina con todo y no para de salir. En la tienda la tenes 👇", "hashtags": ["#remeraoversize", "#ropaurbana", "#modaargentina", "#outfitcasual"]}',
    "",
    "Responde EXCLUSIVAMENTE con un objeto JSON valido, sin markdown, sin fences ```json, sin texto antes ni despues:",
    '{ "copy": string, "hashtags": string[] }',
    "- copy: maximo 280 caracteres, 1 a 3 frases, puede incluir 1 emoji si suma. No incluyas hashtags dentro del copy.",
    "- hashtags: entre 3 y 6, cada uno con # y sin espacios. Deben ser terminos que un comprador REALMENTE busca: tipo de prenda, estilo, ocasion de uso, ubicacion (Argentina/LATAM). NUNCA hashtags del motivo interno (#MasVendido, #StockBajo, #Novedad, #Oferta): eso no lo busca nadie.",
  ]
    .filter(Boolean)
    .join("\n");

  const price = product?.price != null ? `${currency} ${product.price}` : null;

  // En refinamiento mantenemos el mismo system y solo extendemos el user con el
  // copy previo + la consigna de variacion (la consigna fija o la libre).
  const refinementBrief = refinement
    ? REFINEMENT_BRIEFS[refinement.mode] ?? refinement.instruction
    : null;

  const refinementLines = refinement
    ? [
        "",
        "Ya tenes una version previa de esta publicacion. Reescribila respetando el",
        "mismo producto y el mismo angulo, devolviendo de nuevo el JSON { copy, hashtags }.",
        cleanLine("Copy actual", refinement.baseCopy),
        refinement.baseHashtags?.length
          ? cleanLine("Hashtags actuales", refinement.baseHashtags.join(" "))
          : null,
        `Que cambiar: ${refinementBrief}`,
      ]
    : [];

  const user = [
    "Producto a destacar:",
    cleanLine("Nombre", product?.name),
    cleanLine("Descripcion", product?.description),
    cleanLine("Categoria", product?.category?.name),
    cleanLine("Precio", price),
    "",
    `Angulo de la publicacion: ${angleBrief}`,
    ...refinementLines,
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
};
