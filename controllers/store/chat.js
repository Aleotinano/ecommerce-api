import { ChatModel } from "../../services/chat/index.js";

export class ChatController {
  static async sendMessage(req, res, next) {
    try {
      const { message, history } = req.body;

      const data = await ChatModel.sendMessage({
        tenantId: req.tenantId,
        user: req.user ?? null,
        message,
        history,
      });

      return res.json(data);
    } catch (error) {
      next(error);
    }
  }
}
