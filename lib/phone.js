/**
 * Normalización del teléfono DEL CLIENTE a dígitos E.164.
 *
 * Ojo con la confusión de nombres, hay tres teléfonos distintos en el sistema:
 *   - `TenantConfig.contactPhone` / `socialWhatsapp` → el teléfono DEL NEGOCIO,
 *     lo carga el admin y lo normaliza `normalizeWaPhone` en lib/whatsapp-link.js.
 *   - `TenantConfig.whatsappPhoneNumberId` → un id de la Graph API, NO un teléfono.
 *   - `Order.contactPhone` → el del cliente, que es lo que normaliza este módulo.
 *
 * La diferencia con `normalizeWaPhone` no es cosmética: aquel recibe un número
 * que un admin cargó una vez, mirando el campo, casi siempre con `+54`. Acá
 * recibimos lo que una persona tipea desde el celular en medio de un checkout,
 * que en Argentina es cualquiera de estas formas para el MISMO número:
 *
 *     4123456            (solo el abonado, asume la característica local)
 *     264 4123456
 *     0264 15 4123456    (0 nacional + 15 de móvil)
 *     +54 9 264 412-3456 (la única que wa.me acepta tal cual)
 *
 * Todas tienen que terminar en `5492644123456`. Por eso hace falta saber la
 * característica del tenant: sin ella, `4123456` es irrecuperable.
 *
 * Módulo puro, sin efectos ni dependencias: mismo espíritu que
 * lib/whatsapp-link.js. La copia en TypeScript para el front vive en
 * packages/shared/lib/phone.ts (repos separados) y debe moverse con esta.
 */

// Rango E.164 real. Un móvil argentino completo son 13 dígitos (54 9 + 10).
const MIN_PHONE_DIGITS = 8;
const MAX_PHONE_DIGITS = 15;

// Largo de un número de abonado suelto (sin característica). En AR son 6 a 8
// dígitos según la localidad. Por encima del máximo asumimos que la
// característica ya viene incluida y no la anteponemos; por debajo del mínimo el
// número está incompleto y NO se completa: anteponerle la característica a algo
// de 3 dígitos produce un número con largo plausible pero inventado, que es peor
// que un error (nadie atiende, y el negocio cree que tiene un contacto).
const MIN_SUBSCRIBER_DIGITS = 6;
const MAX_SUBSCRIBER_DIGITS = 8;

// Argentina mete un `9` entre el código de país y la característica para los
// móviles, y wa.me lo exige. Es específico de AR: no se lo aplicamos a otros
// países porque ahí sería un dígito de más.
const AR_COUNTRY_CODE = "54";
const AR_MOBILE_MARKER = "9";

// Característica + abonado, sin el 9 ni el 0. Es constante en todo el país
// (11 + 8 dígitos, 2xx/3xx + 7, 4 dígitos + 6) y por eso sirve de control.
const AR_NATIONAL_DIGITS = 10;

// A partir de cuántos dígitos, después del código de país, damos por hecho que
// el número YA venía en formato internacional. Tiene que ser mayor que cualquier
// abonado suelto: si no, un número local que casualmente arranca con los mismos
// dígitos que el país perdería su comienzo.
const MIN_INTERNATIONAL_DIGITS = MAX_SUBSCRIBER_DIGITS + 1;

