// Convierte el snapshot crudo de Jira en las metricas que dibuja el tablero.
import { CUSTOM } from "./jira.js";
import {
  workingHours, budgetFor, budgetForPoints, enteredCurrentStatus, readySince,
  severityOf, orderStatuses, STATE_FACTOR, BUDGET_HOURS, THRESHOLDS, WORKDAY,
} from "./sla.js";

const DAY = 86400000;
const UNASSIGNED = "Sin asignar";

const cf = (issue, key) => issue.fields?.[CUSTOM[key]] ?? null;
const isEpic = (i) => i.fields.issuetype?.name === "Epic";
const points = (i) => cf(i, "storyPoints") || 0;
const person = (u) => (u ? { id: u.accountId, name: u.displayName } : { id: "_none", name: UNASSIGNED });
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

/** Categoria de un estado ("new" | "indeterminate" | "done"). */
function categoryOf(statusName, statuses) {
  return statuses?.[statusName] || "new";
}

const BUCKET = { new: "todo", indeterminate: "doing", done: "done" };

/**
 * Reconstruye el NOMBRE del estado de un issue en un instante dado,
 * rebobinando el changelog desde el estado actual hacia atras.
 */
function statusNameAt(issue, when) {
  let status = issue.fields.status?.name;
  const changes = [];
  for (const h of issue.changelog?.histories || []) {
    for (const item of h.items || []) {
      if (item.field === "status") changes.push({ at: new Date(h.created).getTime(), from: item.fromString });
    }
  }
  changes.sort((a, b) => b.at - a.at); // del mas nuevo al mas viejo
  for (const c of changes) {
    if (c.at > when) status = c.from;
  }
  return status;
}

function statusAt(issue, when, statuses) {
  return BUCKET[categoryOf(statusNameAt(issue, when), statuses)] || "todo";
}

/** Cuando el issue entro por primera vez en un estado de categoria "done". */
function doneAtOf(issue, statuses) {
  for (const h of issue.changelog?.histories || []) {
    for (const item of h.items || []) {
      if (item.field === "status" && categoryOf(item.toString, statuses) === "done") {
        return new Date(h.created).getTime();
      }
    }
  }
  const res = issue.fields.resolutiondate;
  if (res) return new Date(res).getTime();
  return categoryOf(issue.fields.status?.name, statuses) === "done"
    ? new Date(issue.fields.updated).getTime()
    : null;
}

/** Grafo de dependencias a partir de los links "Blocks". */
function buildGraph(issues) {
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const edges = new Set();
  for (const i of issues) {
    for (const link of i.fields.issuelinks || []) {
      if (link.type?.name !== "Blocks") continue;
      if (link.outwardIssue) edges.add(`${i.key}>${link.outwardIssue.key}`); // i bloquea a X
      if (link.inwardIssue) edges.add(`${link.inwardIssue.key}>${i.key}`); // X bloquea a i
    }
  }
  const succ = new Map(), pred = new Map();
  const touch = (m, k) => (m.has(k) ? m.get(k) : (m.set(k, new Set()), m.get(k)));
  for (const key of byKey.keys()) { touch(succ, key); touch(pred, key); }
  for (const e of edges) {
    const [a, b] = e.split(">");
    if (!byKey.has(a) || !byKey.has(b)) continue;
    touch(succ, a).add(b);
    touch(pred, b).add(a);
  }

  // Orden topologico (Kahn). Si hubiera un ciclo, quedan nodos afuera.
  const indeg = new Map([...byKey.keys()].map((k) => [k, pred.get(k).size]));
  const queue = [...indeg].filter(([, d]) => d === 0).map(([k]) => k);
  const order = [];
  while (queue.length) {
    const n = queue.shift();
    order.push(n);
    for (const m of succ.get(n)) {
      indeg.set(m, indeg.get(m) - 1);
      if (indeg.get(m) === 0) queue.push(m);
    }
  }
  const acyclic = order.length === byKey.size;

  // Nivel = camino mas largo desde una raiz. Es el "turno" de cada ticket.
  const level = new Map([...byKey.keys()].map((k) => [k, 0]));
  for (const n of order) {
    for (const m of succ.get(n)) level.set(m, Math.max(level.get(m), level.get(n) + 1));
  }

  // Alcance transitivo: todo lo que se destraba cuando este ticket cierra.
  const reach = new Map();
  for (const n of [...order].reverse()) {
    const s = new Set();
    for (const m of succ.get(n)) {
      s.add(m);
      for (const x of reach.get(m) || []) s.add(x);
    }
    reach.set(n, s);
  }
  return { byKey, succ, pred, order, level, reach, acyclic, edgeCount: edges.size };
}

