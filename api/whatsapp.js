import { getCache, metric } from "@vercel/functions";

/**
 * Catálogo oficial de servicios por número para el menú de WhatsApp de Bazar Copi Art
 */
const SERVICE_MENU = {
  "1": "1. Fotocopias (B/N ₡20 | Color ₡75)",
  "2": "2. Copias de cédula (B/N ₡60 | Color ₡180)",
  "3": "3. Impresiones (B/N ₡50 | Color ₡100)",
  "4": "4. Folletos (₡20 por pág. · Precio especial a docentes)",
  "5": "5. Emplasticado (Desde ₡600 según tamaño)",
  "6": "6. Tarjetas de presentación (1 lado ₡2.000 | 2 lados ₡2.500)",
  "7": "7. Facturas (Desde ₡3.000) o Volantes Bond (100 uds ₡5.000)",
  "8": "8. Artículos de papelería (Personalizada desde ₡8.000 | 50 Stickers ₡2.500)",
  "9": "9. Artículos de regalo (Separadores ₡1.500 | Tazas ₡1.700 | Bolsos ₡3.000 | Peluches desde ₡2.500 | Broches ₡600/₡1.000)",
};

const SESSION_TTL_SECONDS = 3600; // 1 hora por sesión

async function loadSession(sessionId) {
  try {
    const cache = getCache({ namespace: "whatsapp-bot" });
    const data = await cache.get(`session:${sessionId}`);
    if (data && typeof data === "object") {
      return data;
    }
  } catch (err) {
    console.error("Error leyendo sesión desde Runtime Cache:", err);
  }
  return null;
}

async function saveSession(sessionId, sessionData) {
  try {
    const cache = getCache({ namespace: "whatsapp-bot" });
    await cache.set(`session:${sessionId}`, sessionData, {
      ttl: SESSION_TTL_SECONDS,
      tags: ["whatsapp-sessions"],
      name: "whatsapp-conversation-state",
    });
  } catch (err) {
    console.error("Error guardando sesión en Runtime Cache:", err);
  }
}

function buildNumberedMenuText(customerName) {
  return (
    `¡Excelente, *${customerName}*! Ya registramos tus datos de contacto. 📝\n\n` +
    `*Paso 4 de 4:* Responde únicamente con el *NÚMERO (del 1 al 9)* del servicio o producto que necesitas:\n\n` +
    `*1.* Fotocopias (B/N ₡20 | Color ₡75)\n` +
    `*2.* Copias de cédula (B/N ₡60 | Color ₡180)\n` +
    `*3.* Impresiones (B/N ₡50 | Color ₡100)\n` +
    `*4.* Folletos (₡20 por pág. · Precio especial a docentes)\n` +
    `*5.* Emplasticado (Desde ₡600 según tamaño)\n` +
    `*6.* Tarjetas de presentación (1 lado ₡2.000 | 2 lados ₡2.500)\n` +
    `*7.* Facturas (Desde ₡3.000) o Volantes Bond (100 uds ₡5.000)\n` +
    `*8.* Artículos de papelería (Personalizada desde ₡8.000 | 50 Stickers ₡2.500)\n` +
    `*9.* Artículos de regalo (Separadores ₡1.500 | Tazas ₡1.700 | Bolsos ₡3.000 | Peluches desde ₡2.500 | Broches ₡600/₡1.000)`
  );
}

/**
 * Procesa el mensaje entrante según el paso actual del cliente
 */
