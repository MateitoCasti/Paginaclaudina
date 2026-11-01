// POST /api/generar-descripcion
// Escribe una descripción de producto con IA. Solo para administradores.
// Usa la IA incluida en Cloudflare (Workers AI, gratis hasta ~80 descripciones por día).
// Si cargás ANTHROPIC_API_KEY en Cloudflare, usa Claude en su lugar (de pago, mejor redacción).
import { lookupUser, json } from "../../lib/google.js";
import { ADMIN_EMAILS } from "../../lib/admins.js";

const CATEGORIES = { mates: "mate", termos: "termo", bombillas: "bombilla", yerbas: "yerba o yuyos", materas: "matera o yerbera" };
const TONES = {
    vendedor: "Tono vendedor y entusiasta, que den ganas de comprarlo.",
    calido: "Tono cálido y cercano, que transmita tradición, ronda de mate y momentos compartidos.",
    corto: "Muy breve y directo: una o dos oraciones.",
};
const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function buildPrompt(p) {
    const datos = [
        `Nombre: ${p.name}`,
        p.category && `Tipo de producto: ${CATEGORIES[p.category] || p.category}`,
        p.badge && `Etiqueta destacada: ${p.badge}`,
        p.notes && `Datos y características que dio el vendedor: ${p.notes}`,
        p.engraving && "Se puede grabar la virola con nombres, frases o logos.",
    ].filter(Boolean).join("\n");
    return `Sos redactor de "Ronda de Mate", una tienda online argentina de mates artesanales, bombillas, termos, yerbas y materas.
Escribí la descripción de este producto para la tienda.

${datos}

Reglas:
- Español rioplatense con voseo (tenés, llevá, disfrutá).
- ${TONES[p.tone] || TONES.vendedor}
- Entre 45 y 80 palabras${p.tone === "corto" ? " (en este caso, menos de 35)" : ""}, en uno o dos párrafos cortos.
- Usá SOLO los datos de arriba. No inventes materiales, medidas, capacidades, colores, garantías ni precios. Si faltan datos, hablá de forma general (uso, regalo, ritual del mate).
- Sin título, sin emojis, sin comillas, sin hashtags, sin listas. Devolvé únicamente el texto de la descripción.`;
}

async function withWorkersAI(env, prompt) {
    if (!env.AI) throw new Error("Falta activar la IA: agregá \"ai\": { \"binding\": \"AI\" } en wrangler.jsonc.");
    const out = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: [
            { role: "system", content: "Respondés solo con el texto pedido, en español rioplatense." },
            { role: "user", content: prompt },
        ],
        max_tokens: 320,
        temperature: 0.7,
    });
    return out?.response ?? out?.choices?.[0]?.message?.content ?? "";
}

async function withClaude(env, prompt) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": String(env.ANTHROPIC_API_KEY).trim(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: env.ANTHROPIC_MODEL || "claude-haiku-5-5", max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Claude respondió ${res.status}: ${data?.error?.message || "error"}`);
    return (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

// Limpia lo que a veces agregan los modelos (comillas, "Descripción:", etc.)
function tidy(text) {
    return String(text || "")
        .trim()
        .replace(/^["“”«»']+|["“”«»']+$/g, "")
        .replace(/^\s*(descripci[oó]n|description)\s*:\s*/i, "")
        .replace(/^["“”«»']+|["“”«»']+$/g, "")
        .replace(/\*\*/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, 1200);
}

export async function onRequestPost({ request, env }) {
    const header = request.headers.get("authorization") || "";
    const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
    const user = idToken ? await lookupUser(env, idToken).catch(() => null) : null;
    if (!user) return json(401, { error: "Tu sesión venció. Cerrá sesión en el panel y volvé a entrar." });
    if (!ADMIN_EMAILS.includes(user.email) || !user.emailVerified) return json(403, { error: "Solo el administrador puede usar esto." });

    let b = {};
    try { b = await request.json(); } catch {}
    const p = {
        name: clean(b.name, 120),
        category: clean(b.category, 30),
        badge: clean(b.badge, 60),
        notes: clean(b.notes, 600),
        engraving: b.engraving === true,
        tone: TONES[b.tone] ? b.tone : "vendedor",
    };
    if (!p.name) return json(400, { error: "Escribí primero el nombre del producto." });

    try {
        const prompt = buildPrompt(p);
        const raw = env.ANTHROPIC_API_KEY ? await withClaude(env, prompt) : await withWorkersAI(env, prompt);
        const description = tidy(raw);
        if (!description) throw new Error("La IA no devolvió texto.");
        return json(200, { description, engine: env.ANTHROPIC_API_KEY ? "claude" : "workers-ai" });
    } catch (e) {
        console.error("Error generando descripción:", e.message);
        const limit = /limit|quota|neuron|429/i.test(e.message);
        return json(502, { error: limit ? "Se alcanzó el límite gratis de IA de hoy. Probá mañana o escribila a mano." : "No se pudo generar la descripción. Probá de nuevo en un rato." });
    }
}
