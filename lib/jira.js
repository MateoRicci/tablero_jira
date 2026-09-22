// Cliente REST de Jira Cloud. Sin dependencias: usa fetch nativo.
import { readCache, writeCache } from "./cache.js";

const SITE = (process.env.JIRA_SITE || "").replace(/\/$/, "");
const EMAIL = process.env.JIRA_EMAIL || "";
const TOKEN = process.env.JIRA_TOKEN || "";
const PROJECT = process.env.JIRA_PROJECT || "ING";

const AUTH = "Basic " + Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64");

// Campos custom del sitio axb-ing. Si movés el tablero a otro sitio,
// los IDs cambian: mirá /rest/api/3/field para reasignarlos.
export const CUSTOM = {
  storyPoints: "customfield_10016",
  sprint: "customfield_10020",
  developer: "customfield_10108",
  reviewer: "customfield_10109",
};

const FIELDS = [
  "summary", "status", "assignee", "reporter", "priority", "issuetype",
  "created", "updated", "resolutiondate", "labels", "parent", "duedate",
  "issuelinks",
  ...Object.values(CUSTOM),
].join(",");

function assertConfig() {
  const missing = ["JIRA_SITE", "JIRA_EMAIL", "JIRA_TOKEN"].filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `Faltan variables en .env: ${missing.join(", ")}. ` +
      `Arrancá con "npm start" para que Node cargue el archivo.`
    );
  }
}

async function api(pathname, params = {}) {
  assertConfig();
  const url = new URL(SITE + pathname);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { Authorization: AUTH, Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401) {
      throw new Error(`Jira rechazó las credenciales (401). Revisá JIRA_EMAIL y JIRA_TOKEN en .env.`);
    }
    throw new Error(`Jira ${res.status} en ${pathname}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchIssues() {
  const issues = [];
  let nextPageToken;
  do {
    const page = await api("/rest/api/3/search/jql", {
      jql: `project = ${PROJECT} ORDER BY created ASC`,
      fields: FIELDS,
      expand: "changelog",
      maxResults: 100,
      nextPageToken,
    });
    issues.push(...(page.issues || []));
    nextPageToken = page.nextPageToken;
    if (page.isLast) break;
  } while (nextPageToken);
  return issues;
}

async function fetchSprints() {
  const { values: boards = [] } = await api("/rest/agile/1.0/board", { projectKeyOrId: PROJECT });
  const sprints = [];
  for (const b of boards) {
    try {
      const { values = [] } = await api(`/rest/agile/1.0/board/${b.id}/sprint`, { maxResults: 50 });
      for (const s of values) sprints.push({ ...s, boardName: b.name });
    } catch {
      // Un tablero kanban no tiene sprints: no es un error que deba cortar el fetch.
    }
  }
  return sprints;
}

// name -> statusCategory, para poder decidir si un estado historico contaba
// como "hecho". El changelog guarda el nombre del estado, no su categoria.
async function fetchStatuses() {
  const byType = await api(`/rest/api/3/project/${PROJECT}/statuses`);
  const map = {};
  for (const t of byType) {
    for (const s of t.statuses || []) map[s.name] = s.statusCategory?.key || "new";
  }
  return map;
}

/** Trae el proyecto entero de Jira y lo deja cacheado. */
export async function fetchSnapshot() {
  const [issues, sprints, statuses] = await Promise.all([
    fetchIssues(), fetchSprints(), fetchStatuses(),
  ]);
  const snapshot = {
    fetchedAt: new Date().toISOString(),
    site: SITE,
    project: PROJECT,
    issues,
    sprints,
    statuses,
  };
  await writeCache(snapshot);
  return snapshot;
}

/** Devuelve el snapshot cacheado si es reciente; si no, va a Jira. */
export async function getSnapshot({ maxAgeMs = 45 * 1000, force = false } = {}) {
  if (!force) {
    const cached = await readCache();
    if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < maxAgeMs) {
      return { ...cached, fromCache: true };
    }
  }
  return { ...(await fetchSnapshot()), fromCache: false };
}

export const config = { SITE, PROJECT };
