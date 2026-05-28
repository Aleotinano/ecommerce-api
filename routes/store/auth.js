import { Router } from "express";
import { StoreAuthController } from "../../controllers/store/auth.js";
import { validate } from "../../middleware/validate.js";
import { customerRegisterSchema } from "../../schemas/store-auth.schema.js";
import {
  loginSchema,
  verifyEmailQuerySchema,
  resendVerificationSchema,
} from "../../schemas/auth.schema.js";
import { verifyStoreToken } from "../../middleware/auth.js";
import { loginLimiter, registerLimiter } from "../../middleware/rateLimit.js";

export const storeAuthRouter = Router();

storeAuthRouter.post(
  "/register",
  registerLimiter,
  validate({ body: customerRegisterSchema }),
  StoreAuthController.register
);

storeAuthRouter.post(
  "/login",
  loginLimiter,
  validate({ body: loginSchema }),
  StoreAuthController.login
);

storeAuthRouter.post("/logout", StoreAuthController.logout);

storeAuthRouter.get("/me", verifyStoreToken, StoreAuthController.me);

storeAuthRouter.get(
  "/verify-email",
  validate({ query: verifyEmailQuerySchema }),
  StoreAuthController.verifyEmail
);

storeAuthRouter.post(
  "/resend-verification",
  validate({ body: resendVerificationSchema }),
  StoreAuthController.resendVerification
);
