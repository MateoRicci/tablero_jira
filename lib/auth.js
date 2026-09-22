// Portón opcional por contraseña.
//
// Subir esto a internet publica el sprint entero del equipo: tickets, nombres,
// estimaciones y quién va atrasado. Por eso en serverless falla cerrado: sin
// DASHBOARD_PASSWORD no sirve datos, salvo que se pida explícitamente que sea
// público con ALLOW_PUBLIC=1.
import { createHmac, timingSafeEqual } from "node:crypto";
import { SERVERLESS } from "./cache.js";

const PASSWORD = process.env.DASHBOARD_PASSWORD || "";
const ALLOW_PUBLIC = process.env.ALLOW_PUBLIC === "1";
const COOKIE = "tablero_sesion";
const MAX_AGE = 30 * 24 * 3600; // 30 días

/** "open" | "password" | "misconfigured" */
export function authMode() {
  if (PASSWORD) return "password";
  if (!SERVERLESS || ALLOW_PUBLIC) return "open";
  return "misconfigured";
}

const sign = (exp) => createHmac("sha256", PASSWORD).update(`v1.${exp}`).digest("hex");

const equal = (a, b) => {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function isAuthorized(req) {
  const mode = authMode();
  if (mode === "open") return true;
  if (mode === "misconfigured") return false;
  const raw = cookies(req)[COOKIE];
  if (!raw) return false;
  const [exp, sig] = raw.split(".");
  if (!exp || !sig) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return equal(sig, sign(exp));
}

export function checkPassword(candidate) {
  return Boolean(PASSWORD) && equal(String(candidate || ""), PASSWORD);
}

export function sessionCookie() {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const value = `${exp}.${sign(exp)}`;
  const flags = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${MAX_AGE}`];
  if (SERVERLESS) flags.push("Secure"); // en Vercel siempre hay HTTPS
  return `${COOKIE}=${value}; ${flags.join("; ")}`;
}
