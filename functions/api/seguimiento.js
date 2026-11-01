// GET /api/seguimiento?codigo=RM-XXXXXXXXXX
// Devuelve únicamente el estado y los datos mínimos para que el cliente siga su pedido.
import { firestore, json } from "../../lib/google.js";

const STATUS_LABELS = {
    esperando_pago: "Esperando pago",
    nuevo: "Pedido recibido",
    pagado: "Pago confirmado",
    enviado: "Pedido enviado",
    entregado: "Entregado",
    cancelado: "Cancelado"
};
const cleanCode = (value) => String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
const asIso = (value) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export async function onRequestGet({ request, env }) {
    const url = new URL(request.url);
    const code = cleanCode(url.searchParams.get("codigo"));

    if (/^RM-[A-Z0-9]{6}$/.test(code)) {
        return json(410, { ok: false, error: "Este código pertenece al formato anterior y no permite seguimiento online. Escribinos por WhatsApp y te ayudamos." });
    }
    if (!/^RM-[A-Z0-9]{10}$/.test(code)) {
        return json(400, { ok: false, error: "Ingresá el código completo de 10 caracteres después de RM- (por ejemplo, RM-A3F9K2M8Q1)." });
    }

    try {
        const db = firestore(env);
        const result = await db.findOneByField("pedidos", "code", code, [
            "code", "status", "trackingNumber", "delivery", "createdAt", "updatedAt"
        ]);
        if (!result.exists) return json(404, { ok: false, error: "No encontramos ese pedido. Revisá el código e intentá nuevamente." });

        const order = result.data || {};
        const status = Object.prototype.hasOwnProperty.call(STATUS_LABELS, order.status) ? order.status : "nuevo";
        return json(200, {
            ok: true,
            order: {
                code: String(order.code || code),
                status,
                statusLabel: STATUS_LABELS[status],
                trackingNumber: String(order.trackingNumber || "").trim().slice(0, 60) || null,
                delivery: ["correo", "moto", "retiro"].includes(order.delivery) ? order.delivery : null,
                createdAt: asIso(order.createdAt),
                updatedAt: asIso(order.updatedAt) || asIso(order.createdAt)
            }
        });
    } catch (error) {
        console.error("Error consultando seguimiento:", error?.message || error);
        return json(500, { ok: false, error: "No pudimos consultar el pedido en este momento. Probá nuevamente en unos minutos." });
    }
}
