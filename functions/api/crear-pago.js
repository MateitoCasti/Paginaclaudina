// POST /api/crear-pago
import { firestore, lookupUser, getStoreConfig, json, SERVER_TIME } from "../../lib/google.js";

const clean = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DELIVERIES = ["correo", "moto", "retiro"];

export async function onRequestPost({ request, env }) {
    try {
        if (!env.MP_ACCESS_TOKEN) return json(500, { error: "Falta configurar MP_ACCESS_TOKEN." });

        let body;
        try { body = await request.json(); } catch { return json(400, { error: "Datos JSON inválidos." }); }

        const raw = body.buyer || {};
        const buyer = {
            name: clean(raw.name, 120), phone: clean(raw.phone, 40), email: clean(raw.email, 120).toLowerCase(),
            street: clean(raw.street, 120), number: clean(raw.number, 20), city: clean(raw.city, 120), cp: clean(raw.cp, 20)
        };
        const delivery = DELIVERIES.includes(body.delivery) ? body.delivery : null;
        if (!delivery) return json(400, { error: "Elegí una forma de entrega." });
        if (!buyer.name || buyer.phone.replace(/\D/g, "").length < 8) return json(400, { error: "Completá tu nombre y celular." });
        if (!EMAIL_RE.test(buyer.email)) return json(400, { error: "Email inválido." });

        const parsed = (Array.isArray(body.items) ? body.items.slice(0, 50) : []).map((it) => {
            const key = clean(it?.key, 80);
            const idx = key.indexOf(":");
            return { key, type: key.slice(0, idx), id: key.slice(idx + 1), qty: Math.min(20, Math.max(1, parseInt(it?.qty) || 1)) };
        }).filter((p) => (p.type === "p" || p.type === "c") && p.id);

        if (!parsed.length) return json(400, { error: "Tu carrito está vacío." });

        let db;
        try { db = firestore(env); } catch (err) {
            console.error("Error al inicializar Firestore:", err.message);
            return json(500, { error: "Error de configuración en la base de datos." });
        }

        const config = await getStoreConfig(db);
        const snaps = await db.getAll(parsed.map((p) => `${p.type === "c" ? "combos" : "productos"}/${p.id}`));
        const lines = [];

        for (let i = 0; i < parsed.length; i++) {
            const d = snaps[i].exists ? snaps[i].data : null;
            const name = d ? (d.name || d.title || "Producto") : "Producto";
            if (!d || d.active === false || !(Number(d.price) > 0)) {
                return json(409, { error: `"${name}" ya no está disponible.` });
            }
            lines.push({
                key: parsed[i].key,
                name: name,
                price: Math.round(Number(d.price)),
                qty: parsed[i].qty
            });
        }

        const subtotal = lines.reduce((a, l) => a + l.price * l.qty, 0);
        const orderId = db.newId();
        const code = "RM-" + orderId.slice(0, 10).toUpperCase();
        const siteUrl = String(env.SITE_URL || new URL(request.url).origin).replace(/\/$/, "");

        const preference = {
            items: lines.map((l) => ({ id: l.key, title: l.name.slice(0, 250), quantity: Number(l.qty), unit_price: Number(l.price), currency_id: "ARS" })),
            payer: { name: buyer.name, email: buyer.email },
            external_reference: orderId,
            statement_descriptor: "RONDA DE MATE",
            back_urls: {
                success: `${siteUrl}/?pago=aprobado&pedido=${code}`,
                pending: `${siteUrl}/?pago=pendiente&pedido=${code}`,
                failure: `${siteUrl}/?pago=rechazado&pedido=${code}`
            },
            auto_return: "approved",
            notification_url: `${siteUrl}/api/webhook-mercadopago`,
            metadata: { order_code: code }
        };

        const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${String(env.MP_ACCESS_TOKEN).trim()}`,
                "Content-Type": "application/json",
                "X-Idempotency-Key": orderId
            },
            body: JSON.stringify(preference)
        });

        const mpData = await mpRes.json().catch(() => ({}));
        
        if (!mpRes.ok || !mpData.init_point) {
            console.error("MP Error Status:", mpRes.status, JSON.stringify(mpData));
            return json(502, { error: `Mercado Pago rechazó la solicitud: ${mpData.message || JSON.stringify(mpData)}` });
        }

        await db.commit([db.create(`pedidos/${orderId}`, {
            code, buyer, items: lines, delivery,
            payment: "mercadopago", subtotal, total: subtotal,
            status: "esperando_pago",
            mpPreferenceId: mpData.id || null,
            paymentLink: mpData.init_point,
            createdAt: SERVER_TIME
        })]);

        return json(200, { url: mpData.init_point, code });

    } catch (e) {
        console.error("FATAL ERROR EN CREAR-PAGO:", e.stack || e.message);
        return json(500, { error: `Error interno: ${e.message}` });
    }
}
