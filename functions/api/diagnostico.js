// GET /api/diagnostico
// Revisa que las variables estén cargadas y que cada servicio acepte su clave.
// No muestra ningún valor secreto.
import { firestore, getStoreConfig } from "../../lib/google.js";

const VARS = ["MP_ACCESS_TOKEN", "FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY", "BREVO_API_KEY", "EMAIL_FROM"];

export async function onRequestGet({ env }) {
    const out = { variables: {}, pruebas: {} };
    for (const name of VARS) {
        const v = String(env[name] ?? "").trim();
        let s = env[name] === undefined ? "❌ NO EXISTE (revisá el nombre exacto)" : !v ? "❌ VACÍA" : `✅ cargada (${v.length} caracteres)`;
        if (v && name === "MP_ACCESS_TOKEN") {
            if (v.startsWith("TEST-")) s += " ⚠️ es de PRUEBA: usá la de Producción";
            else if (!v.startsWith("APP_USR-") || v.length < 50) s += " ⚠️ parece la Public Key: copiá el Access Token";
        }
        if (v && name === "FIREBASE_CLIENT_EMAIL" && !v.endsWith("gserviceaccount.com")) s += " ⚠️ tiene que terminar en gserviceaccount.com (está en el .json, línea client_email)";
        if (v && name === "FIREBASE_PRIVATE_KEY" && !v.includes("BEGIN PRIVATE KEY")) s += " ⚠️ copiala completa, desde -----BEGIN PRIVATE KEY-----";
        if (v && name === "EMAIL_FROM" && !v.includes("@")) s += " ⚠️ tiene que ser un email";
        out.variables[name] = s;
    }

    // Prueba real con Firebase
    try {
        const db = firestore(env);
        const cfg = await getStoreConfig(db);
        const snap = await db.get("tienda/configuracion");
        out.pruebas.firebase = snap.exists ? "✅ conecta y lee la configuración de la tienda" : `✅ conecta (todavía no guardaste la configuración desde el panel; WhatsApp por defecto: ${cfg.whatsapp ? "sí" : "no"})`;
    } catch (e) {
        out.pruebas.firebase = "❌ " + e.message;
    }

    // Prueba real con Mercado Pago
    if (env.MP_ACCESS_TOKEN) {
        try {
            const r = await fetch("https://api.mercadopago.com/users/me", { headers: { Authorization: `Bearer ${String(env.MP_ACCESS_TOKEN).trim()}` } });
            out.pruebas.mercadopago = r.ok ? "✅ acepta el Access Token" : `❌ rechaza el Access Token (${r.status})`;
        } catch { out.pruebas.mercadopago = "❌ no se pudo conectar"; }
    }

    // Prueba real con Brevo
    if (env.BREVO_API_KEY) {
        try {
            const r = await fetch("https://api.brevo.com/v3/account", { headers: { "api-key": String(env.BREVO_API_KEY).trim(), Accept: "application/json" } });
            out.pruebas.brevo = r.ok ? "✅ acepta la API key" : `❌ rechaza la API key (${r.status})`;
        } catch { out.pruebas.brevo = "❌ no se pudo conectar"; }
    }

    return new Response(JSON.stringify(out, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });
}
