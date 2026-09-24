import { svg, el, text, capsule, scale, niceTicks, bindTip, legend, cssVar, readableOn, GAP, BAR_MAX } from "./charts.js";
import { dependencyTree } from "./tree.js";
import { kanbanBoard } from "./board.js";
import { dur, setHoursPerDay, momento } from "./fmt.js";

const app = document.getElementById("app");
const clock = document.getElementById("clock");
const refreshBtn = document.getElementById("refresh");
const liveBtn = document.getElementById("live");

// Estado de la vista que tiene que sobrevivir a los refrescos automáticos.
// La persona elegida es compartida: filtrar en el árbol filtra el kanban.
const treeState = { person: null, onlyAvailable: false, focus: null, pinned: false, scrollLeft: 0 };
let lastMetrics = null;

/** Redibuja con los datos que ya están, sin ir al servidor. */
function rerender() {
  if (!lastMetrics) return;
  const y = window.scrollY;
  render(lastMetrics);
  window.scrollTo({ top: y, behavior: "instant" });
}

const MOVIL_BP = 760;
export const esMovil = () => window.innerWidth <= MOVIL_BP;

/**
 * Ancho al que construir un gráfico. Los SVG se escalaban a 100% desde un
 * viewBox fijo de ~620px: en un celular eso encoge el texto de 11px a 6px.
 * Construirlos al ancho real del contenedor evita el escalado.
 */
function chartW(max, span = 12) {
  const ancho = window.innerWidth || 1440;
  if (esMovil() || ancho <= 1020) {
    // Una tarjeta por fila: el gráfico ocupa el ancho de pantalla menos padding.
    return Math.max(250, Math.min(max, ancho - 32 - 28));
  }
  // Escritorio: la tarjeta ocupa `span` de 12 columnas con 16px de separación.
  const contenido = Math.min(1320, ancho - 48);
  const columna = (contenido - 11 * 16) / 12;
  const tarjeta = columna * span + 16 * (span - 1);
  return Math.max(250, Math.min(max, Math.round(tarjeta - 40)));
}

/** En pantallas chicas, nombre de pila: "Lautaro Gastón Peralta" no entra. */
const nombreCorto = (n) => (esMovil() ? first(n) : n);

const fmt = (n, d = 0) => Number(n).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const first = (name) => (name || "").split(/[\s.]/)[0];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Los estados salen del flujo real del proyecto, no de una lista fija.
// La rampa es ordinal: el color avanza con el progreso del ticket.
const RAMP = ["--o1", "--o2", "--o3", "--o4"];
let FLOW = [];   // [{ name, varName }] en orden de flujo
const flowColor = (name) => FLOW.find((f) => f.name === name)?.varName || "--o1";

function setFlow(order) {
  FLOW = order.map((name, i) => ({ name, varName: RAMP[Math.min(i, RAMP.length - 1)] }));
}

const SEV = {
  late: { label: "vencido", varName: "--critical", cls: "pill--crit" },
  warn: { label: "por vencer", varName: "--warn", cls: "pill--warn" },
  ok: { label: "en hora", varName: "--good", cls: "pill--good" },
  blocked: { label: "bloqueado", varName: "--muted", cls: "" },
  done: { label: "cerrado", varName: "--o4", cls: "" },
  none: { label: "sin arrancar", varName: "--muted", cls: "" },
};

// ── Helpers de DOM ────────────────────────────────────────────────────────
function h(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const k of [].concat(kids)) {
    if (k === null || k === undefined || k === false) continue;
    n.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
  }
  return n;
}

const card = (title, note, body, cls = "col-6", extraHead = null) =>
  h("section", { class: `card ${cls}` }, [
    h("div", { class: "card__head" }, [h("h3", {}, title), extraHead]),
    note ? h("p", { class: "card__note", html: note }) : null,
    ...[].concat(body),
  ]);

const band = (label, title, kids) =>
  h("section", { class: "band" }, [
    h("div", { class: "band__head" }, [h("h2", {}, title), h("span", { class: "eyebrow" }, label)]),
    h("div", { class: "grid" }, kids),
  ]);

// ── Hero: la lectura del sprint ───────────────────────────────────────────
function renderThesis(m) {
  const top = m.blockers[0];
  const committed = m.totals.committedPoints;
  const share = pct(top?.unlocksPoints || 0, committed);
  const idle = m.people.filter((p) => p.startable === 0);
  const chainDays = m.chain.length;
  const days = m.meta.sprint?.totalDays ?? 0;

  return h("section", { class: "thesis" }, [
    h("div", {}, [
      h("span", { class: "eyebrow" }, "Lectura del sprint"),
      h("h1", {
        html: `El sprint no está atado por capacidad.<br>Está atado por <em>${esc(top?.key || "—")}</em>.`,
      }),
      h("p", {
        html:
          `La carga está repartida al milímetro — entre <b>${fmt(Math.min(...m.people.map((p) => p.totalPoints)))}</b> y ` +
          `<b>${fmt(Math.max(...m.people.map((p) => p.totalPoints)))}</b> puntos por persona. ` +
          `El problema es otro: de ${m.totals.sprintTickets} tickets solo <b>${m.health.startable}</b> se pueden arrancar hoy, ` +
          `y <b>${idle.length} de ${m.people.length}</b> personas no tienen ninguno. ` +
          `La cadena más larga son <b>${chainDays} eslabones</b> en <b>${days} días</b>.`,
      }),
    ]),
    h("div", { class: "hero-figure" }, [
      h("span", { class: "hero-figure__value" }, `${share}%`),
      h("p", {
        class: "hero-figure__caption",
        html: `de los ${fmt(committed)} puntos del sprint están detrás de <b>${esc(top?.key || "")}</b><br>${esc(top?.summary || "")}`,
      }),
    ]),
  ]);
}

