// POST /api/visita
// Suma una visita a la tienda en Firestore (colección "visitas", un documento por día).
// No guarda datos personales: solo contadores (vistas, visitantes, de dónde vienen y desde qué dispositivo).
import { firestore, increment, SERVER_TIME } from "../../lib/google.js";

const SOURCES = ["instagram", "whatsapp", "facebook", "google", "tiktok", "directo", "otros"];
const DEVICES = ["celular", "computadora"];
const BOTS = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|headless|lighthouse/i;
const noContent = () => new Response(null, { status: 204 });

export async function onRequestPost({ request, env }) {
    if (BOTS.test(request.headers.get("user-agent") || "")) return noContent();
    let b = {};
    try { b = await request.json(); } catch { return noContent(); }

    const day = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); // fecha de Argentina
    const newToday = b.nv === true;
    const data = { views: increment(1), updatedAt: SERVER_TIME };
    if (newToday) {
        data.visitors = increment(1);
        data["src_" + (SOURCES.includes(b.src) ? b.src : "otros")] = increment(1);
        data["dev_" + (DEVICES.includes(b.dev) ? b.dev : "celular")] = increment(1);
        if (b.first === true) data.newVisitors = increment(1);
    }
    try {
        const db = firestore(env);
        await db.commit([db.upsert(`visitas/${day}`, data)]);
    } catch (e) {
        console.error("No se pudo registrar la visita:", e.message);
    }
    return noContent();
}
