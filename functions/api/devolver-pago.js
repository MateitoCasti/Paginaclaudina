// POST /api/devolver-pago
// Devuelve el dinero de un pedido pagado con Mercado Pago (reembolso total).
// Solo lo pueden usar los administradores: se verifica la sesión de Firebase.
import { firestore, lookupUser, getStoreConfig, json, SERVER_TIME } from "../../lib/google.js";
import { refundEmail, sendEmail } from "../../lib/email.js";
import { ADMIN_EMAILS } from "../../lib/admins.js";



function mpErrorMessage(status, body) {
    const code = String(body?.cause?.[0]?.code ?? body?.code ?? "");
    const text = String(body?.message || body?.cause?.[0]?.description || "").toLowerCase();
    if (["2024", "15016"].includes(code) || text.includes("too old")) return "Ese pago es demasiado antiguo para devolverlo automáticamente. Hacelo desde la app de Mercado Pago.";
    if (code === "2063" || text.includes("state")) return "Mercado Pago no permite devolver este pago en su estado actual (puede que ya esté devuelto o en revisión).";
    if (text.includes("insufficient") || text.includes("balance") || text.includes("saldo")) return "No tenés saldo suficiente en Mercado Pago para hacer la devolución.";
    if (status === 401) return "Mercado Pago rechazó la clave (MP_ACCESS_TOKEN). Revisala en Cloudflare.";
    if (status === 404) return "Mercado Pago no encontró ese pago.";
    return `Mercado Pago rechazó la devolución${body?.message ? `: ${body.message}` : "."}`;
}

export async function onRequestPost({ request, env }) {
    if (!env.MP_ACCESS_TOKEN) return json(500, { error: "Falta MP_ACCESS_TOKEN en Cloudflare." });

    // ---- 1. Solo el administrador ----
    const header = request.headers.get("authorization") || "";
    const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!idToken) return json(401, { error: "Iniciá sesión en el panel de nuevo." });
    const user = await lookupUser(env, idToken).catch(() => null);
    if (!user) return json(401, { error: "Tu sesión venció. Cerrá sesión en el panel y volvé a entrar." });
    if (!ADMIN_EMAILS.includes(user.email) || !user.emailVerified) return json(403, { error: "Solo el administrador puede devolver pagos." });

    let body = {};
    try { body = await request.json(); } catch {}
    const orderId = String(body.orderId || "");
    if (!orderId || orderId.includes("/")) return json(400, { error: "Pedido inválido." });

    let db;
    try { db = firestore(env); } catch (e) { return json(500, { error: e.message }); }
    const orderPath = `pedidos/${orderId}`;
    const snap = await db.get(orderPath);
    if (!snap.exists) return json(404, { error: "No encontramos ese pedido." });
    const order = snap.data;

    if (order.payment !== "mercadopago" || !order.paymentId) return json(400, { error: "Este pedido no tiene un pago de Mercado Pago para devolver." });
    if (order.refundedAt || order.paymentStatus === "refunded") return json(409, { error: "Este pedido ya fue devuelto." });

    // ---- 2. Reembolso total en Mercado Pago ----
    let refund;
    try {
        const res = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(order.paymentId)}/refunds`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${String(env.MP_ACCESS_TOKEN).trim()}`,
                "Content-Type": "application/json",
                "X-Idempotency-Key": `refund-${orderId}` // si se toca dos veces, no devuelve dos veces
            },
            body: JSON.stringify({})
        });
        refund = await res.json().catch(() => ({}));
        if (!res.ok) {
            console.error("Mercado Pago rechazó la devolución:", res.status, JSON.stringify(refund));
            return json(502, { error: mpErrorMessage(res.status, refund) });
        }
    } catch (e) {
        console.error("Error conectando con Mercado Pago:", e.message);
        return json(502, { error: "No pudimos conectar con Mercado Pago. Probá de nuevo en unos minutos." });
    }
    const amount = Number(refund.amount) || Number(order.paidAmount) || Number(order.total) || 0;

    // ---- 3. Cancelar el pedido y reponer el stock (una sola vez) ----
    try {
        await db.runTransaction(async (tx) => {
            const cur = (await tx.get(orderPath)).data || {};
            const restoreStock = !cur.stockRestored && !!cur.paidAt; // el stock se había descontado al aprobarse el pago
            if (restoreStock) {
                const items = (cur.items || []).map((i) => {
                    const [type, id] = String(i.key).split(":");
                    return { path: `${type === "c" ? "combos" : "productos"}/${id}`, qty: Number(i.qty) || 0 };
                }).filter((i) => i.path.split("/")[1]);
                const snaps = await tx.getAll(items.map((i) => i.path));
                snaps.forEach((s, i) => {
                    if (s.exists && typeof s.data.stock === "number") tx.update(items[i].path, { stock: s.data.stock + items[i].qty });
                });
            }
            tx.update(orderPath, {
                status: "cancelado",
                paymentStatus: "refunded",
                refundId: refund.id != null ? String(refund.id) : null,
                refundAmount: amount,
                refundedAt: SERVER_TIME,
                updatedAt: SERVER_TIME,
                ...(restoreStock ? { stockRestored: true } : {})
            });
        });
    } catch (e) {
        console.error("Devolución hecha pero no se pudo actualizar el pedido", orderId, e.message);
        return json(200, { ok: true, amount, warning: "La devolución se hizo, pero no se pudo actualizar el pedido. Marcalo como cancelado a mano." });
    }

    // ---- 4. Aviso al cliente ----
    let emailSent = false;
    try {
        const msg = refundEmail(order, amount, await getStoreConfig(db));
        await sendEmail(env, { to: order.buyer?.email, toName: order.buyer?.name, ...msg });
        await db.commit([db.update(orderPath, { refundEmailSentAt: SERVER_TIME })]);
        emailSent = true;
    } catch (e) {
        console.error("No se pudo enviar el email de devolución", order.code, e.message);
    }
    return json(200, { ok: true, amount, emailSent });
}
