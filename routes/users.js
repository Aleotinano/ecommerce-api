import { Router } from "express";
import { usersController } from "../controllers/users.js";
import { validate } from "../middleware/validate.js";
import { registerSchema, loginSchema } from "../schemas/auth.schema.js";

export const usersRouter = Router();

const validation = {
  login: validate({ body: loginSchema }),
  register: validate({ body: registerSchema }),
};

usersRouter.post("/register", validation.register, usersController.register);
usersRouter.post("/login", validation.login, usersController.login);
usersRouter.post("/logout", usersController.logout);
