// Servidor local. En Vercel no se usa: allá cada archivo de api/ es una
// función serverless. Ambos comparten lib/handlers.js, así que el
// comportamiento es el mismo en los dos lados.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { boardHandler, authHandler } from "./lib/handlers.js";
import { config } from "./lib/jira.js";
import { authMode } from "./lib/auth.js";

const PORT = Number(process.env.PORT || 4321);
const PUBLIC = path.join(import.meta.dirname, "public");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = path.join(PUBLIC, rel);
  // No dejar que "../" se escape de public/.
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Prohibido");
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("No encontrado");
  }
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  if (pathname === "/api/board") return boardHandler(req, res);
  if (pathname === "/api/auth") return authHandler(req, res);
  await serveStatic(res, pathname);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  ✗ El puerto ${PORT} ya está en uso.`);
    console.error(`    Probablemente haya otra instancia del tablero corriendo.\n`);
    console.error(`    Ver cuál es:   ss -ltnp | grep ${PORT}`);
    console.error(`    Cerrarla:      pkill -f "server.js"`);
    console.error(`    O usar otro:   PORT=4322 npm start\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`\n  Tablero FutBot`);
  console.log(`  ${config.SITE} · proyecto ${config.PROJECT}`);
  console.log(`  acceso: ${authMode() === "password" ? "con contraseña" : "abierto (local)"}`);
  console.log(`  → http://localhost:${PORT}\n`);
});