// ── Fichas ────────────────────────────────────────────────────────────────
function renderKpis(m) {
  const s = m.meta.sprint;
  const donePct = pct(m.totals.points.done, m.totals.committedPoints);
  const tiles = [
    { label: "Puntos comprometidos", value: fmt(m.totals.committedPoints), sub: `${m.totals.sprintTickets} tickets en el sprint` },
    { label: "Avance", value: `${donePct}%`, sub: `${fmt(m.totals.points.done)} de ${fmt(m.totals.committedPoints)} pts cerrados` },
    { label: "Días restantes", value: fmt(s?.daysLeft ?? 0), sub: s ? `día ${s.day} de ${s.totalDays}` : "" },
    { label: "Tickets bloqueados", value: fmt(m.health.blocked), sub: `${m.health.startable} libres para arrancar` },
    { label: "Dependencias", value: fmt(m.meta.graph.edges), sub: `${m.meta.graph.depth + 1} niveles de profundidad` },
    { label: "Equipo", value: fmt(m.people.length), sub: `${fmt(Math.round(m.totals.committedPoints / m.people.length))} pts por persona` },
  ];
  return h("div", { class: "kpis" }, tiles.map((t) =>
    h("div", { class: "kpi" }, [
      h("span", { class: "kpi__label" }, t.label),
      h("span", { class: "kpi__value num" }, t.value),
      h("span", { class: "kpi__sub" }, t.sub),
    ])
  ));
}

// ── Burndown ──────────────────────────────────────────────────────────────
function burndown(m) {
  const data = m.burndown;
  if (!data.length) return h("p", { class: "card__note" }, "Sin sprint activo.");
  const W = chartW(840, 8), H = esMovil() ? 200 : 235, P = { t: 16, r: 46, b: 30, l: 38 };
  const maxY = Math.max(...data.map((d) => Math.max(d.ideal, d.actual ?? 0)));
  const ticks = niceTicks(maxY);
  const yMax = ticks[ticks.length - 1];
  const x = scale(0, data.length - 1, P.l, W - P.r);
  const y = scale(0, yMax, H - P.b, P.t);
  const g = svg(W, H);

  for (const t of ticks) {
    g.appendChild(el("line", { class: "gridline", x1: P.l, x2: W - P.r, y1: y(t), y2: y(t) }));
    g.appendChild(text(fmt(t), { class: "tick", x: P.l - 8, y: y(t) + 3.5, "text-anchor": "end" }));
  }
  g.appendChild(el("line", { class: "axis", x1: P.l, x2: W - P.r, y1: y(0), y2: y(0) }));

  for (const d of data) {
    if (d.day % Math.ceil(data.length / 7) === 0 || d.day === data.length - 1) {
      g.appendChild(text(`d${d.day}`, { class: "tick", x: x(d.day), y: H - P.b + 16, "text-anchor": "middle" }));
    }
  }

  const line = (pts, color, width = 2) =>
    el("path", {
      d: pts.map((p, i) => `${i ? "L" : "M"}${x(p[0])},${y(p[1])}`).join(" "),
      fill: "none", stroke: color, "stroke-width": width, "stroke-linejoin": "round", "stroke-linecap": "round",
    });

  g.appendChild(line(data.map((d) => [d.day, d.ideal]), cssVar("--muted")));
  const real = data.filter((d) => d.actual !== null);
  if (real.length > 1) g.appendChild(line(real.map((d) => [d.day, d.actual]), cssVar("--s1")));

  // Punta del dato real: marcador con anillo del color de la superficie.
  const last = real[real.length - 1];
  if (last) {
    g.appendChild(el("circle", { cx: x(last.day), cy: y(last.actual), r: 5, fill: cssVar("--s1"), stroke: cssVar("--surface"), "stroke-width": 2 }));
    g.appendChild(text(`${fmt(last.actual)} pts`, { class: "value", x: x(last.day) + 10, y: y(last.actual) + 4 }));
  }

  // Zonas de contacto generosas para el hover.
  for (const d of data) {
    const hit = el("rect", { class: "hit", x: x(d.day) - 12, y: P.t, width: 24, height: H - P.b - P.t, tabindex: 0, role: "img" });
    const realTxt = d.actual === null ? "—" : `${fmt(d.actual)} pts`;
    bindTip(hit, `<b>Día ${d.day}</b> · ${d.date}<br>Real: ${realTxt}<br>Ideal: ${fmt(d.ideal, 1)} pts`);
    g.appendChild(hit);
  }

  return h("div", {}, [
    g,
    legend([{ label: "Restante real", color: cssVar("--s1") }, { label: "Ritmo ideal", color: cssVar("--muted") }], { line: true }),
  ]);
}

// ── Flujo acumulado ───────────────────────────────────────────────────────
function flow(m) {
  if (m.flow.length < 2) {
    return h("p", { class: "card__note" },
      `Necesita al menos dos días de historial. Hoy hay ${m.flow.length}: el gráfico se dibuja solo a partir de mañana.`);
  }
  const W = chartW(430, 4), H = esMovil() ? 200 : 240, P = { t: 14, r: 16, b: 30, l: 32 };
  const total = m.totals.sprintTickets;
  const x = scale(0, m.flow.length - 1, P.l, W - P.r);
  const y = scale(0, total, H - P.b, P.t);
  const g = svg(W, H);
  const order = [...m.flowOrder].reverse(); // Done abajo, To Do arriba
  let base = m.flow.map(() => 0);
  for (const key of order) {
    const bucket = { varName: flowColor(key) };
    const top = m.flow.map((row, i) => base[i] + row[key]);
    const d =
      m.flow.map((_, i) => `${i ? "L" : "M"}${x(i)},${y(top[i])}`).join(" ") +
      " " + m.flow.map((_, i) => `L${x(m.flow.length - 1 - i)},${y(base[m.flow.length - 1 - i])}`).join(" ") + " Z";
    g.appendChild(el("path", { d, fill: cssVar(bucket.varName), "fill-opacity": 0.9, stroke: cssVar("--surface"), "stroke-width": GAP }));
    base = top;
  }
  g.appendChild(el("line", { class: "axis", x1: P.l, x2: W - P.r, y1: y(0), y2: y(0) }));
  for (const t of niceTicks(total)) {
    g.appendChild(text(fmt(t), { class: "tick", x: P.l - 8, y: y(t) + 3.5, "text-anchor": "end" }));
  }
  m.flow.forEach((row, i) => {
    const hit = el("rect", { class: "hit", x: x(i) - 10, y: P.t, width: 20, height: H - P.b - P.t, tabindex: 0 });
    bindTip(hit, `<b>${row.date}</b><br>` + m.flowOrder.map((n) => `${esc(n)} ${row[n]}`).join(" · "));
    g.appendChild(hit);
  });
  return h("div", {}, [g, legend(m.flowOrder.map((n) => ({ label: n, color: cssVar(flowColor(n)) })))]);
}

