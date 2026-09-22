// Handlers de la API, compartidos por el server local y las funciones de
// Vercel. Usan req/res de Node a secas, que es lo que ambos entornos dan.
import { getSnapshot } from "./jira.js";
import { computeMetrics } from "./metrics.js";
import { authMode, isAuthorized, checkPassword, sessionCookie } from "./auth.js";
import { SERVERLESS } from "./cache.js";

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  if (req.body) return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

export async function boardHandler(req, res) {
  const mode = authMode();
  if (mode === "misconfigured") {
    return json(res, 500, {
      error:
        "Falta DASHBOARD_PASSWORD. Este tablero publica los datos del sprint del equipo, " +
        "así que en un deploy público pide contraseña. Definí DASHBOARD_PASSWORD en las " +
        "variables de entorno del proyecto, o ALLOW_PUBLIC=1 si querés dejarlo abierto a cualquiera.",
      code: "misconfigured",
    });
  }
  if (!isAuthorized(req)) {
    return json(res, 401, { error: "Contraseña requerida", code: "auth" });
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const force = url.searchParams.get("refresh") === "1";
  try {
    const snapshot = await getSnapshot({ force });
    const metrics = computeMetrics(snapshot);
    metrics.meta.fromCache = snapshot.fromCache;
    // Datos privados: nunca en la CDN pública ni en el disco del navegador.
    json(res, 200, metrics, { "Cache-Control": "private, no-store" });
  } catch (err) {
    console.error("✗", err.message);
    json(res, 502, { error: err.message });
  }
}

export async function authHandler(req, res) {
  if (req.method !== "POST") {
    return json(res, 200, { mode: authMode(), authorized: isAuthorized(req) });
  }
  const { password } = await readBody(req);
  if (!checkPassword(password)) {
    // Un poco de freno para que probar contraseñas no sea gratis.
    await new Promise((r) => setTimeout(r, 600));
    return json(res, 401, { error: "Contraseña incorrecta" });
  }
  json(res, 200, { ok: true }, { "Set-Cookie": sessionCookie() });
}

export const runtimeInfo = { serverless: SERVERLESS };
