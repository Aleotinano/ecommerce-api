import { Router } from "express";
import { usersController } from "../controllers/users.js";
import { validate } from "../middleware/validate.js";
import {
  registerSchema,
  loginSchema,
  verifyEmailQuerySchema,
  resendVerificationSchema,
} from "../schemas/auth.schema.js";
import { verifyToken } from "../middleware/auth.js";
import { loginLimiter, registerLimiter } from "../middleware/rateLimit.js";

export const usersRouter = Router();

const validation = {
  login: validate({ body: loginSchema }),
  register: validate({ body: registerSchema }),
  verifyEmail: validate({ query: verifyEmailQuerySchema }),
  resendVerification: validate({ body: resendVerificationSchema }),
};

usersRouter.post("/register", registerLimiter, validation.register, usersController.register);
usersRouter.post("/login", loginLimiter, validation.login, usersController.login);
usersRouter.post("/logout", usersController.logout);
usersRouter.get("/me", verifyToken, usersController.me);

usersRouter.get(
  "/verify-email",
  validation.verifyEmail,
  usersController.verifyEmail
);
usersRouter.post(
  "/resend-verification",
  validation.resendVerification,
  usersController.resendVerification
);
