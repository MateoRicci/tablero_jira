// Función serverless de Vercel: GET /api/board
import { boardHandler } from "../lib/handlers.js";

export default function handler(req, res) {
  return boardHandler(req, res);
}
