// Enlace de suscripción (.ics) para ver las guardias en Google Calendar, iPhone, etc.
// El enlace lleva una clave derivada del PIN: si cambiás AGENDA_PIN, el enlace viejo deja de funcionar.
import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const TIPOS = {
  g24: "Guardia 24 h",
  g12: "Guardia 12 h",
  noc: "Guardia nocturna",
  fel: "Fellowship / cardiología",
  con: "Consultorio / otro trabajo",
  plan: "Plan compartido",
  otro: "Otro",
};
const GUARDIAS = new Set(["g24", "g12", "noc"]);
const OFFSET_H = 3; // Argentina: UTC-3 todo el año

const claveFeed = (pin) => createHash("sha256").update("agenda-feed:" + pin).digest("hex").slice(0, 32);

const p2 = (n) => String(n).padStart(2, "0");
function utc(fecha, hora) {
  const [y, m, d] = fecha.split("-").map(Number);
  const [h, mi] = hora.split(":").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, h + OFFSET_H, mi));
  return `${t.getUTCFullYear()}${p2(t.getUTCMonth() + 1)}${p2(t.getUTCDate())}T${p2(t.getUTCHours())}${p2(t.getUTCMinutes())}00Z`;
}
function sumarDias(fecha, n) {
  const [y, m, d] = fecha.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}${p2(t.getUTCMonth() + 1)}${p2(t.getUTCDate())}`;
}
const aMin = (h) => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };
const escICS = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");

// Las líneas de un .ics no deben pasar de 75 bytes
function plegar(linea) {
  const bytes = Buffer.from(linea, "utf8");
  if (bytes.length <= 75) return linea;
  const partes = [];
  let actual = "";
  for (const ch of linea) {
    const limite = partes.length ? 74 : 75;
    if (Buffer.byteLength(actual + ch, "utf8") > limite) { partes.push(actual); actual = ""; }
    actual += ch;
  }
  partes.push(actual);
  return partes.join("\r\n ");
}

function evento(e, ahora) {
  const titulo = (TIPOS[e.tipo] || "Turno") + (e.lugar ? " · " + e.lugar : "");
  const desc = [e.nota, e.creadoPor ? "Cargó: " + e.creadoPor : ""].filter(Boolean).join("\n");
  const L = [
    "BEGIN:VEVENT",
    `UID:${e.id}@agenda-guardias`,
    `DTSTAMP:${ahora}`,
    `SUMMARY:${escICS(titulo)}`,
  ];
  if (e.ini) {
    let fin = e.fin || "";
    let finFecha = e.fecha;
    if (!fin) {
      const m = aMin(e.ini) + 60;
      fin = p2(Math.floor(m / 60) % 24) + ":" + p2(m % 60);
      if (m >= 1440) finFecha = sumarDias(e.fecha, 1).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
    } else if (aMin(fin) <= aMin(e.ini)) {
      finFecha = sumarDias(e.fecha, 1).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
    }
    L.push(`DTSTART:${utc(e.fecha, e.ini)}`, `DTEND:${utc(finFecha, fin)}`);
  } else {
    L.push(`DTSTART;VALUE=DATE:${e.fecha.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${sumarDias(e.fecha, 1)}`);
  }
  if (desc) L.push(`DESCRIPTION:${escICS(desc)}`);
  if (e.lugar) L.push(`LOCATION:${escICS(e.lugar)}`);
  L.push(`CATEGORIES:${escICS(TIPOS[e.tipo] || "Otro")}`);
  if (GUARDIAS.has(e.tipo) && e.ini) {
    // Aviso la noche anterior (12 h antes) y 1 h antes
    L.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escICS(titulo)}`, "TRIGGER:-PT12H", "END:VALARM");
    L.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escICS(titulo)}`, "TRIGGER:-PT1H", "END:VALARM");
  }
  L.push("END:VEVENT");
  return L;
}

export default async (req) => {
  const pin = (globalThis.Netlify?.env?.get("AGENDA_PIN") || process.env.AGENDA_PIN || "").trim();
  if (!pin) return new Response("Falta configurar AGENDA_PIN en Netlify.", { status: 500 });
  const k = new URL(req.url).searchParams.get("k") || "";
  if (k !== claveFeed(pin)) return new Response("Enlace no válido.", { status: 403 });

  const store = getStore({ name: "agenda-guardias", consistency: "strong" });
  const { blobs } = await store.list({ prefix: "t/" });
  const items = (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter((e) => e && e.fecha && e.id);

  // Solo desde 60 días atrás, para que el calendario no se llene de historia
  const desde = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const ahora = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lineas = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Agenda de Guardias//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Agenda de Guardias",
    "X-WR-TIMEZONE:America/Argentina/Buenos_Aires",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of items.filter((e) => e.fecha >= desde).sort((a, b) => a.fecha.localeCompare(b.fecha))) lineas.push(...evento(e, ahora));
  lineas.push("END:VCALENDAR");

  return new Response(lineas.map(plegar).join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="agenda-guardias.ics"',
      "cache-control": "no-cache",
    },
  });
};

export const config = { path: "/api/calendario.ics" };
