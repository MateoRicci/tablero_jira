// Almacén del snapshot. En local es un archivo; en serverless (Vercel) el
// disco es de sólo lectura, así que queda en memoria del proceso: sobrevive
// mientras la función esté tibia y se vuelve a pedir cuando arranca en frío.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const FILE = path.join(process.cwd(), "data", "cache.json");
let memory = null;

export async function readCache() {
  if (SERVERLESS) return memory;
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    return null;
  }
}

export async function writeCache(snapshot) {
  memory = snapshot;
  if (SERVERLESS) return;
  try {
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(snapshot));
  } catch {
    // Un disco de sólo lectura no debe tumbar la respuesta: ya quedó en memoria.
  }
}
