// Formateo de duraciones, compartido por el tablero, el árbol y los gráficos.
//
// Antes esto estaba copiado en tres archivos con las horas por día puestas a
// mano. Al cambiar la jornada en lib/sla.js las copias quedaban mintiendo, así
// que ahora hay una sola y el valor viene del payload (m.sla.hoursPerDay).

let perDay = 24;

/** Lo llama app.js en cada render con lo que dice el backend. */
export function setHoursPerDay(h) {
  if (h > 0) perDay = h;
}

/** Horas → "recién" / "26 min" / "3,9 h" / "1 d 4 h". Espeja formatHours. */
export function dur(hrs) {
  if (hrs === null || hrs === undefined) return "—";
  if (hrs * 60 < 1) return "recién";
  if (hrs < 1) return `${Math.round(hrs * 60)} min`;
  if (hrs < perDay) {
    const v = Math.round(hrs * 10) / 10;
    return `${Number.isInteger(v) ? v : String(v).replace(".", ",")} h`;
  }
  const d = Math.floor(hrs / perDay);
  const r = Math.round(hrs - d * perDay);
  return r ? `${d} d ${r} h` : `${d} d`;
}

/** "el 23/9 a las 20:06" — para poder auditar de dónde sale el reloj. */
export function momento(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  const dia = d.toLocaleDateString("es-AR", { day: "numeric", month: "numeric" });
  // hour12:false explicito: sin el, algunos entornos dan "09:51" para las 21:51.
  const hora = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `el ${dia} a las ${hora}`;
}