// ── Carga por persona ─────────────────────────────────────────────────────
function loadByPerson(m) {
  const rows = m.people.filter((p) => p.total > 0);
  const W = chartW(730, 7), P = { t: 6, r: esMovil() ? 82 : 108, b: 26, l: esMovil() ? 66 : 122 };
  const rowH = 30, H = P.t + rows.length * rowH + P.b;
  const maxX = Math.max(...rows.map((p) => p.totalPoints));
  const ticks = niceTicks(maxX);
  const xMax = ticks[ticks.length - 1];
  const x = scale(0, xMax, P.l, W - P.r);
  const g = svg(W, H);

  for (const t of ticks) {
    g.appendChild(el("line", { class: "gridline", x1: x(t), x2: x(t), y1: P.t, y2: H - P.b }));
    g.appendChild(text(fmt(t), { class: "tick", x: x(t), y: H - P.b + 15, "text-anchor": "middle" }));
  }

  rows.forEach((p, i) => {
    const cy = P.t + i * rowH + rowH / 2;
    const bh = Math.min(BAR_MAX, rowH - 8);
    const yTop = cy - bh / 2;
    g.appendChild(text(nombreCorto(p.name), { class: "label-ink", x: P.l - 10, y: cy + 4, "text-anchor": "end" }));

    let cursor = x(0);
    const segs = m.flowOrder.filter((n) => p.points[n] > 0);
    segs.forEach((name, si) => {
      const w = x(p.points[name]) - x(0);
      const isLast = si === segs.length - 1;
      const drawW = Math.max(1, w - (isLast ? 0 : GAP));
      const node = capsule(cursor, yTop, drawW, bh, isLast ? "right" : null) || el("rect", { x: cursor, y: yTop, width: drawW, height: bh });
      node.setAttribute("fill", cssVar(flowColor(name)));
      node.setAttribute("tabindex", "0");
      bindTip(node, `<b>${esc(p.name)}</b><br>${esc(name)}: ${fmt(p.points[name])} pts · ${p.tickets[name]} tickets`);
      g.appendChild(node);
      cursor += w;
    });

    // Etiqueta directa en la punta: total de puntos y de tickets.
    g.appendChild(text(`${fmt(p.totalPoints)} pts`, { class: "value", x: cursor + 8, y: cy + 4 }));
    g.appendChild(text(`${p.total} tk`, { class: "tick", x: W - 2, y: cy + 4, "text-anchor": "end" }));
  });

  g.appendChild(el("line", { class: "axis", x1: P.l, x2: P.l, y1: P.t, y2: H - P.b }));
  return h("div", {}, [g, legend(m.flowOrder.map((n) => ({ label: n, color: cssVar(flowColor(n)) })))]);
}

// ── Tamaño medio del ticket ───────────────────────────────────────────────
// Todos cargan los mismos puntos, así que un scatter puntos/tickets apila las
// seis etiquetas en la misma altura. Lo que de verdad los separa es cuán
// grande es su ticket promedio.
function avgTicketSize(m) {
  const rows = m.people
    .filter((p) => p.total > 0)
    .map((p) => ({ ...p, avg: p.totalPoints / p.total }))
    .sort((a, b) => b.avg - a.avg);
  const W = chartW(520, 5), P = { t: 6, r: esMovil() ? 80 : 104, b: 28, l: esMovil() ? 66 : 132 };
  const rowH = 30, H = P.t + rows.length * rowH + P.b;
  const ticks = niceTicks(Math.max(...rows.map((r) => r.avg)));
  const x = scale(0, ticks.at(-1), P.l, W - P.r);
  const g = svg(W, H);

  for (const t of ticks) {
    g.appendChild(el("line", { class: "gridline", x1: x(t), x2: x(t), y1: P.t, y2: H - P.b }));
    g.appendChild(text(fmt(t, 1), { class: "tick", x: x(t), y: H - P.b + 15, "text-anchor": "middle" }));
  }
  rows.forEach((r, i) => {
    const cy = P.t + i * rowH + rowH / 2;
    const bh = Math.min(BAR_MAX, rowH - 8);
    const bar = capsule(P.l, cy - bh / 2, Math.max(1, x(r.avg) - P.l), bh, "right");
    bar.setAttribute("fill", cssVar("--s1"));
    bar.setAttribute("tabindex", "0");
    bindTip(bar, `<b>${esc(r.name)}</b><br>${r.total} tickets para ${fmt(r.totalPoints)} pts<br>Ticket promedio: ${r.avg.toFixed(1)} pts`);
    g.appendChild(bar);
    g.appendChild(text(nombreCorto(r.name), { class: "label-ink", x: P.l - 10, y: cy + 4, "text-anchor": "end" }));
    g.appendChild(text(`${r.avg.toFixed(1)} pts`, { class: "value", x: x(r.avg) + 8, y: cy + 4 }));
    g.appendChild(text(`${r.total} tk`, { class: "tick", x: W - 2, y: cy + 4, "text-anchor": "end" }));
  });
  g.appendChild(el("line", { class: "axis", x1: P.l, x2: P.l, y1: P.t, y2: H - P.b }));
  g.appendChild(text("puntos por ticket", { class: "tick", x: W - P.r, y: H - P.b + 27, "text-anchor": "end" }));
  return g;
}

