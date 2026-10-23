// API de la Agenda de Guardias: guarda cada turno en Netlify Blobs.
// Protegida con un PIN compartido (variable de entorno AGENDA_PIN).
import { getStore } from "@netlify/blobs";

const TIPOS = ["g24", "g12", "noc", "fel", "con", "plan", "otro"];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const texto = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function limpiar(body) {
  if (!body || typeof body !== "object") return null;
  const tipo = TIPOS.includes(body.tipo) ? body.tipo : null;
  const fecha = typeof body.fecha === "string" && FECHA.test(body.fecha) ? body.fecha : null;
  if (!tipo || !fecha) return null;
  const ini = typeof body.ini === "string" && HORA.test(body.ini) ? body.ini : "";
  const fin = typeof body.fin === "string" && HORA.test(body.fin) ? body.fin : "";
  return {
    tipo, fecha, ini, fin,
    lugar: texto(body.lugar, 80),
    nota: texto(body.nota, 300),
    creadoPor: texto(body.creadoPor, 40),
  };
}

function iguales(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export default async (req) => {
  const pin = Netlify.env.get("AGENDA_PIN");
  if (!pin) return json({ error: "Falta configurar AGENDA_PIN en Netlify." }, 500);
  if (!iguales(req.headers.get("x-agenda-pin") || "", pin)) return json({ error: "PIN incorrecto." }, 401);

  const store = getStore({ name: "agenda-guardias", consistency: "strong" });
  const id = new URL(req.url).searchParams.get("id");
  const idValido = id && /^[a-f0-9-]{36}$/.test(id);

  try {
    if (req.method === "GET") {
      const { blobs } = await store.list({ prefix: "t/" });
      const items = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
      return json(items.filter(Boolean));
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      const lista = Array.isArray(body) ? body.slice(0, 30) : [body];
      const creados = [];
      for (const b of lista) {
        const t = limpiar(b);
        if (!t) return json({ error: "Datos del turno incompletos." }, 400);
        const nuevo = { ...t, id: crypto.randomUUID(), creado: Date.now() };
        await store.setJSON("t/" + nuevo.id, nuevo);
        creados.push(nuevo);
      }
      return json(creados, 201);
    }

    if (req.method === "PUT") {
      if (!idValido) return json({ error: "Falta el turno a editar." }, 400);
      const prev = await store.get("t/" + id, { type: "json" });
      if (!prev) return json({ error: "Ese turno ya no existe." }, 404);
      const t = limpiar(await req.json().catch(() => null));
      if (!t) return json({ error: "Datos del turno incompletos." }, 400);
      const act = { ...t, id, creado: prev.creado, creadoPor: prev.creadoPor || t.creadoPor, editado: Date.now() };
      await store.setJSON("t/" + id, act);
      return json(act);
    }

    if (req.method === "DELETE") {
      if (!idValido) return json({ error: "Falta el turno a eliminar." }, 400);
      await store.delete("t/" + id);
      return json({ ok: true });
    }

    return json({ error: "Método no permitido." }, 405);
  } catch (e) {
    return json({ error: "Error del servidor. Probá de nuevo." }, 500);
  }
};

export const config = { path: "/api/turnos" };
