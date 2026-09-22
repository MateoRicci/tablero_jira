// Gráficos en SVG a mano. Especificaciones fijas: barras <=24px con punta
// redondeada de 4px, líneas de 2px, marcadores r>=4 con anillo de 2px del
// color de la superficie, grilla hairline sólida, y separación de 2px entre
// tramos apilados hecha con hueco, nunca con borde.

const NS = "http://www.w3.org/2000/svg";
export const GAP = 2;          // hueco de superficie entre tramos
export const BAR_MAX = 24;     // grosor máximo de barra
const CAP = 4;                 // radio de la punta de dato

export const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const k of [].concat(kids)) if (k) n.appendChild(k);
  return n;
};

export const text = (str, attrs = {}) => {
  const n = el("text", attrs);
  n.textContent = str;
  return n;
};

export function svg(width, height, attrs = {}) {
  return el("svg", {
    class: "chart",
    viewBox: `0 0 ${width} ${height}`,
    width: "100%",
    height,
    preserveAspectRatio: "xMinYMin meet",
    ...attrs,
  });
}

/** Rectángulo con la punta redondeada sólo del lado del dato. */
export function capsule(x, y, w, h, side) {
  if (w <= 0 || h <= 0) return null;
  const r = Math.min(CAP, side === "right" || side === "left" ? w : h, side === "top" || side === "bottom" ? h : w);
  if (r <= 0.5) return el("rect", { x, y, width: w, height: h });
  const d = {
    right: `M${x},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x} Z`,
    left: `M${x + w},${y} H${x + r} A${r},${r} 0 0 0 ${x},${y + r} V${y + h - r} A${r},${r} 0 0 0 ${x + r},${y + h} H${x + w} Z`,
    top: `M${x},${y + h} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h} Z`,
    bottom: `M${x},${y} V${y + h - r} A${r},${r} 0 0 0 ${x + r},${y + h} H${x + w - r} A${r},${r} 0 0 0 ${x + w},${y + h - r} V${y} Z`,
  }[side];
  return el("path", { d });
}

/** Escala lineal simple. */
export const scale = (d0, d1, r0, r1) => (v) => (d1 === d0 ? r0 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));

/**
 * Ticks redondos para un eje de valores. El último SIEMPRE queda por encima
 * del máximo: si el tope del eje cae por debajo del dato, la serie se dibuja
 * fuera del área y se monta sobre el resto de la tarjeta.
 */
export function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const top = Math.ceil(max / step) * step;
  const out = [];
  for (let v = 0; v <= top + step * 1e-6; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

/** Tinta legible sobre un relleno: blanco o ink según su luminancia. */
export function readableOn(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return cssVar("--ink");
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.42 ? "#0b0b0b" : "#ffffff";
}

// ── Tooltip compartido ────────────────────────────────────────────────────
const tip = () => document.getElementById("tip");

export function bindTip(node, html) {
  const move = (e) => {
    const t = tip();
    t.innerHTML = html;
    t.dataset.show = "1";
    t.setAttribute("aria-hidden", "false");
    const box = t.getBoundingClientRect();
    const x = Math.min(e.clientX + 14, window.innerWidth - box.width - 8);
    const y = Math.max(8, e.clientY - box.height - 12);
    t.style.left = `${x}px`;
    t.style.top = `${y}px`;
  };
  const hide = () => {
    const t = tip();
    t.dataset.show = "0";
    t.setAttribute("aria-hidden", "true");
  };
  node.addEventListener("pointermove", move);
  node.addEventListener("pointerenter", move);
  node.addEventListener("pointerleave", hide);
  node.addEventListener("focus", (e) => {
    const r = node.getBoundingClientRect();
    move({ clientX: r.left + r.width / 2, clientY: r.top });
  });
  node.addEventListener("blur", hide);
  return node;
}

/** Leyenda HTML — siempre presente a partir de dos series. */
export function legend(series, { line = false } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "legend";
  for (const s of series) {
    const item = document.createElement("span");
    item.className = "legend__item";
    const sw = document.createElement("span");
    sw.className = line ? "legend__line" : "legend__swatch";
    sw.style.background = s.color;
    item.append(sw, document.createTextNode(s.label));
    wrap.appendChild(item);
  }
  return wrap;
}

export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
