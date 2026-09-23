// Cuánto debería tardar un ticket desde que alguien lo agarra, según su
// complejidad.
//
// La idea: los story points ya son una estimación de esfuerzo, así que sirven
// de presupuesto. Si un ticket lleva trabajándose más de lo que su tamaño
// justifica, algo pasa — se trabó, se subestimó, o nadie lo está mirando.
//
// REGLA CENTRAL: el reloj arranca cuando el ticket entra a In Progress. En
// To Do no corre nada — un ticket que nadie agarró no puede estar vencido,
// por más que lleve semanas en la cola.

/** Presupuesto base por story points, en HORAS HÁBILES. */
export const BUDGET_HOURS = {
  1: 2,    // un par de horas
  2: 4,    // medio día
  3: 8,    // un día
  5: 16,   // un par de días
  8: 40,   // una semana
};

/**
 * Qué fracción del presupuesto le toca a cada estado.
 *
 * To Do NO está acá a propósito: sin reloj no hay presupuesto que consumir.
 * El reloj arranca en In Progress (ver workStartedAt) y desde ahí NO se
 * reinicia — In Review sigue contando el mismo reloj, por eso su presupuesto
 * es el de construir más medio presupuesto para revisar.
 *
 * Este es EL número a tocar si el semáforo avisa de más o de menos.
 */
export const STATE_FACTOR = {
  "In Progress": 1,
  "In Review": 1.5,
};

/** Jornada hábil. 12 h por día, todos los días (equipo de cursada). */
export const WORKDAY = { from: 9, to: 21 };

/** Orden canónico del flujo. Lo que no esté acá se ordena por categoría. */
export const STATUS_ORDER = ["To Do", "In Progress", "In Review", "Done"];

/** Umbrales sobre el consumo del presupuesto. */
export const THRESHOLDS = { warn: 0.8, late: 1 };

const HOUR = 3600000;

/** Horas hábiles entre dos instantes, respetando la ventana de WORKDAY. */
export function workingHours(from, to) {
  if (!from || !to || to <= from) return 0;
  let total = 0;
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  // Tope de seguridad: un ticket muy viejo no debe colgar el cálculo.
  for (let guard = 0; guard < 1000 && cursor.getTime() <= to; guard++) {
    const dayStart = new Date(cursor).setHours(WORKDAY.from, 0, 0, 0);
    const dayEnd = new Date(cursor).setHours(WORKDAY.to, 0, 0, 0);
    const start = Math.max(from, dayStart);
    const end = Math.min(to, dayEnd);
    if (end > start) total += (end - start) / HOUR;
    cursor.setDate(cursor.getDate() + 1);
  }
  return total;
}

/** Presupuesto en horas para unos puntos dados, interpolando si hace falta. */
export function budgetForPoints(points) {
  if (!points) return null; // sin estimar: no hay presupuesto que medir
  const scale = Object.keys(BUDGET_HOURS).map(Number).sort((a, b) => a - b);
  if (BUDGET_HOURS[points]) return BUDGET_HOURS[points];
  if (points < scale[0]) return BUDGET_HOURS[scale[0]];
  const last = scale[scale.length - 1];
  if (points > last) return BUDGET_HOURS[last] * (points / last);
  for (let i = 0; i < scale.length - 1; i++) {
    const [a, b] = [scale[i], scale[i + 1]];
    if (points > a && points < b) {
      const t = (points - a) / (b - a);
      return BUDGET_HOURS[a] + t * (BUDGET_HOURS[b] - BUDGET_HOURS[a]);
    }
  }
  return BUDGET_HOURS[last];
}

export function budgetFor(points, status) {
  const base = budgetForPoints(points);
  const factor = STATE_FACTOR[status];
  if (base == null || factor == null) return null;
  return base * factor;
}

/** Historial de estados de un issue, del más viejo al más nuevo. */
export function statusHistory(issue) {
  const out = [];
  for (const h of issue.changelog?.histories || []) {
    for (const item of h.items || []) {
      if (item.field === "status") {
        out.push({ at: new Date(h.created).getTime(), from: item.fromString, to: item.toString });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Desde cuándo el ticket está en el estado en el que está hoy. */
export function enteredCurrentStatus(issue) {
  const current = issue.fields.status?.name;
  const history = statusHistory(issue);
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].to === current) return history[i].at;
  }
  // Nunca se movió: cuenta desde que se creó.
  return new Date(issue.fields.created).getTime();
}

/**
 * Cuándo arrancó el trabajo: la primera vez que el ticket entró en un estado
 * en curso. Es el único origen válido del reloj — antes de eso está en la
 * cola, y esperar en la cola no consume presupuesto. null si nunca arrancó.
 *
 * @param isActive  (nombre de estado) => bool, según la categoría de Jira.
 */
export function workStartedAt(issue, isActive) {
  for (const h of statusHistory(issue)) {
    if (isActive(h.to)) return h.at;
  }
  // Changelog vacío o incompleto pero el ticket ya está en curso: contamos
  // desde que se creó, que es lo más viejo que podemos afirmar.
  return isActive(issue.fields.status?.name) ? new Date(issue.fields.created).getTime() : null;
}

/** Cuándo terminó de estar bloqueado (o null si todavía lo está). */
export function readySince(issue, { blockers, doneAt, sprintStart, enteredAt }) {
  let ready = Math.max(enteredAt, sprintStart || 0);
  for (const b of blockers) {
    const done = doneAt.get(b);
    if (!done) return null; // sigue bloqueado: no le corre el reloj
    ready = Math.max(ready, done);
  }
  return ready;
}

export function severityOf(ratio) {
  if (ratio == null) return "none";
  if (ratio > THRESHOLDS.late) return "late";
  if (ratio >= THRESHOLDS.warn) return "warn";
  return "ok";
}

/** Formatea horas hábiles como "3 h" / "1 d 4 h". */
export function formatHours(h) {
  if (h == null) return "—";
  const perDay = WORKDAY.to - WORKDAY.from;
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < perDay) return `${Math.round(h * 10) / 10} h`;
  const days = Math.floor(h / perDay);
  const rest = Math.round(h - days * perDay);
  return rest ? `${days} d ${rest} h` : `${days} d`;
}

/** Ordena los estados del flujo: primero el orden canónico, después el resto. */
export function orderStatuses(statusMap) {
  const rank = { new: 0, indeterminate: 1, done: 2 };
  const known = STATUS_ORDER.filter((s) => s in statusMap);
  const rest = Object.keys(statusMap)
    .filter((s) => !STATUS_ORDER.includes(s))
    .sort((a, b) => (rank[statusMap[a]] ?? 1) - (rank[statusMap[b]] ?? 1));
  return [...known, ...rest];
}
