import { UserModel } from "../services/users.js";
import { DEFAULTS } from "../config.js";
import jwt from "jsonwebtoken";

export class usersController {
  static async register(req, res, next) {
    try {
      const { username, password, email, role } = req.body;
      const user = await UserModel.register({
        username,
        password,
        email,
        role,
      });

      const dataPublic = {
        id: user.id,
        username: user.username,
        role: user.role,
      };

      return res.status(201).json({
        message: "Usuario registrado exitosamente",
        usuario: dataPublic,
      });
    } catch (error) {
      next(error);
    }
  }

  static async login(req, res, next) {
    try {
      const { username, password } = req.body;

      const user = await UserModel.login({
        username,
        password,
      });

      const dataPublic = {
        username: user.username,
        role: user.role,
      };
      const tokenData = {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email,
      };

      const token = jwt.sign(tokenData, DEFAULTS.SECRET_JWT_KEY, {
        expiresIn: "1h",
      });

      return res
        .cookie("access_token", token, {
          httpOnly: true,
          secure: DEFAULTS.NODE_ENV === "production", // Solo se puede acceder en https,
          sameSite: "strict",
          maxAge: 1000 * 60 * 60,
        })
        .json({
          message: `Bienvenido ${dataPublic.username}`,
          usuario: dataPublic,
        });
    } catch (error) {
      next(error);
    }
  }

  static async logout(req, res) {
    return res.clearCookie("access_token").json({ message: "SesiÃ³n cerrada" });
  }
}