// ── Semáforo: tickets que llevan más de lo que deberían ──────────────────
function alertList(m) {
  if (!m.alerts.length) {
    const conReloj = m.table.filter((t) => t.age !== null).length;
    const sinArrancar = m.table.filter((t) => t.age === null && t.bucket === "todo").length;
    return h("p", { class: "card__note" },
      `Ningún ticket pasado de tiempo. Hay ${conReloj} con el reloj corriendo; ` +
      `los otros ${sinArrancar} siguen en To Do y todavía no arrancaron, así que no se les cuenta nada.`);
  }
  return h("div", { class: "alerts" }, m.alerts.slice(0, 14).map((a) => {
    const sev = SEV[a.severity];
    const over = Math.min(1, a.ratio / 2);
    return h("div", { class: "alert" }, [
      h("span", { class: "alert__key" }, a.key),
      h("div", { class: "alert__body" }, [
        h("div", { class: "alert__title" }, a.summary),
        h("div", { class: "alert__who" }, `${a.assignee} · ${a.points} pts · ${a.status}`),
      ]),
      h("div", {
        class: "alert__bar",
        title: `${dur(a.elapsed)} de ${dur(a.budget)}` + (a.startedAt ? `, desde que arrancó ${momento(a.startedAt)}` : ""),
      }, [h("div", {
        class: "alert__fill",
        style: `width:${Math.round(over * 100)}%;background:var(${sev.varName})`,
      })]),
      h("span", { class: `pill ${sev.cls}` }, [
        h("span", { class: "pill__dot" }),
        a.severity === "late" ? `${dur(a.overBy)} de más` : `${Math.round(a.ratio * 100)}%`,
      ]),
    ]);
  }));
}

// ── Cuántos hay en cada estado del flujo y hace cuánto ────────────────────
function flowBreakdown(m) {
  const cells = m.byStatus.map((s) => {
    const cell = h("div", { class: "flow-cell" }, [
      h("div", { class: "flow-cell__head" }, [
        h("span", { class: "flow-cell__swatch", style: `background:var(${flowColor(s.name)})` }),
        s.name,
      ]),
      h("div", { class: "flow-cell__value num" }, [
        String(s.tickets),
        h("small", {}, ` tk · ${fmt(s.points)} pts`),
      ]),
      h("div", { class: "flow-cell__meta" },
        s.tickets === 0 ? "sin tickets"
        : s.category === "done" ? "cerrados"
        : s.blocked === s.tickets ? `${s.blocked} esperando dependencia${s.blocked > 1 ? "s" : ""}`
        : `mediana ${dur(s.medianAge)}${s.blocked ? ` · ${s.blocked} bloqueado${s.blocked > 1 ? "s" : ""}` : ""}`),
      (s.late || s.warn)
        ? h("div", { class: "flow-cell__meta" }, [
            s.late ? h("span", { class: "pill pill--crit" }, [h("span", { class: "pill__dot" }), `${s.late} vencido${s.late > 1 ? "s" : ""}`]) : null,
            s.warn ? h("span", { class: "pill pill--warn" }, [h("span", { class: "pill__dot" }), `${s.warn} por vencer`]) : null,
          ])
        : null,
    ]);
    return cell;
  });
  return h("div", { class: "flow-grid" }, cells);
}

// ── El presupuesto, escrito ───────────────────────────────────────────────
function budgetTable(m) {
  const pts = Object.keys(m.sla.budgets).map(Number).sort((a, b) => a - b);
  const states = Object.keys(m.sla.factors);
  return h("div", { class: "table-wrap", style: "max-height:none" }, [
    h("table", { class: "budget" }, [
      h("thead", {}, [h("tr", {}, [
        h("th", {}, "Puntos"),
        ...states.map((st) => h("th", { class: "num" }, st)),
      ])]),
      h("tbody", {}, pts.map((p) =>
        h("tr", {}, [
          h("td", {}, [String(p), h("span", { class: "roster__meta" }, ` · ${dur(m.sla.budgets[p])}`)]),
          ...states.map((st) => h("td", { class: "num" }, dur(m.sla.budgets[p] * m.sla.factors[st]))),
        ])
      )),
    ]),
  ]);
}

// ── Matriz desarrollador × reviewer ───────────────────────────────────────
function reviewMatrix(m) {
  const devs = [...new Set(m.devReviewer.map((d) => d.dev))].sort();
  const revs = [...new Set(m.devReviewer.map((d) => d.reviewer))].sort();
  if (!devs.length) return h("p", { class: "card__note" }, "Sin datos de revisión todavía.");
  const lookup = new Map(m.devReviewer.map((d) => [`${d.dev}|${d.reviewer}`, d.count]));
  const max = Math.max(...m.devReviewer.map((d) => d.count));
  const cell = esMovil() ? 30 : 34, P = { t: esMovil() ? 64 : 76, l: esMovil() ? 70 : 104 };
  const W = P.l + revs.length * cell + 12, H = P.t + devs.length * cell + 12;
  const g = svg(W, H);
  // Ancho natural: estirarla al 100% agrandaba el texto hasta 2x.
  g.style.maxWidth = `${W}px`;
  const ramp = ["--q0", "--q1", "--q2", "--q3", "--q4", "--q5"];

  revs.forEach((r, j) => {
    const cx = P.l + j * cell + cell / 2;
    g.appendChild(text(first(r), { class: "tick", x: cx, y: P.t - 10, "text-anchor": "start", transform: `rotate(-45 ${cx} ${P.t - 10})` }));
  });
  devs.forEach((d, i) => {
    const cy = P.t + i * cell + cell / 2;
    g.appendChild(text(first(d), { class: "label-ink", x: P.l - 10, y: cy + 4, "text-anchor": "end" }));
    revs.forEach((r, j) => {
      const n = lookup.get(`${d}|${r}`) || 0;
      const step = n === 0 ? 0 : Math.max(1, Math.ceil((n / max) * (ramp.length - 1)));
      const box = el("rect", {
        x: P.l + j * cell + GAP / 2, y: cy - cell / 2 + GAP / 2,
        width: cell - GAP, height: cell - GAP, rx: 4,
        fill: cssVar(ramp[step]), tabindex: 0,
      });
      bindTip(box, n
        ? `<b>${esc(first(d))}</b> escribe, <b>${esc(first(r))}</b> revisa<br>${n} ticket${n > 1 ? "s" : ""}`
        : `${esc(first(d))} → ${esc(first(r))}: sin tickets`);
      g.appendChild(box);
      if (n) {
        g.appendChild(text(String(n), {
          x: P.l + j * cell + cell / 2, y: cy + 4, "text-anchor": "middle",
          fill: step === 0 ? cssVar("--muted") : readableOn(cssVar(ramp[step])), "font-size": 11, "font-weight": 600,
        }));
      }
    });
  });
  return h("div", {}, [g, h("p", { class: "card__note" }, "Filas: quien desarrolla. Columnas: quien revisa. El número es la cantidad de tickets.")]);
}

