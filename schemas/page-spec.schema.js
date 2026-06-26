import { z } from "zod";

/**
 * Body de PUT /page-spec/draft. El spec es JSON acotado (theme + blocks); la
 * validación profunda (whitelist de componentes, clamp de enums) la hace la frontera
 * TS `normalizePageSpec` en el admin/storefront, no acá. Este schema solo garantiza
 * la forma macro y pone un techo de tamaño para no aceptar payloads absurdos.
 */
const blockObject = z.record(z.string(), z.unknown());

export const pageSpecDraftBody = z.object({
  spec: z
    .object({
      theme: z.record(z.string(), z.unknown()).optional(),
      blocks: z.array(blockObject).max(50).optional(),
    })
    .passthrough(),
});
