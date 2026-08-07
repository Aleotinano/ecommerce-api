---
tags: [abstraccion, transversal/mailer]
estado: TBD
ultima-revision: 2026-07-22
lado: backend
---

# Mailer

> [!todo] Pendiente de documentar
> Stub generado en Fase 3. Fuentes a leer: `lib/mailer.js` (`sendMail`, `buildOrderStatusEmail`, y los
> builders de verificación de email). Best-effort (no rompe el flujo del caller). Lo consumen [[Órdenes]]
> (cambio de estado) y [[Usuarios y Auth]] (verificación). `estado: TBD` (ver convención en [[App]]).
>
> **Corrección (2026-07-22):** "flags/modo mock de envío" es impreciso — no hay ningún flag explícito
> tipo `MAIL_MOCK=true`. `isSmtpConfigured` (`lib/mailer.js:9-11`) decide automáticamente según si
> `DEFAULTS.SMTP.HOST`/`PORT` están seteados; si no, `getTransporter` (línea 26-30) cae a
> `nodemailer.createTransport({ jsonTransport: true })` — un transporte de nodemailer que no envía
> nada de verdad. Al redactar el doc, aclarar que el fallback es automático por ausencia de env de
> SMTP, no un flag propio de la app.

> [!important] El email está APAGADO a propósito (2026-07-31)
> No es un pendiente ni un olvido: es una decisión de producto. **WhatsApp es el canal de
> comunicación entre el tenant y su cliente** ([[WhatsApp]]), hay recepcionista del lado del
> comercio, y meter un segundo canal que nadie mira era trabajo para peor experiencia. `SMTP_HOST` no
> está seteado, así que todo cae a `jsonTransport` y no sale nada.
>
> **Los dos ejes que este módulo todavía NO distingue**, y que son el motivo por el que prenderlo sin
> pensar hace lo contrario de lo que uno espera:
>
> | Eje | Quién escribe a quién | Con qué cuenta debería |
> | --- | --- | --- |
> | Plataforma → tenant | nosotros al dueño del comercio | la del `.env` (`SMTP_*`) |
> | Tenant → su comprador | el comercio a quien le compró | la del tenant, en `TenantConfig` |
>
> Hoy **los dos consumidores son del segundo eje**: `sendStatusEmail` (`services/orders.js`) le
> escribe al comprador, y la verificación de cuenta se dispara desde el registro del storefront
> (`controllers/store/auth.js`), también clientes finales. El primer eje **no tiene ningún consumidor
> todavía** — no existe un "tu tienda está lista" ni un aviso de credenciales vencidas.
>
> O sea que `SMTP_*` hoy no es un interruptor de "mail de la plataforma": es un interruptor de
> **"empezar a mandarle mails a los compradores de todos los tenants desde una sola dirección"**.
>
> ### Prender SMTP cambia DOS cosas, no una
>
> `const autoVerify = !isSmtpConfigured()` (`services/users.js:101` y `:180`) acopla el envío con la
> verificación de cuentas:
>
> 1. Los compradores empiezan a recibir mails de cambio de estado desde esa dirección.
> 2. **Los registros nuevos dejan de auto-verificarse** y pasan a exigir el click en el mail. Y el
>    login rechaza con `EMAIL_NOT_VERIFIED` (`services/users.js:240`, `:275`).
>
> El modo de falla feo es el SMTP **a medias**: `isSmtpConfigured()` mira solo `HOST` y `PORT`, así
> que con host y puerto puestos pero credenciales mal, `autoVerify` se apaga **y** el mail no llega
> → nadie puede registrarse ni entrar, y el error del envío solo se loguea
> (`services/users.js` lo envuelve en `try/catch`).
>
> **Antes de configurar SMTP hay que separar los dos ejes**, con el mismo patrón que
> [[Cloudinary por tenant]]: env = cuenta de la plataforma, `TenantConfig` = cuenta del tenant, y
> cada emisor elige. Lo que dispara ese trabajo no es el env: es el primer mail plataforma → tenant
> que realmente se quiera mandar.

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
