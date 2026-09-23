// Tablero kanban: una columna por estado del flujo, como el de Jira.
// Es de lectura — mover un ticket se hace en Jira y acá se ve al refrescar.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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

const dur = (hrs) => {
  if (hrs === null || hrs === undefined) return "—";
  if (hrs < 1) return `${Math.round(hrs * 60)} min`;
  if (hrs < 12) {
    const v = Math.round(hrs * 10) / 10;
    return `${Number.isInteger(v) ? v : String(v).replace(".", ",")} h`;
  }
  const d = Math.floor(hrs / 12), r = Math.round(hrs - d * 12);
  return r ? `${d} d ${r} h` : `${d} d`;
};

const SEV_CLASS = { late: "pill--crit", warn: "pill--warn", ok: "pill--good" };

/**
 * @param metrics  salida de computeMetrics
 * @param state    estado compartido con el árbol (persona seleccionada)
 * @param onChange se llama al cambiar el filtro, para redibujar el tablero
 */
export function kanbanBoard(metrics, state, onChange) {
  const { flowOrder, byStatus, table } = metrics;
  const colorOf = (name) => ["--o1", "--o2", "--o3", "--o4"][Math.min(flowOrder.indexOf(name), 3)];
  const byKey = new Map(table.map((t) => [t.key, t]));

  // ── Filtro por persona, compartido con el árbol ──
  const chips = h("div", { class: "chips" });
  const mk = (label, value) => {
    const b = h("button", { type: "button", class: "chip" }, label);
    b.setAttribute("aria-pressed", String(state.person === value));
    b.addEventListener("click", () => { state.person = value; onChange(); });
    chips.appendChild(b);
  };
  mk("Todo el equipo", null);
  for (const p of [...new Set(table.map((t) => t.assignee))].sort()) mk(p, p);

  const visible = (t) => !state.person || t.assignee === state.person;

  const columns = flowOrder.map((name) => {
    const meta = byStatus.find((s) => s.name === name) || { tickets: 0, points: 0 };
    const cards = table
      .filter((t) => t.status === name && visible(t))
      // Lo urgente arriba; dentro de To Do, primero lo que más destraba.
      .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || b.unlocks - a.unlocks);
    const pts = cards.reduce((s, t) => s + t.points, 0);

    return h("div", { class: "board__col" }, [
      h("div", { class: "board__head" }, [
        h("span", { class: "board__swatch", style: `background:var(${colorOf(name)})` }),
        h("span", { class: "board__name" }, name),
        h("span", { class: "board__count num" }, `${cards.length} · ${pts} pts`),
      ]),
      cards.length
        ? h("div", { class: "board__cards" }, cards.map((t) => card(t, byKey)))
        : h("p", { class: "board__empty" }, state.person ? "nada de esta persona acá" : "vacío"),
    ]);
  });

  const bar = h("div", { class: "tree__bar" }, [
    chips,
    h("span", { class: "roster__meta" }, "Se mueve desde Jira; acá se ve al refrescar."),
  ]);

  return h("div", { class: "board-wrap" }, [bar, h("div", { class: "board" }, columns)]);
}

function card(t, byKey) {
  const pendientes = (t.blockedBy || []).filter((k) => byKey.get(k) && byKey.get(k).bucket !== "done");
  // "Se puede arrancar" sólo tiene sentido en To Do: un ticket que ya está
  // en curso no hace falta arrancarlo.
  const libre = t.bucket === "todo" && t.severity !== "blocked" && !pendientes.length;

  // El reloj sólo corre desde In Progress. En To Do mostramos la espera como
  // dato gris, sin porcentaje: un ticket que nadie agarró no puede estar vencido.
  const reloj =
    t.severity === "blocked" ? null
    : t.ratio !== null
      ? h("span", { class: `pill ${SEV_CLASS[t.severity] || ""}` }, [
          h("span", { class: "pill__dot" }),
          `${dur(t.age)} · ${Math.round(t.ratio * 100)}%`,
        ])
    : t.age !== null
      ? h("span", { class: "pill", title: "Sin story points: no hay presupuesto que medir" }, dur(t.age))
    : t.waiting !== null
      ? h("span", { class: "pill", title: "Sin arrancar: el reloj corre recién desde In Progress" },
          `espera ${dur(t.waiting)}`)
      : null;

  return h("article", {
    class: `board__card${t.severity === "late" ? " is-late" : ""}`,
    tabindex: "0",
    title: `${t.key} · ${t.summary}\n${t.assignee} · ${t.points} pts · ${t.status}` +
      (t.ratio !== null ? `\nLleva ${dur(t.age)} trabajándose, de ${dur(t.budget)}`
        : t.waiting !== null ? `\nSin arrancar: espera hace ${dur(t.waiting)}` : "") +
      (pendientes.length ? `\nBloqueado por: ${pendientes.join(", ")}` : ""),
  }, [
    h("div", { class: "board__card-top" }, [
      h("span", { class: "key" }, t.key),
      libre ? h("span", { class: "board__free", title: "Sin bloqueantes: se puede arrancar" }) : null,
      h("span", { class: "board__pts num" }, `${t.points}`),
    ]),
    h("p", { class: "board__summary" }, t.summary),
    pendientes.length
      ? h("p", { class: "board__blocked" }, `bloqueado por ${pendientes.slice(0, 3).join(", ")}${pendientes.length > 3 ? ` +${pendientes.length - 3}` : ""}`)
      : null,
    h("div", { class: "board__card-foot" }, [
      h("span", { class: "board__who" }, t.assignee),
      reloj,
    ]),
  ]);
}