// ── Cascada de dependencias ───────────────────────────────────────────────
function levelsChart(m) {
  const rows = m.levels;
  const W = chartW(1260, 12), H = esMovil() ? 210 : 250, P = { t: 22, r: 12, b: 44, l: 34 };
  const max = Math.max(...rows.map((r) => r.tickets));
  const ticks = niceTicks(max);
  const y = scale(0, ticks.at(-1), H - P.b, P.t);
  const band = (W - P.l - P.r) / rows.length;
  const bw = Math.min(BAR_MAX, band - 6);
  const g = svg(W, H);

  for (const t of ticks) {
    g.appendChild(el("line", { class: "gridline", x1: P.l, x2: W - P.r, y1: y(t), y2: y(t) }));
    g.appendChild(text(fmt(t), { class: "tick", x: P.l - 8, y: y(t) + 3.5, "text-anchor": "end" }));
  }
  rows.forEach((r, i) => {
    const cx = P.l + i * band + band / 2;
    const bar = capsule(cx - bw / 2, y(r.tickets), bw, y(0) - y(r.tickets), "top");
    // Sólo el nivel 0 puede empezar hoy: se destaca, el resto queda en reposo.
    bar.setAttribute("fill", r.level === 0 ? cssVar("--s1") : cssVar("--o1"));
    bar.setAttribute("tabindex", "0");
    bindTip(bar, `<b>Nivel ${r.level}</b><br>${r.tickets} tickets · ${fmt(r.points)} pts<br>${r.level === 0 ? "Sin dependencias: se puede arrancar" : `Espera a que cierren ${r.level} nivel${r.level > 1 ? "es" : ""} antes`}`);
    g.appendChild(bar);
    g.appendChild(text(`L${r.level}`, { class: "tick", x: cx, y: H - P.b + 16, "text-anchor": "middle" }));
  });
  g.appendChild(el("line", { class: "axis", x1: P.l, x2: W - P.r, y1: y(0), y2: y(0) }));
  g.appendChild(text("← se puede hoy", { class: "tick", x: P.l, y: H - P.b + 34, "text-anchor": "start" }));
  g.appendChild(text("espera a que cierre lo anterior →", { class: "tick", x: W - P.r, y: H - P.b + 34, "text-anchor": "end" }));
  return g;
}

// ── Top bloqueantes ───────────────────────────────────────────────────────
function blockersChart(m) {
  const rows = m.blockers.slice(0, 8);
  const W = chartW(730, 7), P = { t: 4, r: esMovil() ? 62 : 82, b: 24, l: 70 };
  const rowH = 27, H = P.t + rows.length * rowH + P.b;
  const ticks = niceTicks(Math.max(...rows.map((r) => r.unlocksPoints)));
  const x = scale(0, ticks.at(-1), P.l, W - P.r);
  const g = svg(W, H);

  for (const t of ticks) {
    g.appendChild(el("line", { class: "gridline", x1: x(t), x2: x(t), y1: P.t, y2: H - P.b }));
    g.appendChild(text(fmt(t), { class: "tick", x: x(t), y: H - P.b + 14, "text-anchor": "middle" }));
  }
  rows.forEach((r, i) => {
    const cy = P.t + i * rowH + rowH / 2;
    const bh = Math.min(BAR_MAX, rowH - 7);
    const bar = capsule(P.l, cy - bh / 2, Math.max(1, x(r.unlocksPoints) - P.l), bh, "right");
    // Un solo número es la historia: se resalta el primero y se apaga el resto.
    bar.setAttribute("fill", i === 0 ? cssVar("--critical") : cssVar("--o1"));
    bar.setAttribute("tabindex", "0");
    bindTip(bar, `<b>${esc(r.key)}</b> · ${esc(r.summary)}<br>Destraba ${r.unlocks} tickets y ${fmt(r.unlocksPoints)} pts<br>A cargo: ${esc(r.assignee)} · ${fmt(r.points)} pts`);
    g.appendChild(bar);
    g.appendChild(text(r.key, { class: "label-ink", x: P.l - 10, y: cy + 4, "text-anchor": "end", "font-family": "var(--mono)", "font-size": 11 }));
    g.appendChild(text(`${fmt(r.unlocksPoints)} pts`, { class: "value", x: x(r.unlocksPoints) + 8, y: cy + 4 }));
  });
  g.appendChild(el("line", { class: "axis", x1: P.l, x2: P.l, y1: P.t, y2: H - P.b }));
  return g;
}

// ── Cadena crítica ────────────────────────────────────────────────────────
function criticalChain(m) {
  return h("div", { class: "chain" }, m.chain.map((c, i) =>
    h("div", { class: "chain__link" }, [
      h("div", { class: "chain__rail" }, [h("div", { class: "chain__node" })]),
      h("div", { class: "chain__body" }, [
        h("div", { class: "chain__title" }, [h("span", { class: "key" }, c.key), " ", c.summary]),
        h("div", { class: "chain__who" }, `${c.assignee} · ${c.points} pts`),
      ]),
      h("span", { class: "roster__meta" }, `#${i + 1}`),
    ])
  ));
}