/** La cadena mas larga del grafo: marca el piso de duracion del sprint. */
function longestChain(g) {
  const best = new Map(); // key -> { len, next }
  for (const n of [...g.order].reverse()) {
    let pick = null;
    for (const m of g.succ.get(n)) {
      const cand = best.get(m);
      if (!pick || cand.len > pick.len) pick = { len: cand.len, key: m };
    }
    best.set(n, { len: (pick?.len || 0) + 1, next: pick?.key || null });
  }
  let start = null;
  for (const [k, v] of best) if (!start || v.len > best.get(start).len) start = k;
  const chain = [];
  for (let k = start; k; k = best.get(k).next) chain.push(k);
  return chain;
}

export function computeMetrics(snapshot) {
  const { issues, sprints, statuses = {}, fetchedAt, site, project } = snapshot;
  const now = Date.now();
  const stories = issues.filter((i) => !isEpic(i));
  const epicIssues = issues.filter(isEpic);

  // --- Sprint activo (o el ultimo que haya) ---
  const sprint =
    sprints.find((s) => s.state === "active") ||
    [...sprints].sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0))[0] ||
    null;
  const sprintStart = sprint?.startDate ? new Date(sprint.startDate).getTime() : null;
  const sprintEnd = sprint?.endDate ? new Date(sprint.endDate).getTime() : null;
  const totalDays = sprintStart && sprintEnd ? Math.max(1, Math.round((sprintEnd - sprintStart) / DAY)) : null;
  const dayNow = sprintStart ? Math.floor((now - sprintStart) / DAY) + 1 : null;
  const daysLeft = sprintEnd ? Math.max(0, Math.ceil((sprintEnd - now) / DAY)) : null;

  const inSprint = (i) => (cf(i, "sprint") || []).some((s) => s.id === sprint?.id);
  const sprintIssues = sprint ? stories.filter(inSprint) : stories;

  // --- Totales por estado ---
  const bucketOf = (i) => BUCKET[categoryOf(i.fields.status?.name, statuses)] || "todo";
  const tally = (list) => {
    const t = { todo: 0, doing: 0, done: 0 };
    const p = { todo: 0, doing: 0, done: 0 };
    for (const i of list) { t[bucketOf(i)]++; p[bucketOf(i)] += points(i); }
    return { tickets: t, points: p };
  };
  const totals = {
    ...tally(sprintIssues),
    issues: issues.length,
    stories: stories.length,
    epics: epicIssues.length,
    committedPoints: sprintIssues.reduce((s, i) => s + points(i), 0),
    sprintTickets: sprintIssues.length,
  };

  // --- Personas: carga, reparto y rol de reviewer ---
  const flowOrder = orderStatuses(statuses);
  const blank = () => Object.fromEntries(flowOrder.map((n) => [n, 0]));

  const people = new Map();
  const seat = (u) => {
    const { id, name } = person(u);
    if (!people.has(id)) {
      people.set(id, {
        id, name,
        tickets: blank(),
        points: blank(),
        total: 0, totalPoints: 0, reviewing: 0, reported: 0, startable: 0,
        late: 0, warn: 0,
      });
    }
    return people.get(id);
  };
  for (const i of sprintIssues) {
    const p = seat(i.fields.assignee);
    const name = i.fields.status?.name;
    if (name in p.tickets) { p.tickets[name]++; p.points[name] += points(i); }
    p.total++; p.totalPoints += points(i);
    for (const r of cf(i, "reviewer") || []) seat(r).reviewing++;
  }
  for (const i of issues) if (i.fields.reporter) seat(i.fields.reporter).reported++;

  // --- Matriz desarrollador x reviewer ---
  const pairs = new Map();
  for (const i of sprintIssues) {
    const dev = (cf(i, "developer") || [])[0] || i.fields.assignee;
    for (const rev of cf(i, "reviewer") || []) {
      if (!dev) continue;
      const k = `${dev.displayName}|${rev.displayName}`;
      pairs.set(k, (pairs.get(k) || 0) + 1);
    }
  }
  const devReviewer = [...pairs].map(([k, count]) => {
    const [dev, reviewer] = k.split("|");
    return { dev, reviewer, count };
  });

  // --- Epicas ---
  const childrenOf = new Map();
  for (const i of stories) {
    const key = i.fields.parent?.key;
    if (!key) continue;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key).push(i);
  }
  const epics = epicIssues
    .map((e) => {
      const kids = childrenOf.get(e.key) || [];
      const t = tally(kids);
      const total = kids.reduce((s, i) => s + points(i), 0);
      return {
        key: e.key,
        name: e.fields.summary,
        tickets: kids.length,
        points: total,
        done: t.points.done,
        doing: t.points.doing,
        todo: t.points.todo,
        pct: total ? Math.round((t.points.done / total) * 100) : 0,
      };
    })
    .filter((e) => e.tickets > 0)
    .sort((a, b) => b.points - a.points);

  // --- Dependencias ---
  const g = buildGraph(issues);
  const blockers = [...g.byKey.keys()]
    .filter((k) => !isEpic(g.byKey.get(k)))
    .map((k) => {
      const downstream = [...g.reach.get(k)].filter((x) => !isEpic(g.byKey.get(x)));
      const issue = g.byKey.get(k);
      return {
        key: k,
        summary: issue.fields.summary,
        assignee: person(issue.fields.assignee).name,
        status: bucketOf(issue),
        points: points(issue),
        unlocks: downstream.length,
        unlocksPoints: downstream.reduce((s, x) => s + points(g.byKey.get(x)), 0),
        level: g.level.get(k),
      };
    })
    .sort((a, b) => b.unlocksPoints - a.unlocksPoints);

  // "Se puede arrancar" no es "no tiene dependencias", sino "no le queda
  // ninguna sin cerrar". Si no, la lista se congela en las raices originales
  // y nunca crece a medida que el sprint avanza.
  const realPreds = (key) => [...(g.pred.get(key) || [])].filter((k) => !isEpic(g.byKey.get(k)));
  const isDoneKey = (key) => bucketOf(g.byKey.get(key)) === "done";
  const isFree = (key) => realPreds(key).every(isDoneKey);

  const startable = blockers
    .filter((b) => b.status !== "done" && isFree(b.key))
    .sort((a, b) => b.unlocksPoints - a.unlocksPoints);
  for (const s of startable) {
    const p = [...people.values()].find((x) => x.name === s.assignee);
    if (p) p.startable++;
  }

  // ── Cuánto lleva cada ticket en su estado, contra su presupuesto ──
  const doneAt = new Map(issues.map((i) => [i.key, doneAtOf(i, statuses)]));
  const aging = new Map();
  for (const i of sprintIssues) {
    const status = i.fields.status?.name;
    const cat = categoryOf(status, statuses);
    const enteredAt = enteredCurrentStatus(i);
    const blockers = [...(g.pred.get(i.key) || [])].filter((k) => !isEpic(g.byKey.get(k)));
    const pts = points(i);

    // El reloj de To Do no arranca al crear el ticket, sino cuando queda
    // libre: si todavía lo bloquea otro, la demora no es del equipo.
    let since = enteredAt;
    let blocked = false;
    if (cat === "new") {
      const ready = readySince(i, { blockers, doneAt, sprintStart, enteredAt });
      if (ready === null) blocked = true;
      else since = ready;
    }

    const budget = cat === "done" ? null : budgetFor(pts, status);
    const elapsed = blocked || cat === "done" ? null : workingHours(since, now);
    const ratio = budget && elapsed !== null ? elapsed / budget : null;

    // Para los cerrados: cuánto tardaron de punta a punta.
    const finished = doneAt.get(i.key);
    const cycle = cat === "done" && finished
      ? workingHours(Math.max(new Date(i.fields.created).getTime(), sprintStart || 0), finished)
      : null;

    aging.set(i.key, {
      status, category: cat, since, enteredAt, blocked,
      elapsed, budget, ratio,
      severity: blocked ? "blocked" : cat === "done" ? "done" : severityOf(ratio),
      cycle, cycleBudget: cat === "done" ? budgetForPoints(pts) : null,
      overBy: ratio && ratio > 1 ? elapsed - budget : null,
    });
  }

  for (const [key, a] of aging) {
    if (a.severity !== "late" && a.severity !== "warn") continue;
    const owner = [...people.values()].find((p) => p.name === person(g.byKey.get(key).fields.assignee).name);
    if (owner) owner[a.severity]++;
  }

  const alerts = sprintIssues
    .filter((i) => ["late", "warn"].includes(aging.get(i.key).severity))
    .map((i) => {
      const a = aging.get(i.key);
      return {
        key: i.key, summary: i.fields.summary,
        assignee: person(i.fields.assignee).name,
        points: points(i), status: a.status,
        elapsed: a.elapsed, budget: a.budget, ratio: a.ratio,
        severity: a.severity, overBy: a.overBy,
      };
    })
    .sort((x, y) => y.ratio - x.ratio);

  const byStatus = flowOrder.map((name) => {
    const list = sprintIssues.filter((i) => i.fields.status?.name === name);
    const ages = list.map((i) => aging.get(i.key).elapsed).filter((v) => v !== null).sort((a, b) => a - b);
    return {
      name,
      category: categoryOf(name, statuses),
      tickets: list.length,
      points: list.reduce((acc, i) => acc + points(i), 0),
      blocked: list.filter((i) => aging.get(i.key).blocked).length,
      late: list.filter((i) => aging.get(i.key).severity === "late").length,
      warn: list.filter((i) => aging.get(i.key).severity === "warn").length,
      medianAge: ages.length ? ages[Math.floor(ages.length / 2)] : null,
      maxAge: ages.length ? ages[ages.length - 1] : null,
      factor: STATE_FACTOR[name] ?? null,
    };
  });

  const levelHistogram = [];
  for (const [key, lvl] of g.level) {
    if (isEpic(g.byKey.get(key))) continue;
    levelHistogram[lvl] = levelHistogram[lvl] || { level: lvl, tickets: 0, points: 0 };
    levelHistogram[lvl].tickets++;
    levelHistogram[lvl].points += points(g.byKey.get(key));
  }
  const chainKeys = longestChain(g).filter((k) => !isEpic(g.byKey.get(k)));
  const chain = chainKeys.map((k) => ({
    key: k,
    summary: g.byKey.get(k).fields.summary,
    points: points(g.byKey.get(k)),
    assignee: person(g.byKey.get(k).fields.assignee).name,
  }));

  // --- Burndown: ideal contra real ---
  const burndown = [];
  if (sprintStart && sprintEnd) {
    const committed = totals.committedPoints;
    for (let d = 0; d <= totalDays; d++) {
      const t = sprintStart + d * DAY;
      const endOfDay = Math.min(t + DAY - 1, sprintEnd);
      const row = {
        date: dayKey(t),
        day: d,
        ideal: Math.round((committed * (1 - d / totalDays)) * 10) / 10,
        actual: null,
      };
      if (t <= now) {
        row.actual = sprintIssues
          .filter((i) => statusAt(i, endOfDay, statuses) !== "done")
          .reduce((s, i) => s + points(i), 0);
      }
      burndown.push(row);
    }
  }

  // --- Flujo acumulado ---
  const flow = [];
  if (sprintStart) {
    for (let t = sprintStart; t <= now; t += DAY) {
      const endOfDay = t + DAY - 1;
      const row = { date: dayKey(t), ...blank() };
      for (const i of sprintIssues) {
        const name = statusNameAt(i, endOfDay);
        if (name in row) row[name]++;
      }
      flow.push(row);
    }
  }

  // --- Salud del backlog ---
  const health = {
    unassigned: stories.filter((i) => !i.fields.assignee).length,
    unestimated: stories.filter((i) => !points(i)).length,
    notInSprint: sprint ? stories.filter((i) => !inSprint(i)).length : 0,
    epicless: stories.filter((i) => !i.fields.parent).length,
    blocked: [...g.byKey.keys()].filter(
      (k) => !isEpic(g.byKey.get(k)) && !isDoneKey(k) && !isFree(k)
    ).length,
    startable: startable.length,
  };

  const table = sprintIssues.map((i) => ({
    key: i.key,
    summary: i.fields.summary,
    type: i.fields.issuetype?.name,
    status: i.fields.status?.name,
    bucket: bucketOf(i),
    assignee: person(i.fields.assignee).name,
    reviewer: (cf(i, "reviewer") || []).map((r) => r.displayName).join(", "),
    points: points(i),
    priority: i.fields.priority?.name,
    labels: i.fields.labels || [],
    epic: i.fields.parent?.fields?.summary || null,
    level: g.level.get(i.key) ?? 0,
    blockedBy: [...g.pred.get(i.key)],
    unlocks: g.reach.get(i.key)?.size || 0,
    age: aging.get(i.key)?.elapsed ?? null,
    budget: aging.get(i.key)?.budget ?? null,
    ratio: aging.get(i.key)?.ratio ?? null,
    severity: aging.get(i.key)?.severity ?? "none",
    since: aging.get(i.key)?.since ?? null,
  }));

  return {
    meta: {
      project, site, fetchedAt,
      sprint: sprint && {
        name: sprint.name, goal: sprint.goal || null, state: sprint.state,
        start: sprint.startDate, end: sprint.endDate,
        day: dayNow, totalDays, daysLeft,
      },
      graph: { edges: g.edgeCount, acyclic: g.acyclic, depth: Math.max(0, ...levelHistogram.map((l) => l?.level ?? 0)) },
    },
    totals,
    flowOrder,
    byStatus,
    alerts,
    sla: { budgets: BUDGET_HOURS, factors: STATE_FACTOR, workday: WORKDAY, thresholds: THRESHOLDS },
    people: [...people.values()].filter((p) => p.total > 0 || p.reviewing > 0).sort((a, b) => b.totalPoints - a.totalPoints),
    devReviewer,
    epics,
    blockers: blockers.filter((b) => b.unlocks > 0).slice(0, 12),
    startable: startable.slice(0, 12),
    levels: levelHistogram.filter(Boolean),
    chain,
    burndown,
    flow,
    health,
    table,
  };
}
