---
tags: [abstraccion, transversal/crypto]
estado: TBD
ultima-revision: 2026-07-22
lado: backend
---

# Crypto

> [!todo] Pendiente de documentar
> Stub generado en Fase 3. Fuentes a leer: `lib/crypto.js`. Cifrado AES-256-GCM usado para guardar el
> access token por tenant de [[WhatsApp]] (`TenantConfig.whatsappAccessToken`). Capturar: parseo/
> validación de la clave, env requerido, formato del payload cifrado. `estado: TBD` (ver convención en
> [[App]]).
>
> **Corrección (2026-07-22):** "derivación de clave" es impreciso — `getKey`
> (`lib/crypto.js:22-41`) **no deriva nada** (no hay KDF tipo scrypt/pbkdf2/HKDF): toma
> `process.env.WHATSAPP_TOKEN_ENC_KEY` tal cual y lo interpreta directamente como 32 bytes, en hex
> (64 chars) o base64, validando el largo. Al redactar el doc, hablar de "parseo/validación" de la
> clave, no de "derivación".
>
> **Actualización (2026-07-30):** ya no es "el cifrado de WhatsApp". Con [[Cloudinary por tenant]]
> hay tres secretos en reposo (`whatsappAccessToken`, `cloudinaryApiKey`, `cloudinaryApiSecret`) y la
> clave pasó a llamarse **`SECRET_ENC_KEY`**; `WHATSAPP_TOKEN_ENC_KEY` sigue funcionando como
> fallback para no tener que tocar el deploy. La lista de campos cifrados es
> `SECRET_TENANT_CONFIG_FIELDS` en `schemas/tenant-config.schema.js`.

## Propósito
> [!todo] Pendiente de documentar

## Modelo de datos
> [!todo] Pendiente de documentar

## Reglas de negocio / invariantes
> [!todo] Pendiente de documentar

## Máquina de estados (si aplica)
> [!todo] Pendiente de documentar

## Endpoints
> [!todo] Pendiente de documentar

## Dependencias
> [!todo] Pendiente de documentar

## Integraciones externas
> [!todo] Pendiente de documentar

## Deuda técnica / cosas raras
> [!todo] Pendiente de documentar

## Preguntas abiertas / mejoras candidatas
> [!todo] Pendiente de documentar
