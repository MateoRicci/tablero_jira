// Función serverless de Vercel: GET/POST /api/auth
import { authHandler } from "../lib/handlers.js";

export default function handler(req, res) {
  return authHandler(req, res);
}