export async function processConversationStep(sessionId, incomingText, existingSession = null) {
  const cleanText = (incomingText || "").trim();
  const lower = cleanText.toLowerCase();

  let session = existingSession || (await loadSession(sessionId));

  const isResetKeyword =
    !session ||
    lower === "hola" ||
    lower === "inicio" ||
    lower === "menu" ||
    lower === "menú" ||
    lower === "reiniciar" ||
    lower === "nuevo" ||
    lower === "empezar";

  // Inicio o reinicio de conversación
  if (isResetKeyword || session.step === "COMPLETED") {
    const newSession = {
      step: "ASK_NAME",
      name: "",
      phone: "",
      email: "",
      serviceNumber: "",
      serviceName: "",
      details: "",
      updatedAt: Date.now(),
    };
    await saveSession(sessionId, newSession);

    const reply =
      `¡Hola! 👋 Bienvenido(a) al asistente automático de *Bazar Copi Art* _(Cercanía, inmediatez y calidad en un mismo lugar)_.\n\n` +
      `🕒 *Horario:* L-V 6:30 a.m. – 4:30 p.m. | Sáb 9:00 a.m. – 1:00 p.m. _(Domingos pedidos por encargo para retirar lunes)_.\n\n` +
      `Para registrar tu pedido paso a paso, por favor escríbenos primero tu *nombre completo* _(Paso 1 de 4)_:`;

    return { reply, session: newSession };
  }

  // Paso 1: Recibir Nombre -> Pedir Teléfono
  if (session.step === "ASK_NAME") {
    if (cleanText.length < 2) {
      return {
        reply: "Por favor indícanos tu *nombre completo* para continuar con el registro:",
        session,
      };
    }

    session.name = cleanText;
    session.step = "ASK_PHONE";
    session.updatedAt = Date.now();
    await saveSession(sessionId, session);

    const reply =
      `¡Muchas gracias, *${session.name}*! 😊\n\n` +
      `*Paso 2 de 4:* Por favor indícanos tu *número de teléfono* de contacto (por ejemplo: 8888-8888):`;

    return { reply, session };
  }

  // Paso 2: Recibir Teléfono -> Pedir Correo
  if (session.step === "ASK_PHONE") {
    const digitsOnly = cleanText.replace(/\D/g, "");
    if (digitsOnly.length < 7) {
      return {
        reply: "Por favor ingresa un *número de teléfono válido* (ej. 8888-8888):",
        session,
      };
    }

    session.phone = cleanText;
    session.step = "ASK_EMAIL";
    session.updatedAt = Date.now();
    await saveSession(sessionId, session);

    const reply =
      `Perfecto, teléfono registrado (${session.phone}). 📱\n\n` +
      `*Paso 3 de 4:* Ahora escríbenos tu *correo electrónico* (ej. nombre@correo.com):`;

    return { reply, session };
  }

  // Paso 3: Recibir Correo -> Mostrar Menú Numérico (1 al 9)
  if (session.step === "ASK_EMAIL") {
    if (!cleanText.includes("@") || !cleanText.includes(".")) {
      return {
        reply: "Por favor escribe un *correo electrónico válido* que incluya '@' (ej. cliente@correo.com):",
        session,
      };
    }

    session.email = cleanText;
    session.step = "ASK_SERVICE";
    session.updatedAt = Date.now();
    await saveSession(sessionId, session);

    const reply = buildNumberedMenuText(session.name);
    return { reply, session };
  }

  // Paso 4: Recibir Opción del Menú por Número (1 al 9) -> Pedir Detalles del pedido
  if (session.step === "ASK_SERVICE") {
    const numMatch = cleanText.match(/^[1-9]$/);
    const chosenNumber = numMatch ? numMatch[0] : null;

    if (!chosenNumber || !SERVICE_MENU[chosenNumber]) {
      return {
        reply:
          `Por favor responde únicamente con un *número del 1 al 9* según la opción que necesitas:\n\n` +
          buildNumberedMenuText(session.name),
        session,
      };
    }

    session.serviceNumber = chosenNumber;
    session.serviceName = SERVICE_MENU[chosenNumber];
    session.step = "ASK_DETAILS";
    session.updatedAt = Date.now();
    await saveSession(sessionId, session);

    const reply =
      `Has elegido la opción:\n✅ *${session.serviceName}*\n\n` +
      `*Último paso:* Escríbenos la *cantidad y detalles* de lo que necesitas (ej. si es blanco y negro o a color, tamaño, texto para tarjetas o artículo de regalo específico):`;

    return { reply, session };
  }

  // Paso 5: Recibir Detalles -> Confirmar Pedido Completo
  if (session.step === "ASK_DETAILS") {
    session.details = cleanText;
    session.step = "COMPLETED";
    session.updatedAt = Date.now();
    await saveSession(sessionId, session);

    metric("whatsapp.orders.completed", 1, {
      outcome: "success",
      service_option: session.serviceNumber || "unknown",
    });

    const reply =
      `🎉 *¡Pedido Registrado con Éxito en Bazar Copi Art!*\n\n` +
      `📋 *Ficha del Cliente y Pedido:*\n` +
      `• *Nombre:* ${session.name}\n` +
      `• *Teléfono:* ${session.phone}\n` +
      `• *Correo:* ${session.email}\n` +
      `• *Servicio:* ${session.serviceName}\n` +
      `• *Detalles:* ${session.details}\n\n` +
      `⏱️ *Compromiso de atención:* En menos de *10 minutos* un colaborador confirmará tu encargo para que solo pases a retirar cuando esté listo.\n` +
      `💳 *Métodos de pago:* SINPE Móvil y Efectivo.\n` +
      `📎 _Si necesitas imprimir un documento o imagen, ya puedes adjuntarlo en este chat._\n\n` +
      `_(Escribe *HOLA* o *MENU* si deseas registrar otro pedido)._`;

    return { reply, session };
  }

  return {
    reply: "Escribe *HOLA* para iniciar tu pedido en Bazar Copi Art.",
    session,
  };
}

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
 * GET /api/whatsapp
 * - Verifica el Webhook ante Meta for Developers (hub.mode, hub.verify_token, hub.challenge)
 * - Si se visita desde el navegador, muestra el estado activo del webhook
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
    service: "Bazar Copi Art - WhatsApp Cloud API Webhook",
    webhookUrl: "https://bazar-copi-art.vercel.app/api/whatsapp",
    steps: [
      "1. Nombre completo",
      "2. Teléfono",
      "3. Correo electrónico",
      "4. Menú numérico (1 al 9)",
      "5. Detalles del pedido y confirmación",
    ],
    configured: {
      hasAccessToken: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
      hasCustomVerifyToken: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
    },
  });
}