// ── Quién puede arrancar hoy ──────────────────────────────────────────────
function startableRoster(m) {
  const rows = [...m.people].sort((a, b) => b.startable - a.startable);
  return h("div", { class: "roster" }, rows.map((p) => {
    const blocked = p.total - p.startable;
    return h("div", { class: "roster__row" }, [
      h("span", { class: "roster__name" }, p.name),
      h("span", { class: "roster__meta" }, `${blocked} bloqueados`),
      p.startable > 0
        ? h("span", { class: "pill pill--good" }, [h("span", { class: "pill__dot" }), `${p.startable} para arrancar`])
        : h("span", { class: "pill pill--crit" }, [h("span", { class: "pill__dot" }), "sin nada que empezar"]),
    ]);
  }));
}

// ── Épicas ────────────────────────────────────────────────────────────────
function epicsChart(m) {
  const rows = m.epics.slice(0, 12);
  const W = chartW(1260, 12), P = { t: 4, r: esMovil() ? 54 : 64, b: 22, l: esMovil() ? 108 : 190 };
  const rowH = 26, H = P.t + rows.length * rowH + P.b;
  const ticks = niceTicks(Math.max(...rows.map((r) => r.points)));
  const x = scale(0, ticks.at(-1), P.l, W - P.r);
  const g = svg(W, H);

  for (const t of ticks) {
    g.appendChild(el("line", { class: "gridline", x1: x(t), x2: x(t), y1: P.t, y2: H - P.b }));
    g.appendChild(text(fmt(t), { class: "tick", x: x(t), y: H - P.b + 14, "text-anchor": "middle" }));
  }
  rows.forEach((r, i) => {
    const cy = P.t + i * rowH + rowH / 2;
    const bh = Math.min(BAR_MAX - 6, rowH - 8);
    let cursor = P.l;
    const segs = [
      { label: "Hecho", v: r.done, varName: "--o4" },
      { label: "En curso", v: r.doing, varName: "--o2" },
      { label: "Por hacer", v: r.todo, varName: "--o1" },
    ].filter((seg) => seg.v > 0);
    segs.forEach((seg, si) => {
      const w = x(seg.v) - x(0);
      const isLast = si === segs.length - 1;
      const node = capsule(cursor, cy - bh / 2, Math.max(1, w - (isLast ? 0 : GAP)), bh, isLast ? "right" : null);
      node.setAttribute("fill", cssVar(seg.varName));
      node.setAttribute("tabindex", "0");
      bindTip(node, `<b>${esc(r.name)}</b><br>${seg.label}: ${fmt(seg.v)} de ${fmt(r.points)} pts`);
      g.appendChild(node);
      cursor += w;
    });
    const tope = esMovil() ? 13 : 26;
    const label = r.name.length > tope ? r.name.slice(0, tope - 1) + "…" : r.name;
    const t = text(label, { class: "label-ink", x: P.l - 10, y: cy + 4, "text-anchor": "end", tabindex: 0 });
    bindTip(t, `<b>${esc(r.name)}</b><br>${r.tickets} tickets · ${fmt(r.points)} pts · ${r.pct}% hecho`);
    g.appendChild(t);
    g.appendChild(text(`${fmt(r.points)} pts`, { class: "value", x: cursor + 8, y: cy + 4 }));
  });
  g.appendChild(el("line", { class: "axis", x1: P.l, x2: P.l, y1: P.t, y2: H - P.b }));
  return h("div", {}, [g, legend([
    { label: "Hecho", color: cssVar("--o4") },
    { label: "En curso", color: cssVar("--o2") },
    { label: "Por hacer", color: cssVar("--o1") },
  ])]);
}

// ── Tabla: el gemelo accesible de todos los gráficos ──────────────────────
function tableView(m) {
  // Orden de columnas: primero lo accionable (estado y consumo del
  // presupuesto), después el contexto. Lo que importa tiene que entrar en
  // pantalla sin scrollear a la derecha.
  const cols = [
    { t: "Ticket", num: false, get: (r) => h("span", { class: "key" }, r.key) },
    { t: "Resumen", num: false, cls: "truncate", get: (r) => r.summary },
    { t: "A cargo", num: false, get: (r) => r.assignee },
    { t: "Pts", num: true, get: (r) => fmt(r.points) },
    { t: "Estado", num: false, get: (r) => h("span", { class: "state-chip" }, [
        h("span", { class: "state-chip__dot", style: `background:var(${flowColor(r.status)})` }), r.status]) },
    { t: "Lleva", num: true, get: (r) => dur(r.age ?? r.waiting) },
    { t: "Presupuesto", num: true, get: (r) => dur(r.budget) },
    { t: "Consumo", num: false, get: (r) => r.ratio === null
        ? h("span", { class: "roster__meta" }, SEV[r.severity].label)
        : h("span", { class: `pill ${SEV[r.severity].cls}` }, [
            h("span", { class: "pill__dot" }), `${Math.round(r.ratio * 100)}%`]) },
    { t: "Nivel", num: true, get: (r) => `L${r.level}` },
    { t: "Destraba", num: true, get: (r) => (r.unlocks ? String(r.unlocks) : "—") },
    { t: "Épica", num: false, cls: "truncate", get: (r) => r.epic || "—" },
    { t: "Revisa", num: false, get: (r) => r.reviewer || "—" },
  ];
  // Lo accionable primero. "none" son los que todavía no arrancaron: no urgen,
  // pero siguen siendo trabajo pendiente, así que van antes que los cerrados.
  const rank = { late: 0, warn: 1, ok: 2, blocked: 3, none: 4, done: 5 };
  const rows = [...m.table].sort((a, b) =>
    rank[a.severity] - rank[b.severity] || (b.ratio ?? -1) - (a.ratio ?? -1) || b.unlocks - a.unlocks);

  return h("div", { class: "table-wrap" }, [
    h("table", {}, [
      h("thead", {}, [h("tr", {}, cols.map((c) => h("th", { class: c.num ? "num" : "" }, c.t)))]),
      h("tbody", {}, rows.map((r) =>
        h("tr", {}, cols.map((c) => h("td", { class: [c.num ? "num" : "", c.cls || ""].join(" ").trim() }, [c.get(r)])))
      )),
    ]),
  ]);
}

