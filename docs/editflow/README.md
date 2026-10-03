---
tags: [editflow, proyecto-nuevo, moc]
estado: propuesta
ultima-revision: 2026-10-03
---

# EditFlow — kit de arranque

Software para gestionar una agencia de edición de video: clientes, tandas de videos, el
estado de cada video y qué editor tiene qué clientes. Es un proyecto **aparte de Cori**: Cori
gira alrededor de la orden de compra (producto → pago → entrega) y la agencia gira alrededor
del trabajo (cliente → tanda → video → revisión → entrega).

Esta carpeta vive en el repo de Cori **solo hasta que exista el repo de EditFlow**: es el
material para arrancarlo, no código de Cori. Se mueve entera a `docs/` del repo nuevo.

## Qué hay acá

| Doc | Para qué |
| --- | --- |
| [ARQUITECTURA.md](./ARQUITECTURA.md) | Stack, carpetas, capas y reglas de código. Lo que no se discute módulo por módulo |
| [DOMINIO.md](./DOMINIO.md) | Entidades, estados, precios y pantallas. **Tiene preguntas abiertas** |
| [REUTILIZACION.md](./REUTILIZACION.md) | Qué archivo de Cori se lleva, a dónde y cómo |
| [PROMPTS.md](./PROMPTS.md) | Los prompts para construirlo por fases con un agente |
| [copiar-desde-cori.sh](./copiar-desde-cori.sh) | Copia al repo nuevo los 175 archivos reutilizables, con procedencia |
| [plantillas/](./plantillas/) | Archivos de Cori ya recortados, que el script copia en lugar del original |

## Las decisiones, en una línea cada una

1. **Monorepo propio** (`apps/api`, `apps/web`, `packages/shared`), no un módulo de Cori.
2. **TypeScript de punta a punta.** Cori tiene el backend en JS y los tipos duplicados en el
   front; acá los schemas Zod viven en `packages/shared` y los dos lados infieren el tipo.
3. **Módulos por feature** en el backend (`src/modules/clients/…`), no capas sueltas
   (`routes/`, `controllers/`, `services/` como en Cori).
4. **`agencyId` desde el día uno**, aunque al principio haya una sola agencia. Agregar
   multi-tenancy después es reescribir cada query; ponerlo ahora es una columna y un
   middleware. Es la lección más cara de Cori, que la tiene bien hecha.
5. **El dominio puro va aparte**: la máquina de estados del video y el cálculo de precio de
   una tanda son funciones sin base, testeables solas (como `order-state.js` en Cori).
6. **El precio se congela en la tanda** al crearla. Cambiar la lista de precios no reescribe
   lo ya vendido (como `OrderItem.price` en Cori).
7. **Reutilizar copiando, no compartiendo.** Se copian ~40 archivos probados de Cori con una
   línea de procedencia. Un paquete compartido entre los dos proyectos recién cuando un mismo
   archivo se haya tenido que corregir en los dos lados.
8. **Los videos no se suben al sistema.** Viven en Drive/Frame.io/YouTube; EditFlow guarda
   links y estados. Subir y servir video es otro producto.

## Antes de escribir código

Las preguntas abiertas de [DOMINIO.md §7](./DOMINIO.md#7-preguntas-abiertas) cambian el
modelo de datos. La más importante: **¿"plan activo" es una suscripción mensual que se
renueva, o una tanda que se compra una vez?** El modelo propuesto cubre las dos, pero conviene
confirmarlo antes de la migración inicial.

Y revisar qué hay hoy en el repo de **Edit Flow**: si ya tiene código, este kit se adapta a
él y no al revés.
