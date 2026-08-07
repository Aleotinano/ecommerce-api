---
tags: [abstraccion, transversal/imagenes]
estado: TBD
ultima-revision: 2026-07-22
lado: backend
---

# Almacenamiento de imágenes

> [!todo] Pendiente de documentar
> Stub generado en Fase 3. Fuentes a leer: `lib/cloudinary.js`, `lib/imageManager.js`, `middleware/upload.js`.
> Subida/borrado en Cloudinary; los modelos guardan `*PublicId` para poder borrar el asset
> (`Product.imgPublicId`, `ProductVariant.imgPublicId`, `TenantConfig.logoPublicId`). Lo consumen
> [[Productos]], [[Variantes]] y [[TenantConfig]]. `estado: TBD` (ver convención en [[App]]).
>
> **Actualización (2026-07-22):** esta lista de consumidores ya no es exhaustiva — falta
> `SuggestionImage.imagePublicId` (`prisma/schema.prisma:495`, ver
> [[Sugerencias de contenido — Imágenes (propuesta)]]), un cuarto consumidor que ya existe en el
> schema. Además hay **dos vías de subida paralelas** en `lib/imageManager.js`, no solo una:
> `uploadImageToCloudinary` (desde un path de disco/multer, el caso "de siempre") y
> `uploadBase64ToCloudinary` (desde base64/data-URI, agregado para subir imágenes generadas por IA
> sin pasar por disco). Al redactar el doc, documentar ambas.
>
> **Actualización (2026-07-30):** las tres funciones de `lib/imageManager.js` reciben ahora
> `tenantId` — cada cliente puede tener **su propia cuenta de Cloudinary** y las credenciales se
> resuelven en runtime. El detalle está en [[Cloudinary por tenant]]; lo que este doc tiene que
> contar cuando se escriba es que `deleteCloudinaryImage` reintenta contra la cuenta global (los
> assets subidos antes de que el cliente tuviera cuenta se quedaron ahí y no se migran).

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