// ── Composición ───────────────────────────────────────────────────────────
function render(m) {
  setHoursPerDay(m.sla.hoursPerDay);
  setFlow(m.flowOrder);
  const s = m.meta.sprint;
  const idle = m.people.filter((p) => p.startable === 0).length;
  const top = m.blockers[0];

  app.replaceChildren(
    renderThesis(m),
    renderKpis(m),

    band("01 · mapa", "El árbol de dependencias", [
      card("Qué se puede agarrar ahora",
        `Cada nodo es un ticket y sus padres son los que lo bloquean. Los de borde verde no esperan a nadie: son los <b>${m.health.startable}</b> que se pueden empezar hoy. Elegí una persona para ver sólo lo suyo, o pasá el mouse por un nodo para ver toda la cascada que destraba.`,
        dependencyTree(m, treeState, rerender), "col-12"),
    ]),

    band("02 · tablero", "El sprint por estado", [
      card("Tablero",
        `Una columna por estado del flujo. El círculo verde marca los tickets sin bloqueantes. La píldora con color mide el trabajo desde In Progress contra su presupuesto; en To Do es gris y sólo dice hace cuánto espera. El filtro es el mismo que el del árbol.`,
        kanbanBoard(m, treeState, rerender), "col-12"),
    ]),

    band("03 · reloj", "¿Algo lleva demasiado tiempo parado?", [
      card("Pasados de tiempo",
        `Cada ticket tiene un presupuesto de horas según sus puntos, y el reloj arranca cuando entra a <b>In Progress</b>. Si lo excede, aparece acá. ` +
        `Un ticket en To Do no tiene reloj: nadie lo agarró todavía, así que no puede estar vencido.`,
        alertList(m), "col-7"),
      card("Dónde está cada ticket", "Estados del flujo, en orden. La mediana es de trabajo desde In Progress; en To Do, de espera en la cola.",
        flowBreakdown(m), "col-5"),
      card("El presupuesto",
        `Horas de reloj corridas —noches y fines de semana incluidos— desde que el ticket entra a In Progress. El reloj no se reinicia al pasar a In Review: por eso ahí el presupuesto suma medio más, para revisar. To Do no figura porque no tiene reloj. Se cambia en <code>lib/sla.js</code>.`,
        budgetTable(m), "col-5"),
      card("Aviso y vencimiento",
        `Se avisa al <b>${Math.round(m.sla.thresholds.warn * 100)}%</b> del presupuesto y se marca vencido al pasar el <b>${Math.round(m.sla.thresholds.late * 100)}%</b>. ` +
        `El reloj arranca cuando el ticket entra a In Progress y corre hasta que se cierra — nunca antes.`,
        h("div", { class: "flow-grid" }, [
          h("div", { class: "flow-cell" }, [
            h("div", { class: "flow-cell__head" }, "Con reloj corriendo"),
            h("div", { class: "flow-cell__value num" }, String(m.table.filter((t) => t.age !== null).length)),
            h("div", { class: "flow-cell__meta" }, "arrancados y sin cerrar"),
          ]),
          h("div", { class: "flow-cell" }, [
            h("div", { class: "flow-cell__head" }, "Todavía en To Do"),
            h("div", { class: "flow-cell__value num" }, String(m.table.filter((t) => t.age === null && t.bucket === "todo").length)),
            h("div", { class: "flow-cell__meta" }, "sin reloj hasta que arranquen"),
          ]),
        ]), "col-7"),
    ]),

    band("04 · ritmo", "¿Vamos en hora?", [
      card("Burndown del sprint",
        s ? `Día <b>${s.day}</b> de <b>${s.totalDays}</b>. La línea real arranca en ${fmt(m.totals.committedPoints)} puntos y tiene que tocar cero el ${new Date(s.end).toLocaleDateString("es-AR")}.` : "",
        burndown(m), "col-8"),
      card("Flujo acumulado", "Cómo se reparten los tickets entre por hacer, en curso y hecho, día a día.", flow(m), "col-4"),
    ]),

    band("05 · equipo", "Cómo está repartido el trabajo", [
      card("Carga por persona",
        `El reparto por puntos es parejo. Lo que no es parejo es el <b>tamaño</b> de los tickets: mirá el gráfico de al lado.`,
        loadByPerson(m), "col-7"),
      card("Quién puede arrancar hoy",
        idle ? `<b>${idle} de ${m.people.length}</b> personas no tienen ningún ticket libre de dependencias.` : "Todo el equipo tiene por dónde empezar.",
        startableRoster(m), "col-5"),
      card("Tamaño medio del ticket",
        "Todos cargan los mismos puntos. Quien tiene el promedio más alto trabaja en piezas más grandes — y tarda más en mostrar avance.",
        avgTicketSize(m), "col-5"),
      card("Quién revisa a quién", "Ninguna casilla debería concentrar demasiado: las revisiones reparten el conocimiento.", reviewMatrix(m), "col-7"),
    ]),

    band("06 · dependencias", "El cuello de botella", [
      card("Qué destraba cada ticket",
        top ? `Cerrar <b>${esc(top.key)}</b> libera ${fmt(top.unlocksPoints)} de los ${fmt(m.totals.committedPoints)} puntos del sprint. Es el primer ticket del lunes.` : "",
        blockersChart(m), "col-7"),
      card("Cadena crítica",
        `${m.chain.length} tickets que van sí o sí uno detrás del otro, y pasan por ${new Set(m.chain.map((c) => c.assignee)).size} personas distintas. Es el piso de duración del sprint.`,
        criticalChain(m), "col-5"),
      card("Cascada por niveles",
        `Cada nivel espera a que cierre el anterior. Hoy solo el nivel 0 está libre: <b>${m.health.startable} tickets</b> de ${m.totals.sprintTickets}.`,
        levelsChart(m), "col-12"),
    ]),

    band("07 · alcance", "Por dónde avanza el producto", [
      card("Épicas por puntos", "Ordenadas por tamaño. La barra se va tiñendo a medida que cierran los tickets de cada una.", epicsChart(m), "col-12"),
    ]),

    band("08 · detalle", "Todos los tickets del sprint", [
      h("div", { class: "col-12" }, [tableView(m)]),
    ]),

    h("p", {
      class: "footnote",
      html: `Datos de <a href="${esc(m.meta.site)}/browse/${esc(m.meta.project)}">${esc(m.meta.site.replace("https://", ""))}</a> · proyecto ${esc(m.meta.project)} · ${m.meta.graph.edges} dependencias leídas de los links «Blocks» · grafo ${m.meta.graph.acyclic ? "sin ciclos" : "⚠ con ciclos"}.`,
    })
  );

  lastFetch = new Date(m.meta.fetchedAt);
  clock.innerHTML = s
    ? `<b>${esc(s.name)}</b> · día ${s.day}/${s.totalDays} · ${s.daysLeft} días restantes`
    : "";
  tickAge();
}

