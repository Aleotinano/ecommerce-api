import { UserModel } from "../services/users.js";
import { DEFAULTS } from "../config.js";
import jwt from "jsonwebtoken";

export class usersController {
  static async register(req, res) {
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
      console.error("Error en registro:", error);

      if (error.message === "USERNAME_EXISTS") {
        return res.status(409).json({
          message: "El usuario ya existe",
        });
      }

      return res.status(500).json({
        message: "Error al registrar usuario",
      });
    }
  }

  static async login(req, res) {
    try {
      const { username, password } = req.body;

      const user = await UserModel.login({
        username,
        password,
      });

      if (user === null) {
        return res.status(401).json({
          message: "El usuario no existe",
        });
      }

      if (user.isValid === false) {
        return res.status(404).json({
          message: "Contraseña incorrecta",
        });
      }

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
      console.error("Error en login:", error);

      return res.status(500).json({
        message: "Error al iniciar sesión",
      });
    }
  }

  static async logout(req, res) {
    return res.clearCookie("access_token").json({ message: "Sesión cerrada" });
  }
}
