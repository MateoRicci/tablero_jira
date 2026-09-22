// Árbol de dependencias. Cada nodo es un ticket; sus padres son los tickets
// que lo bloquean. Sirve para dos preguntas: qué puedo agarrar ahora, y qué
// se destraba si cierro esto.
//
// El color codifica ESTADO (disponible / bloqueado / hecho), no identidad:
// resaltar por persona se hace atenuando el resto, no dándole un color a
// cada uno — con seis personas ninguna paleta categórica pasa los pisos.

import { svg, el, text, bindTip, cssVar } from "./charts.js";

const NODE_W = 108, NODE_H = 28, COL = 158, ROW = 38, PAD = 26;
const fmtDur = (hrs) => {
  if (hrs === null || hrs === undefined) return "—";
  if (hrs < 1) return `${Math.round(hrs * 60)} min`;
  if (hrs < 12) { const v = Math.round(hrs * 10) / 10; return `${Number.isInteger(v) ? v : v.toString().replace(".", ",")} h`; }
  const d = Math.floor(hrs / 12), r = Math.round(hrs - d * 12);
  return r ? `${d} d ${r} h` : `${d} d`;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Ordena cada nivel por baricentro para que se crucen menos aristas. */
function layout(nodes, edges) {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const levels = [];
  for (const n of nodes) (levels[n.level] ||= []).push(n);
  for (const l of levels) if (l) l.sort((a, b) => a.key.localeCompare(b.key, "es", { numeric: true }));

  const preds = new Map(nodes.map((n) => [n.key, []]));
  const succs = new Map(nodes.map((n) => [n.key, []]));
  for (const [from, to] of edges) {
    if (!byKey.has(from) || !byKey.has(to)) continue;
    succs.get(from).push(to);
    preds.get(to).push(from);
  }

  const index = new Map();
  const reindex = () => levels.forEach((l) => l?.forEach((n, i) => index.set(n.key, i)));
  reindex();

  const bary = (keys, fallback) => {
    if (!keys.length) return fallback;
    return keys.reduce((s, k) => s + (index.get(k) ?? 0), 0) / keys.length;
  };

  for (let pass = 0; pass < 6; pass++) {
    const down = pass % 2 === 0;
    const order = down ? levels : [...levels].reverse();
    for (const l of order) {
      if (!l) continue;
      const w = new Map(l.map((n, i) => [n.key, bary(down ? preds.get(n.key) : succs.get(n.key), i)]));
      l.sort((a, b) => w.get(a.key) - w.get(b.key) || a.key.localeCompare(b.key, "es", { numeric: true }));
      reindex();
    }
  }

  const height = Math.max(...levels.filter(Boolean).map((l) => l.length));
  levels.forEach((l, lvl) => {
    if (!l) return;
    // Centra verticalmente cada columna: las cortas quedan en el medio.
    const offset = (height - l.length) / 2;
    l.forEach((n, i) => {
      n.x = PAD + lvl * COL;
      n.y = PAD + (offset + i) * ROW;
    });
  });

  return {
    width: PAD * 2 + (levels.length - 1) * COL + NODE_W,
    height: PAD * 2 + height * ROW,
    preds, succs,
  };
}

export function dependencyTree(metrics, state, onFilterChange) {
  const nodes = metrics.table.map((t) => ({ ...t }));
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const edges = [];
  for (const n of nodes) for (const b of n.blockedBy) if (byKey.has(b)) edges.push([b, n.key]);

  const { width, height, preds, succs } = layout(nodes, edges);
  const isDone = (k) => byKey.get(k)?.bucket === "done";
  // Disponible = no le queda ningún bloqueante sin cerrar.
  const available = (n) => n.bucket !== "done" && preds.get(n.key).every(isDone);

  // ── Estado de la vista ──
  // Vive fuera del componente: el tablero se redibuja solo cada minuto y la
  // selección del usuario no se puede perder en cada refresco.
  let person = state.person;              // null = todo el equipo
  let onlyAvailable = state.onlyAvailable;
  let focus = state.focus;                // nodo bajo el cursor o clickeado
  let pinned = state.pinned;
  // Si el ticket fijado ya no existe (lo movieron de sprint), se suelta.
  if (focus && !byKey.has(focus)) { focus = null; pinned = false; }
  const save = () => Object.assign(state, { person, onlyAvailable, focus, pinned });

  // ── Cascada aguas abajo / arriba desde un nodo ──
  const walk = (start, map) => {
    const seen = new Set(), stack = [start];
    while (stack.length) {
      for (const k of map.get(stack.pop()) || []) {
        if (!seen.has(k)) { seen.add(k); stack.push(k); }
      }
    }
    return seen;
  };

  const g = svg(width, height, { class: "chart tree__svg" });
  g.setAttribute("height", height);
  g.removeAttribute("width");
  g.style.minWidth = `${width}px`;

  const edgeLayer = el("g", { class: "tree__edges" });
  const nodeLayer = el("g", { class: "tree__nodes" });
  g.append(edgeLayer, nodeLayer);

  // ── Aristas ──
  const edgeEls = [];
  for (const [from, to] of edges) {
    const a = byKey.get(from), b = byKey.get(to);
    const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2;
    const x2 = b.x, y2 = b.y + NODE_H / 2;
    const mx = (x1 + x2) / 2;
    const path = el("path", {
      d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`,
      fill: "none", "stroke-width": 1.25, "stroke-linecap": "round",
    });
    edgeLayer.appendChild(path);
    edgeEls.push({ path, from, to });
  }

  // ── Nodos ──
  const nodeEls = [];
  for (const n of nodes) {
    const group = el("g", { class: "tree__node", tabindex: 0, role: "button" });
    const box = el("rect", { x: n.x, y: n.y, width: NODE_W, height: NODE_H, rx: 6, "stroke-width": 1.5 });
    const key = text(n.key, { x: n.x + 9, y: n.y + NODE_H / 2 + 4, "font-family": "var(--mono)", "font-size": 11 });
    const pts = text(`${n.points}`, { x: n.x + NODE_W - 9, y: n.y + NODE_H / 2 + 4, "text-anchor": "end", "font-size": 10.5, class: "tick" });
    group.append(box, key, pts);

    // Vencido / por vencer: se marca con un punto en la esquina. Es forma y
    // posición, no otro color de relleno, para no pelear con el estado.
    let badge = null;
    if (n.severity === "late" || n.severity === "warn") {
      badge = el("circle", {
        class: "tree__badge", cx: n.x + NODE_W - 4, cy: n.y + 4, r: 4.5,
        stroke: cssVar("--surface"), "stroke-width": 2,
      });
      group.appendChild(badge);
    }

    const blockers = preds.get(n.key);
    const reloj =
      n.severity === "blocked" ? "Sin reloj: espera una dependencia"
      : n.age === null ? ""
      : `Lleva <b>${fmtDur(n.age)}</b> en ${esc(n.status)} de <b>${fmtDur(n.budget)}</b> (${Math.round(n.ratio * 100)}%)`;
    bindTip(group,
      `<b>${esc(n.key)}</b> · ${esc(n.summary)}<br>` +
      `${esc(n.assignee)} · ${n.points} pts · ${esc(n.status)}<br>` +
      (reloj ? reloj + "<br>" : "") +
      (blockers.length ? `Lo bloquean: <span class="key">${blockers.map(esc).join(", ")}</span><br>` : `Sin bloqueantes: se puede arrancar<br>`) +
      (n.unlocks ? `Destraba ${n.unlocks} tickets más` : "No destraba nada"));

    const enter = () => { if (!pinned) { focus = n.key; paint(); } };
    const leave = () => { if (!pinned) { focus = null; paint(); } };
    group.addEventListener("pointerenter", enter);
    group.addEventListener("pointerleave", leave);
    group.addEventListener("focus", enter);
    group.addEventListener("blur", leave);
    group.addEventListener("click", () => {
      if (pinned && focus === n.key) { pinned = false; focus = null; }
      else { pinned = true; focus = n.key; }
      save();
      paint();
    });
    group.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); group.click(); }
    });

    nodeLayer.appendChild(group);
    nodeEls.push({ n, group, box, key, pts });
  }

  // ── Pintado ──
  function paint() {
    const up = focus ? walk(focus, preds) : null;
    const down = focus ? walk(focus, succs) : null;

    for (const { n, group, box, key } of nodeEls) {
      const mine = !person || n.assignee === person;
      const free = available(n);
      const inCascade = focus && (n.key === focus || up.has(n.key) || down.has(n.key));

      let dim = false;
      if (person && !mine) dim = true;
      if (onlyAvailable && !free) dim = true;
      if (focus && !inCascade) dim = true;

      // El color codifica SIEMPRE el estado. Filtrar por persona se comunica
      // atenuando al resto, nunca repintando: si el anillo azul de selección
      // pisara al verde, se perdería justo lo que se quiere ver — cuál de mis
      // tickets puedo agarrar ya.
      if (n.bucket === "done") {
        box.setAttribute("fill", cssVar("--o3"));
        box.setAttribute("fill-opacity", 1);
        box.setAttribute("stroke", cssVar("--o3"));
      } else if (free) {
        box.setAttribute("fill", cssVar("--good"));
        box.setAttribute("fill-opacity", 0.14);
        box.setAttribute("stroke", cssVar("--good"));
      } else {
        box.setAttribute("fill", cssVar("--surface-2"));
        box.setAttribute("fill-opacity", 1);
        box.setAttribute("stroke", cssVar("--rule"));
      }
      box.setAttribute("stroke-width", free ? 1.75 : 1);
      key.setAttribute("fill", n.bucket === "done" ? cssVar("--surface") : cssVar("--ink"));

      const badgeEl = group.querySelector(".tree__badge");
      if (badgeEl) {
        badgeEl.setAttribute("fill", cssVar(n.severity === "late" ? "--critical" : "--warn"));
      }

      group.style.opacity = dim ? 0.14 : 1;
      group.classList.toggle("is-focus", n.key === focus);
    }

    for (const { path, from, to } of edgeEls) {
      const active = focus && ((from === focus || up.has(from) || down.has(from)) && (to === focus || up.has(to) || down.has(to)));
      const visible = !focus || active;
      path.setAttribute("stroke", active ? cssVar("--s1") : cssVar("--muted"));
      path.setAttribute("stroke-width", active ? 2.25 : 1.25);
      path.style.opacity = visible ? (focus ? 0.95 : 0.42) : 0.06;
    }
  }

  // ── Controles ──
  const bar = document.createElement("div");
  bar.className = "tree__bar";

  const people = [...new Set(nodes.map((n) => n.assignee))].sort();
  const chips = document.createElement("div");
  chips.className = "chips";
  const chipEls = [];
  const addChip = (label, value) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = label;
    b.setAttribute("aria-pressed", String(person === value));
    b.addEventListener("click", () => {
      person = value;
      chipEls.forEach((c) => c.el.setAttribute("aria-pressed", String(c.value === value)));
      save();
      if (onFilterChange) onFilterChange(); // el kanban comparte este filtro
      else paint();
    });
    chips.appendChild(b);
    chipEls.push({ el: b, value });
  };
  addChip("Todo el equipo", null);
  for (const p of people) addChip(p, p);

  const toggle = document.createElement("label");
  toggle.className = "toggle";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = onlyAvailable;
  cb.addEventListener("change", () => { onlyAvailable = cb.checked; save(); paint(); });
  toggle.append(cb, document.createTextNode("Atenuar lo bloqueado"));

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "chip";
  clear.textContent = "Soltar selección";
  clear.addEventListener("click", () => { pinned = false; focus = null; save(); paint(); });

  bar.append(chips, toggle, clear);

  // ── Leyenda ──
  const lg = document.createElement("div");
  lg.className = "legend";
  lg.innerHTML =
    `<span class="legend__item"><span class="legend__swatch" style="background:var(--surface);border:1.75px solid var(--good)"></span>Se puede arrancar</span>` +
    `<span class="legend__item"><span class="legend__swatch" style="background:var(--surface-2);border:1px solid var(--rule)"></span>Bloqueado</span>` +
    `<span class="legend__item"><span class="legend__swatch" style="background:var(--o3)"></span>Hecho</span>` +
    `<span class="legend__item"><span class="legend__swatch" style="background:var(--critical);border-radius:50%;width:9px;height:9px"></span>Pasado de tiempo</span>` +
    `<span class="legend__item" style="color:var(--muted)">Pasá el mouse por un nodo para ver su cascada · clic para fijarla</span>`;

  const scroller = document.createElement("div");
  scroller.className = "tree__scroll";
  scroller.appendChild(g);
  // El scroll también es estado del usuario: se restaura tras cada refresco.
  requestAnimationFrame(() => { scroller.scrollLeft = state.scrollLeft || 0; });
  scroller.addEventListener("scroll", () => { state.scrollLeft = scroller.scrollLeft; }, { passive: true });

  paint();

  const wrap = document.createElement("div");
  wrap.className = "tree";
  wrap.append(bar, scroller, lg);
  return wrap;
}
