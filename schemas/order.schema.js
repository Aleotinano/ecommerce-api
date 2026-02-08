import { z } from "zod";

export const orderStatus = z.object({
  status: z.enum(["PENDING", "COMPLETED", "CANCELLED"], {
    errorMap: () => ({
      message: "El status debe ser PENDING, COMPLETED o CANCELLED",
    }),
  }),
});
