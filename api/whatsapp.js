import { metric } from "@vercel/functions";
import { getAIStatus, processCoherentMessage } from "./_lib/assistant.js";
import { getStorageStatus, isMessageAlreadyProcessed } from "./_lib/db.js";

/**
 * Envía un mensaje de texto usando la API Oficial de WhatsApp Cloud (Meta Graph API)
 */
async function sendWhatsAppCloudMessage(phoneNumberId, to, bodyText) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token || !phoneNumberId) {
    console.error("Falta configurar WHATSAPP_ACCESS_TOKEN o phoneNumberId.");
    return false;
  }

  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: bodyText },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Error enviando mensaje a WhatsApp Cloud API:", response.status, errText);
    return false;
  }
  return true;
}

/**
 * Marca el mensaje entrante de WhatsApp como leído (doble check azul)
 */
async function markMessageAsRead(phoneNumberId, messageId) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token || !phoneNumberId || !messageId) return;

  try {
    await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    });
  } catch {
    // No bloquear la respuesta si falla el read receipt
  }
}

function extractIncomingWhatsAppPayload(message) {
  const type = message?.type || "text";
  let text = "";
  let mediaType = null;

  if (type === "text") {
    text = message.text?.body || "";
  } else if (type === "interactive") {
    text =
      message.interactive?.button_reply?.title ||
      message.interactive?.list_reply?.title ||
      "";
  } else if (type === "button") {
    text = message.button?.text || "";
  } else if (["image", "document", "video", "audio", "sticker"].includes(type)) {
    mediaType = type;
    text = message[type]?.caption || "";
  }

  return { text: text.trim(), mediaType };
}

/**
 * GET /api/whatsapp
 * - Verifica el Webhook ante Meta for Developers (hub.mode, hub.verify_token, hub.challenge)
 * - Si se visita desde el navegador, muestra el estado del webhook, IA y BD
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expectedVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "bazar_copi_art_2026";

  if (mode === "subscribe") {
    if (token === expectedVerifyToken) {
      metric("whatsapp.webhook.verify", 1, { outcome: "success" });
      return new Response(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    metric("whatsapp.webhook.verify", 1, { outcome: "forbidden" });
    return new Response("Token de verificación inválido", { status: 403 });
  }

  return Response.json({
    ok: true,
    service: "Bazar Copi Art - Asistente Coherente WhatsApp Cloud API & Web IA",
    whatsappNumber: "50664760290",
    whatsappLink: "https://wa.me/50664760290",
    webhookUrl: "https://bazar-copi-art.vercel.app/api/whatsapp",
    aiStatus: getAIStatus(),
    storageStatus: getStorageStatus(),
    configured: {
      hasAccessToken: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
      hasPhoneNumberId: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
      hasCustomVerifyToken: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
      hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    },
  });
}

/**
 * POST /api/whatsapp
 * - Recibe eventos en vivo de Meta WhatsApp Cloud API y responde con coherencia / IA
 * - Soporta `mode: "chat"` y `mode: "simulate"` para el chatbot inteligente de la página web
 */
export async function POST(request) {
  const startedAt = performance.now();

  try {
    const body = await request.json();

    // 1. Modo Chat Inteligente o Simulador desde la página web
    if (body && (body.mode === "chat" || body.mode === "simulate")) {
      const sessionId = body.sessionId || "web-guest";
      const text = body.text || "";
      const clientSession = body.session || null;

      const result = await processCoherentMessage({
        sessionId,
        incomingText: text,
        channel: body.mode === "chat" ? "web_chat" : "web_simulator",
        existingSession: clientSession,
        forceStepMode: Boolean(body.forceStepMode),
      });

      metric("whatsapp.webhook.messages", 1, {
        outcome: "success",
        source: body.mode === "chat" ? "web_chat" : "web_simulator",
        step: result.session?.step || "unknown",
      });

      return Response.json({
        ok: true,
        reply: result.reply,
        session: result.session,
        savedOrder: result.savedOrder,
        aiUsed: result.aiUsed,
        aiProvider: result.aiProvider,
      });
    }

    // 2. Evento oficial de Meta WhatsApp Cloud API
    if (body && body.object === "whatsapp_business_account") {
      const entries = Array.isArray(body.entry) ? body.entry : [];

      for (const entry of entries) {
        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        for (const change of changes) {
          const value = change?.value;
          const messages = Array.isArray(value?.messages) ? value.messages : [];
          const phoneNumberId =
            value?.metadata?.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID;

          for (const message of messages) {
            if (!message?.from) continue;

            // Evitar respuestas duplicadas ante reintentos de Meta
            if (await isMessageAlreadyProcessed(message.id)) {
              continue;
            }

            const from = message.from;
            const { text, mediaType } = extractIncomingWhatsAppPayload(message);

            await markMessageAsRead(phoneNumberId, message.id);

            const result = await processCoherentMessage({
              sessionId: from,
              incomingText: text,
              channel: "whatsapp",
              mediaType,
              whatsappFrom: from,
            });

            await sendWhatsAppCloudMessage(phoneNumberId, from, result.reply);

            // Si se registró un pedido nuevo y hay un número de administración configurado, enviar notificación
            if (result.savedOrder && process.env.OWNER_WHATSAPP_NUMBER) {
              const ord = result.savedOrder;
              const ownerSummary =
                `🔔 *Nuevo Pedido Automático (${ord.id}) - Bazar Copi Art*\n` +
                `• *Cliente:* ${ord.customerName}\n` +
                `• *WhatsApp/Tel:* ${ord.phone || from}\n` +
                (ord.email ? `• *Correo:* ${ord.email}\n` : "") +
                `• *Servicio:* ${ord.serviceName}\n` +
                `• *Detalles:* ${ord.details}\n` +
                (ord.total > 0 ? `• *Estimado:* ₡${ord.total.toLocaleString("es-CR")}\n` : "") +
                `\n📊 _Ya quedó guardado en el CRM y listo para revisar en Excel._`;

              await sendWhatsAppCloudMessage(
                phoneNumberId,
                process.env.OWNER_WHATSAPP_NUMBER,
                ownerSummary
              );
            }

            metric("whatsapp.webhook.messages", 1, {
              outcome: "success",
              source: "whatsapp_cloud",
              step: result.session?.step || "unknown",
            });
          }
        }
      }

      return Response.json({ status: "EVENT_RECEIVED" }, { status: 200 });
    }

    metric("whatsapp.webhook.messages", 1, {
      outcome: "ignored",
      source: "unknown",
      step: "none",
    });
    return Response.json({ ok: true, message: "Evento recibido" }, { status: 200 });
  } catch (error) {
    console.error("Error procesando webhook de WhatsApp:", error);
    metric("whatsapp.webhook.messages", 1, {
      outcome: "error",
      source: "exception",
      step: "error",
    });
    return Response.json(
      { ok: false, error: "Error procesando la solicitud del webhook" },
      { status: 500 }
    );
  } finally {
    metric("whatsapp.webhook.duration_ms", performance.now() - startedAt);
  }
}