// ── Carga y refresco automático ───────────────────────────────────────────
const POLL_MS = 60_000;
let lastFetch = null;
let live = true;
let timer = null;

/** "hace 12 s" / "hace 3 min" — se actualiza cada segundo, sin pedir nada. */
function tickAge() {
  if (!lastFetch) return;
  const secs = Math.max(0, Math.round((Date.now() - lastFetch) / 1000));
  const ago = secs < 60 ? `hace ${secs} s` : `hace ${Math.round(secs / 60)} min`;
  liveBtn.innerHTML = live
    ? `<span class="live__dot"></span>en vivo · ${ago}`
    : `<span class="live__dot live__dot--off"></span>pausado · ${ago}`;
  liveBtn.title = live
    ? `Se actualiza solo cada ${POLL_MS / 1000} s. Clic para pausar.`
    : "Refresco automático pausado. Clic para reanudar.";
}

function schedule() {
  clearTimeout(timer);
  if (live) timer = setTimeout(() => load({ force: true, quiet: true }), POLL_MS);
}

/** Pantalla de contraseña: aparece cuando la API contesta 401. */
function loginScreen() {
  const input = h("input", {
    type: "password", id: "pass", autocomplete: "current-password",
    placeholder: "Contraseña", required: "",
  });
  const error = h("p", { class: "login__error", hidden: "" });
  const submit = h("button", { type: "submit" }, "Entrar");

  const form = h("form", { class: "login" }, [
    h("h2", {}, "Tablero FutBot"),
    h("p", { class: "card__note" }, "Este tablero muestra los datos del sprint del equipo. Ingresá la contraseña para verlo."),
    h("div", { class: "login__row" }, [input, submit]),
    error,
  ]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submit.disabled = true;
    error.hidden = true;
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: input.value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "No se pudo entrar");
      }
      await load();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      input.select();
    } finally {
      submit.disabled = false;
    }
  });

  requestAnimationFrame(() => input.focus());
  return h("div", { class: "state" }, [form]);
}

async function load({ force = false, quiet = false } = {}) {
  if (!quiet) refreshBtn.disabled = true;
  if (app.dataset.ready) app.classList.add("stale"); // sin salto de layout al refrescar
  const scrollY = window.scrollY;
  try {
    const res = await fetch(`/api/board${force ? "?refresh=1" : ""}`);
    const body = await res.json();
    if (res.status === 401) {
      clearTimeout(timer);
      clock.innerHTML = "";
      liveBtn.innerHTML = "";
      liveBtn.hidden = true;
      refreshBtn.hidden = true;
      app.replaceChildren(loginScreen());
      delete app.dataset.ready;
      return;
    }
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    lastMetrics = body;
    liveBtn.hidden = false;
    refreshBtn.hidden = false;
    render(body);
    app.dataset.ready = "1";
    // El tablero se redibuja entero: sin esto, cada refresco te manda arriba.
    window.scrollTo({ top: scrollY, behavior: "instant" });
  } catch (err) {
    // Un fallo de red no debe borrar un tablero que ya se está viendo.
    if (app.dataset.ready) {
      liveBtn.innerHTML = `<span class="live__dot live__dot--err"></span>sin conexión`;
      liveBtn.title = `No se pudo actualizar: ${err.message}`;
    } else {
      app.replaceChildren(h("div", { class: "state" }, [
        h("h2", {}, "No se pudieron traer los datos"),
        h("p", { html: esc(err.message) }),
        h("p", { html: `Revisá <code>.env</code> y que el servidor haya arrancado con <code>npm start</code>.` }),
      ]));
    }
  } finally {
    app.classList.remove("stale");
    refreshBtn.disabled = false;
    schedule();
  }
}

refreshBtn.addEventListener("click", () => load({ force: true }));
liveBtn.addEventListener("click", () => {
  live = !live;
  tickAge();
  if (live) load({ force: true, quiet: true });
  else clearTimeout(timer);
});

// Con la pestaña oculta no tiene sentido consultar Jira; al volver, se pone al día.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearTimeout(timer);
  else if (live) load({ force: true, quiet: true });
});

setInterval(tickAge, 1000);

// Los gráficos se construyen al ancho del viewport, así que un cambio de
// ancho (rotar el teléfono) pide redibujarlos. Sólo si el ancho cambió de
// verdad: en iOS la barra de direcciones dispara resize al hacer scroll.
let anchoPrevio = window.innerWidth;
let reajuste = null;
window.addEventListener("resize", () => {
  if (window.innerWidth === anchoPrevio) return;
  anchoPrevio = window.innerWidth;
  clearTimeout(reajuste);
  reajuste = setTimeout(rerender, 180);
});

load();
