# Excepciones VEX

Documentos [OpenVEX](https://openvex.dev/) con las CVEs que **no nos afectan** y que por eso no hay
que volver a evaluar en cada scan. Solo entran acá vulnerabilidades **sin parche disponible** y con
una razón concreta de por qué el código vulnerable no es alcanzable — lo que tiene fix se arregla
actualizando la imagen, no suprimiendo.

Cada statement lleva `status: not_affected`, una `justification` de las cinco válidas de la spec, y
un `impact_statement` que explica la evidencia. El razonamiento completo está en
[`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §Infraestructura local.

## Cómo correr el scan aplicando las excepciones

```bash
docker scout cves redis:7-alpine --vex-location .vex --vex-author "<.*@gmail.com>" --only-vex-affected
```

- `--vex-author` es **obligatorio**: por defecto Scout solo confía en statements firmados por un
  autor `@docker.com`, así que sin ese flag muestra la excepción pero igual cuenta la CVE.
- `--only-vex-affected` filtra lo ya justificado. Sin él se ven las CVEs con la anotación
  `VEX: not affected [...]` al lado, que es útil para revisar que el archivo esté haciendo match.

Esto aplica a los scans que corremos nosotros. El panel de scout.docker.com para `redis:7-alpine`
va a seguir mostrando las dos filas: es una imagen de terceros, no un repositorio nuestro enrolado
en Scout, así que no hay dónde cargarle la excepción.
