import { z } from "zod";

/**
 * Validacion del body de POST /store/chat/message. El history viene del cliente
 * (input no confiable): lo acotamos en cantidad de mensajes y largo, y exigimos
 * roles validos. El loop agentico ademas lo sanea (defensa en profundidad).
 */

export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_HISTORY_MESSAGES = 20;
export const MAX_HISTORY_CONTENT_LENGTH = 2000;

const historyMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(MAX_HISTORY_CONTENT_LENGTH),
});

export const chatMessageBody = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  history: z.array(historyMessage).max(MAX_HISTORY_MESSAGES).default([]),
});
