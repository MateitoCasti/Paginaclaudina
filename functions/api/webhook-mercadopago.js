// POST /api/webhook-mercadopago
// Mercado Pago avisa acá cada vez que un pago cambia de estado.
// Consultamos el pago directamente a Mercado Pago (no confiamos en lo que llega en el aviso),
// marcamos el pedido como pagado, descontamos stock y le mandamos el email al cliente.
import { firestore, getStoreConfig, SERVER_TIME, DELETE_FIELD } from "../../lib/google.js";
import { paymentApprovedEmail, sendEmail } from "../../lib/email.js";

const ok = () => new Response("ok", { status: 200 });
const retry = () => new Response("retry", { status: 500 }); // Mercado Pago vuelve a intentar más tarde

export async function onRequestPost({ request, env }) {
    const url = new URL(request.url);
    let body = {};
    try { body = await request.json(); } catch { /* algunos avisos vienen sin cuerpo */ }

    const topic = url.searchParams.get("type") || url.searchParams.get("topic") || body.type || body.topic;
    const paymentId = url.searchParams.get("data.id") || body?.data?.id || (topic === "payment" ? url.searchParams.get("id") : null);
    if (topic !== "payment" || !paymentId) return ok();

    // ---- 1. Consultar el pago real ----
    let payment;
    try {
        const res = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
            headers: { Authorization: `Bearer ${String(env.MP_ACCESS_TOKEN || "").trim()}` }
        });
        if (res.status === 404) return ok(); // aviso de prueba o pago inexistente
        if (!res.ok) { console.error("No se pudo consultar el pago", paymentId, res.status); return retry(); }
        payment = await res.json();
    } catch (e) {
        console.error("Error consultando el pago:", e.message);
        return retry();
    }

    const orderId = String(payment.external_reference || "");
    if (!orderId || orderId.includes("/")) return ok();

    let db;
    try { db = firestore(env); } catch (e) { console.error(e.message); return retry(); }
    const orderPath = `pedidos/${orderId}`;

    // ---- 2. Actualizar el pedido (transacción: nunca se procesa dos veces) ----
    let approvedNow = false;
    let order = null;
    try {
        await db.runTransaction(async (tx) => {
            approvedNow = false;
            const snap = await tx.get(orderPath);
            if (!snap.exists) return;
            order = snap.data;

            const update = {
                paymentId: String(payment.id),
                paymentStatus: payment.status,
                paymentStatusDetail: payment.status_detail || "",
                paymentType: payment.payment_type_id || "",
                paymentMethod: payment.payment_method_id || "",
                installments: payment.installments || 1,
                paidAmount: payment.transaction_amount ?? null,
                updatedAt: SERVER_TIME
            };

            const isFirstApproval = payment.status === "approved" && order.status === "esperando_pago";
            const stockWrites = [];
            if (isFirstApproval) {
                const items = (order.items || []).map((i) => {
                    const [type, id] = String(i.key).split(":");
                    return { path: `${type === "c" ? "combos" : "productos"}/${id}`, qty: Number(i.qty) || 0 };
                }).filter((i) => i.path.split("/")[1]);
                const itemSnaps = await tx.getAll(items.map((i) => i.path));
                itemSnaps.forEach((s, i) => {
                    if (s.exists && typeof s.data.stock === "number") {
                        stockWrites.push([items[i].path, { stock: Math.max(0, s.data.stock - items[i].qty) }]);
                    }
                });
                update.status = "pagado";
                update.paidAt = SERVER_TIME;
                if (Math.abs(Number(payment.transaction_amount) - Number(order.total)) > 1) {
                    update.paymentAlert = `El monto pagado (${payment.transaction_amount}) no coincide con el total del pedido (${order.total}). Revisalo.`;
                }
            }
            tx.update(orderPath, update);
            stockWrites.forEach(([path, data]) => tx.update(path, data));
            approvedNow = isFirstApproval;
        });
    } catch (e) {
        console.error("Error actualizando el pedido", orderId, e.message);
        return retry();
    }

    // ---- 3. Email al cliente (solo la primera vez que se aprueba) ----
    if (approvedNow && order) {
        try {
            const msg = paymentApprovedEmail(order, payment, await getStoreConfig(db));
            await sendEmail(env, { to: order.buyer?.email, toName: order.buyer?.name, ...msg });
            await db.commit([db.update(orderPath, { emailSentAt: SERVER_TIME, emailError: DELETE_FIELD })]);
        } catch (e) {
            console.error("No se pudo enviar el email del pedido", order.code, e.message);
            await db.commit([db.update(orderPath, { emailError: String(e.message || e).slice(0, 300) })]).catch(() => {});
        }
    }
    return ok();
}
