import { Router } from "express";
import { mercadopagoController } from "../controllers/mercadopago.js";
import { verifyToken } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { validateId } from "../schemas/id.schema.js";

export const mercadopagoRouter = Router();

const validation = {
  id: validate({ params: validateId }),
};

// mercadopagoRouter.get("/success", (req, res) => {
//   console.log("✅ Payment Success Callback:", req.query);
//   res.send(`
//     <html>
//       <body style="font-family: Arial; text-align: center; padding: 50px;">
//         <h1>✅ Pago Exitoso</h1>
//         <p>Payment ID: ${req.query.payment_id}</p>
//         <p>Status: ${req.query.status}</p>
//         <p>External Reference: ${req.query.external_reference}</p>
//         <p>Preference ID: ${req.query.preference_id}</p>
//         <br>
//         <a href="/">Volver al inicio</a>
//       </body>
//     </html>
//   `);
// });

// mercadopagoRouter.get("/failure", (req, res) => {
//   console.log("❌ Payment Failure Callback:", req.query);
//   res.send(`
//     <html>
//       <body style="font-family: Arial; text-align: center; padding: 50px;">
//         <h1>❌ Pago Fallido</h1>
//         <p>External Reference: ${req.query.external_reference}</p>
//         <br>
//         <a href="/">Volver al inicio</a>
//       </body>
//     </html>
//   `);
// });

// mercadopagoRouter.get("/pending", (req, res) => {
//   console.log("⏳ Payment Pending Callback:", req.query);
//   res.send(`
//     <html>
//       <body style="font-family: Arial; text-align: center; padding: 50px;">
//         <h1>⏳ Pago Pendiente</h1>
//         <p>External Reference: ${req.query.external_reference}</p>
//         <br>
//         <a href="/">Volver al inicio</a>
//       </body>
//     </html>
//   `);
// });

mercadopagoRouter.post("/webhook", mercadopagoController.getWebhook);

mercadopagoRouter.post(
  "/:id",
  verifyToken,
  validation.id,
  mercadopagoController.create
);