/** Solo los dígitos. `null`/no-string/vacío → "". */
function onlyDigits(value) {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

/**
 * Saca el 9 de móvil argentino para dejar el nacional "pelado" (característica +
 * abonado), que es la forma que se puede medir. Se exige el largo exacto para no
 * comerse el primer dígito de una característica que no lo lleve.
 */
function stripArMobileMarker(national, country) {
  const hasMarker =
    country === AR_COUNTRY_CODE &&
    national.startsWith(AR_MOBILE_MARKER) &&
    national.length === AR_NATIONAL_DIGITS + 1;

  return hasMarker ? national.slice(1) : national;
}

/**
 * Limpia una característica cargada por el admin: "0264", "(264)" y "264" son
 * todos 264. Devuelve null si no queda nada usable.
 */
export function normalizeAreaCode(raw) {
  const digits = onlyDigits(raw).replace(/^0+/, "");
  return digits.length >= 2 && digits.length <= 5 ? digits : null;
}

/** Igual para el código de país: "+54" → "54". */
export function normalizeCountryCode(raw) {
  const digits = onlyDigits(raw).replace(/^0+/, "");
  return digits.length >= 1 && digits.length <= 4 ? digits : null;
}

/**
 * Lleva lo que tipeó el cliente a dígitos E.164, sin `+` ni separadores.
 *
 * @param {string|null|undefined} raw  lo que escribió la persona
 * @param {object} [opts]
 * @param {string} [opts.country="54"] código de país del tenant
 * @param {string|null} [opts.area]    característica por defecto del tenant, para
 *                                     completar números locales cortos
 * @returns {string|null} ej. "5492644123456", o null si no es recuperable
 */
export function normalizeCustomerPhone(raw, opts = {}) {
  const country = normalizeCountryCode(opts.country) ?? AR_COUNTRY_CODE;
  const area = normalizeAreaCode(opts.area);

  let digits = onlyDigits(raw);
  if (!digits) return null;

  // Prefijo de salida internacional ("00 54 9 ..."). El `+` ya se fue con los
  // no-dígitos, así que este es el único que queda por sacar.
  if (digits.startsWith("00")) digits = digits.slice(2);

  // ¿Ya viene en internacional? Se acepta solo si lo que sigue al código de país
  // alcanza para ser un número nacional completo; si no, "54..." podría ser
  // perfectamente el arranque de un número local y sacárselo lo rompería.
  const isInternational =
    digits.startsWith(country) &&
    digits.length >= country.length + MIN_INTERNATIONAL_DIGITS;

  // `national` se mantiene SIEMPRE sin el 9 de móvil: es la forma que se puede
  // medir contra un largo conocido. El 9 se agrega recién al final.
  let national = stripArMobileMarker(
    isInternational ? digits.slice(country.length) : digits,
    country
  );

  if (!isInternational) {
    // Prefijo nacional de larga distancia: "0264..." → "264...". El 9 ya se fue
    // arriba, pero puede haber venido detrás del 0 ("0 9 264 ..."), así que se
    // vuelve a intentar una vez limpio.
    national = stripArMobileMarker(national.replace(/^0+/, ""), country);

    if (area && national.startsWith(area)) {
      // Ya trae la característica. Si además trae el 15 de móvil pegado detrás
      // ("264 15 4123456"), ese 15 sobra en formato internacional.
      const rest = national.slice(area.length);
      national = area + (rest.startsWith("15") ? rest.slice(2) : rest);
    } else {
      // El 15 se marca antes del abonado cuando se llama desde otro móvil
      // ("15 4123456"). Se saca ANTES de medir: con él, un abonado de 7 dígitos
      // parece de 9 y no se lo reconocería como local.
      const subscriber = national.startsWith("15")
        ? national.slice(2)
        : national;

      if (area && subscriber.length <= MAX_SUBSCRIBER_DIGITS) {
        // Número local suelto: la característica del tenant es lo único que
        // permite reconstruirlo.
        if (subscriber.length < MIN_SUBSCRIBER_DIGITS) return null;
        national = area + subscriber;
      } else {
        national = subscriber;
      }
    }
  }

  // Un nacional argentino son exactamente 10 dígitos (característica + abonado).
  // Sin este corte, un número al que le falta la característica —porque el
  // tenant no la configuró— pasaría el rango E.164 genérico y se guardaría un
  // teléfono inventado: largo plausible, nadie del otro lado.
  if (country === AR_COUNTRY_CODE && national.length !== AR_NATIONAL_DIGITS) {
    return null;
  }

  const full =
    country +
    (country === AR_COUNTRY_CODE ? AR_MOBILE_MARKER : "") +
    national;

  if (full.length < MIN_PHONE_DIGITS || full.length > MAX_PHONE_DIGITS) {
    return null;
  }

  return full;
}

/**
 * Cuántos dígitos de característica tiene un número nacional argentino.
 *
 * Los 10 dígitos nacionales se reparten entre característica y abonado, pero el
 * corte no se puede deducir de los dígitos solos: 2 + 8 (Buenos Aires), 3 + 7
 * (las capitales de provincia) y 4 + 6 (localidades chicas) son todos válidos.
 * Con la característica del tenant a mano el corte es exacto; sin ella se usa la
 * heurística de que el 11 es el único de 2 dígitos y el resto casi siempre son 3.
 * Solo afecta cómo se VE el número, nunca a dónde se llama.
 */
function arAreaLength(national, hintedArea) {
  if (hintedArea && national.startsWith(hintedArea)) return hintedArea.length;
  return national.startsWith("11") ? 2 : 3;
}

/**
 * Versión legible de un número ya normalizado, para mostrar en el panel.
 * No valida: si le llega algo raro lo devuelve con un `+` adelante y listo.
 *
 * @param {string|null|undefined} normalized dígitos E.164 (salida de la de arriba)
 * @param {object} [opts]
 * @param {string|null} [opts.area] característica del tenant, para cortar exacto
 * @returns {string|null} ej. "+54 9 264 412-3456"
 */
export function formatPhoneDisplay(normalized, opts = {}) {
  const digits = onlyDigits(normalized);
  if (!digits) return null;

  // Solo se agrupa el caso argentino, que es el que vemos: 54 9 AAA NNNNNNN.
  const arMobile = digits.match(/^549(\d{10})$/);
  if (arMobile) {
    const national = arMobile[1];
    const areaLen = arAreaLength(national, normalizeAreaCode(opts.area));
    const area = national.slice(0, areaLen);
    const subscriber = national.slice(areaLen);
    const half = Math.floor(subscriber.length / 2);
    return `+54 9 ${area} ${subscriber.slice(0, half)}-${subscriber.slice(half)}`;
  }

  return `+${digits}`;
}