/**
 * POST /api/whatsapp
 * - Recibe eventos en vivo de Meta WhatsApp Cloud API y responde automáticamente
 * - También soporta `mode: "simulate"` para probar el bot paso a paso desde la web
 */
export async function POST(request) {
  const startedAt = performance.now();

  try {
    const body = await request.json();

    // 1. Modo simulador / asistente interactivo desde la página web
    if (body && body.mode === "simulate") {
      const sessionId = body.sessionId || "web-guest";
      const text = body.text || "hola";
      const clientSession = body.session || null;

      const result = await processConversationStep(sessionId, text, clientSession);
      metric("whatsapp.webhook.messages", 1, {
        outcome: "success",
        source: "web_simulator",
        step: result.session?.step || "unknown",
      });

      return Response.json({
        ok: true,
        reply: result.reply,
        session: result.session,
      });
    }

    // 2. Evento oficial de Meta WhatsApp Cloud API
    if (body && body.object === "whatsapp_business_account") {
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];
      const phoneNumberId = value?.metadata?.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID;

      if (message && message.from) {
        const from = message.from;
        const incomingText =
          message.text?.body ||
          message.interactive?.button_reply?.title ||
          message.interactive?.list_reply?.title ||
          "hola";

        const result = await processConversationStep(from, incomingText);

        await sendWhatsAppCloudMessage(phoneNumberId, from, result.reply);

        // Si el cliente completó los 5 pasos y existe un número de administrador configurado, le notifica el resumen
        if (result.session?.step === "COMPLETED" && process.env.OWNER_WHATSAPP_NUMBER) {
          const ownerSummary =
            `🔔 *Nuevo Pedido por WhatsApp - Bazar Copi Art*\n` +
            `• *Cliente:* ${result.session.name}\n` +
            `• *WhatsApp/Tel:* ${result.session.phone} (${from})\n` +
            `• *Correo:* ${result.session.email}\n` +
            `• *Servicio:* ${result.session.serviceName}\n` +
            `• *Detalles:* ${result.session.details}`;
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
