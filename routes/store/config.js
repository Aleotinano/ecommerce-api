import { Router } from "express";
import { StoreConfigController } from "../../controllers/store/config.js";

export const storeConfigRouter = Router();

storeConfigRouter.get("/", StoreConfigController.get);
