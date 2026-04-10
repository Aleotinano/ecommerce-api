import { z } from "zod";

export const updateRoleSchema = z.object({
  role: z.enum(["USER", "ADMIN"], {
    error: "El rol debe ser USER o ADMIN",
  }),
});
