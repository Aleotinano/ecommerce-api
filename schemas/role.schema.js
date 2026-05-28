import { z } from "zod";

export const updateRoleSchema = z.object({
  role: z.enum(["ADMIN", "STAFF", "CUSTOMER"], {
    error: "El rol debe ser ADMIN, STAFF o CUSTOMER",
  }),
});
