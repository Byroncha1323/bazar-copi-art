import {
  readDatabase,
  recordOrder,
  loadWhatsAppSession,
  saveWhatsAppSession,
  estimateOrderAmount,
} from "./db.js";

export const SERVICE_MENU = {
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

const SERVICE_KEYWORDS = [
  { num: "2", words: ["cedula", "cédula", "identidad"] },
  { num: "1", words: ["fotocopia", "fotocopias", "copia", "copias"] },
  { num: "3", words: ["impresion", "impresiones", "imprimir", "imprimo"] },
  { num: "4", words: ["folleto", "folletos", "antologia", "antología", "docente", "guia", "guía"] },
  { num: "5", words: ["emplasticado", "emplasticar", "laminar", "laminado", "carne", "carné"] },
  { num: "6", words: ["tarjeta", "tarjetas", "presentacion", "presentación"] },
  { num: "7", words: ["factura", "facturas", "volante", "volantes", "bond"] },
  { num: "8", words: ["papeleria", "papelería", "sticker", "stickers", "libreta", "utiles", "útiles"] },
  {
    num: "9",
    words: ["regalo", "regalos", "taza", "tazas", "peluche", "peluches", "bolso", "bolsos", "broche", "broches", "separador", "separadores"],
  },
];

function stripAccents(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function buildNumberedMenuText(customerName = "") {
  const greeting = customerName ? `¡Excelente, *${customerName}*! ` : "";
  return (
    `${greeting}Estos son nuestros servicios y productos (responde con el *número 1 al 9* o escríbenos cuál necesitas):\n\n` +
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

function formatCatalogForAI(inventory = []) {
  const stockLines = inventory
    .filter((item) => item.type !== "Insumo")
    .map((item) => {
      const priceText = item.salePrice > 0 ? `₡${item.salePrice}` : "según diseño";
      const avail = Number(item.stock) > 0 ? `disponible (${item.stock} ${item.unit})` : "agotado temporalmente";
      return `- ${item.name} [${item.category}]: ${priceText} (${avail}). ${item.notes || ""}`.trim();
    })
    .join("\n");

  return (
    `INFORMACIÓN OFICIAL DE BAZAR COPI ART (Costa Rica):\n` +
    `- Horario: Lunes a Viernes 6:30 a.m. a 4:30 p.m. | Sábados 9:00 a.m. a 1:00 p.m. | Domingos cerrado para retiros físicos, pero recibimos pedidos por encargo vía WhatsApp para retirar el lunes.\n` +
    `- Métodos de pago: SINPE Móvil y Efectivo.\n` +
    `- Modalidad: Atención presencial y pedidos por encargo vía WhatsApp (el cliente envía archivos o pedido y retira sin hacer filas cuando está listo).\n` +
    `- Compromiso de respuesta: Menos de 5 min presencial y menos de 10 min en línea.\n` +
    `- WhatsApp oficial: https://wa.me/50664760290 (+506 6476-0290).\n\n` +
    `CATÁLOGO Y STOCK EN TIEMPO REAL:\n${stockLines}`
  );
}

export function getAIStatus() {
  if (process.env.GEMINI_API_KEY) {
    return { enabled: true, provider: "gemini", model: process.env.GEMINI_MODEL || "gemini-2.5-flash" };
  }
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) {
    return {
      enabled: true,
      provider: "cloudflare_ai",
      model: process.env.CLOUDFLARE_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct",
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return { enabled: true, provider: "openai", model: process.env.OPENAI_MODEL || "gpt-4o-mini" };
  }
  return { enabled: false, provider: "contextual_local", model: "Motor Contextual Coherente" };
}

function appendHistory(session, role, text) {
  const history = Array.isArray(session.history) ? session.history : [];
  const next = [...history, { role, text: String(text || "").slice(0, 1200) }];
  return next.slice(-14);
}

function parsePrebuiltWebOrder(rawText) {
  const text = String(rawText || "");
  if (
    !text.includes("realizar el siguiente pedido") &&
    !(text.includes("Nombre:") && text.includes("Servicio:")) &&
    !(text.includes("mi nombre es") && text.includes("Me interesa:") && text.includes("Detalles:"))
  ) {
    return null;
  }

  // Formato del chatbot web
  const nameMatch = text.match(/Nombre:\s*(.+)/i);
  const phoneMatch = text.match(/Tel[eé]fono:\s*(.+)/i);
  const emailMatch = text.match(/Correo:\s*(.+)/i);
  const serviceMatch = text.match(/Servicio:\s*(.+)/i);
  const detailsMatch = text.match(/Detalles:\s*([\s\S]+)/i);

  if (nameMatch && serviceMatch) {
    return {
      name: nameMatch[1].trim(),
      phone: phoneMatch ? phoneMatch[1].trim() : "",
      email: emailMatch ? emailMatch[1].trim() : "",
      serviceName: serviceMatch[1].trim(),
      details: detailsMatch ? detailsMatch[1].trim() : "",
    };
  }

  // Formato del formulario rápido inferior
  const formMatch = text.match(/mi nombre es\s+([^.]+)\.\s*Me interesa:\s*([^.]+)\.\s*Detalles:\s*([\s\S]+)/i);
  if (formMatch) {
    return {
      name: formMatch[1].trim(),
      phone: "",
      email: "",
      serviceName: formMatch[2].trim(),
      details: formMatch[3].trim(),
    };
  }

  return null;
}

function matchServiceFromText(rawText) {
  const exactNum = String(rawText || "").trim().match(/^[1-9]$/);
  if (exactNum && SERVICE_MENU[exactNum[0]]) {
    return { num: exactNum[0], name: SERVICE_MENU[exactNum[0]] };
  }

  const normalized = stripAccents(rawText);
  const embeddedNum = normalized.match(/\b(?:opcion|opción|numero|número|#)?\s*([1-9])\b/);
  if (embeddedNum && SERVICE_MENU[embeddedNum[1]] && normalized.length <= 22) {
    return { num: embeddedNum[1], name: SERVICE_MENU[embeddedNum[1]] };
  }

  for (const entry of SERVICE_KEYWORDS) {
    if (entry.words.some((w) => normalized.includes(stripAccents(w)))) {
      return { num: entry.num, name: SERVICE_MENU[entry.num] };
    }
  }
  return null;
}

function searchInventoryMatch(rawText, inventory = []) {
  const norm = stripAccents(rawText);
  const tokens = norm.split(/\s+/).filter((t) => t.length >= 4);
  if (tokens.length === 0) return [];

  return inventory
    .filter((item) => item.type !== "Insumo")
    .filter((item) => {
      const hay = stripAccents(`${item.name} ${item.category} ${item.notes || ""}`);
      return tokens.some((tok) => hay.includes(tok));
    })
    .slice(0, 4);
}

function detectFAQAnswer(rawText, inventory = []) {
  const norm = stripAccents(rawText);
  const answers = [];

  if (
    norm.includes("horario") ||
    norm.includes("abierto") ||
    norm.includes("abren") ||
    norm.includes("cierran") ||
    norm.includes("hora") ||
    norm.includes("domingo") ||
    norm.includes("sabado")
  ) {
    answers.push(
      `🕒 *Horario de atención en Bazar Copi Art:*\n` +
        `• *Lunes a Viernes:* 6:30 a.m. – 4:30 p.m.\n` +
        `• *Sábados:* 9:00 a.m. – 1:00 p.m.\n` +
        `• *Domingos:* Cerrado para retiros físicos, pero recibimos pedidos por encargo vía WhatsApp para retirar el lunes.`
    );
  }

  if (
    norm.includes("sinpe") ||
    norm.includes("pago") ||
    norm.includes("pagar") ||
    norm.includes("efectivo") ||
    norm.includes("transferencia") ||
    norm.includes("tarjeta de credito") ||
    norm.includes("tarjeta de debito")
  ) {
    answers.push(`💳 Aceptamos pagos rápidos y seguros por *SINPE Móvil* y *Efectivo*.`);
  }

  const hasPrintOrCopies =
    norm.includes("impresion") ||
    norm.includes("imprimir") ||
    norm.includes("copia") ||
    norm.includes("folleto") ||
    norm.includes("docente");

  if (norm.includes("cedula") && !hasPrintOrCopies) {
    answers.push(`🪪 *Copias de cédula:* Blanco y negro *₡60* | A color *₡180*. Con gusto te las preparamos.`);
  }

  if (hasPrintOrCopies) {
    answers.push(
      `🖨️ *Precios de Impresiones y Copias:*\n` +
        `• *Impresiones:* Blanco y negro ₡50 | Color ₡100\n` +
        `• *Copias:* Blanco y negro ₡20 | Color ₡75\n` +
        `• *Copias de cédula:* B/N ₡60 | Color ₡180\n` +
        `• *Folletos:* ₡20 por pág. _(precio especial para docentes)_.`
    );
  }

  if (
    norm.includes("taza") ||
    norm.includes("peluche") ||
    norm.includes("bolso") ||
    norm.includes("broche") ||
    norm.includes("separador") ||
    norm.includes("regalo") ||
    norm.includes("sticker") ||
    norm.includes("papeleria")
  ) {
    const tazas = inventory.find((i) => i.id === "INV-010");
    const stockNote =
      tazas && tazas.stock > 0 ? `\n_(En inventario actual: ${tazas.stock} tazas disponibles)_` : "";
    answers.push(
      `🎁 *Artículos de Regalo y Papelería:*\n` +
        `• *Broches:* Pequeños ₡600 | Grandes ₡1.000\n` +
        `• *Separadores:* ₡1.500\n` +
        `• *Tazas:* ₡1.700\n` +
        `• *Peluches:* Desde ₡2.500 en adelante\n` +
        `• *Bolsos de tela:* ₡3.000\n` +
        `• *Stickers (50 uds):* ₡2.500\n` +
        `• *Papelería personalizada:* Desde ₡8.000.${stockNote}`
    );
  }

  if (norm.includes("tarjeta") || norm.includes("factura") || norm.includes("volante") || norm.includes("emplastic")) {
    answers.push(
      `💼 *Servicios para Negocios y Documentos:*\n` +
        `• *Emplasticado:* Desde ₡600 según tamaño\n` +
        `• *Tarjetas de presentación:* 1 lado ₡2.000 | Ambos lados ₡2.500\n` +
        `• *Facturas:* Desde ₡3.000 según diseño\n` +
        `• *Volantes Papel Bond (100 uds):* ₡5.000.`
    );
  }

  if (norm.includes("donde") || norm.includes("ubicacion") || norm.includes("retir") || norm.includes("como pido") || norm.includes("encargo")) {
    answers.push(
      `📦 *Pedidos por encargo:*\n` +
        `Nos envías tus archivos o lo que necesitas por WhatsApp, nosotros lo preparamos y te avisamos para que *solamente pases a retirar cuando esté listo*, sin hacer filas.`
    );
  }

  if (norm.includes("tiempo") || norm.includes("tardan") || norm.includes("rapido") || norm.includes("dura")) {
    answers.push(`⚡ Respondemos en menos de *10 minutos* en línea (menos de 5 min en tienda), con 97% de entregas a tiempo.`);
  }

  if (
    answers.length === 0 &&
    (norm.includes("precio") || norm.includes("cuesta") || norm.includes("cuanto") || norm.includes("tarifa") || norm.includes("catalogo") || norm.includes("servicios"))
  ) {
    const invMatches = searchInventoryMatch(rawText, inventory);
    if (invMatches.length > 0 && !norm.includes("catalogo") && !norm.includes("servicios")) {
      const list = invMatches
        .map(
          (i) =>
            `• *${i.name}:* ${i.salePrice > 0 ? `₡${i.salePrice.toLocaleString("es-CR")}` : "Según diseño"} (${
              i.stock > 0 ? `${i.stock} ${i.unit} disponibles` : "agotado"
            })`
        )
        .join("\n");
      return `🏷️ *Consulta en nuestro inventario:*\n${list}`;
    }

    return (
      `🏷️ *Resumen de Tarifas Bazar Copi Art:*\n` +
      `• Copias: B/N ₡20 | Color ₡75\n` +
      `• Impresiones: B/N ₡50 | Color ₡100\n` +
      `• Cédula: B/N ₡60 | Color ₡180\n` +
      `• Emplasticado desde ₡600 | Regalos desde ₡600\n` +
      `• Tarjetas desde ₡2.000 | Stickers (50 uds) ₡2.500.`
    );
  }

  // Búsqueda directa en inventario por nombre de producto nuevo agregado por la jefa
  if (answers.length === 0) {
    const dynamicMatches = searchInventoryMatch(rawText, inventory);
    if (dynamicMatches.length > 0 && looksLikeQuestionOrGreeting(rawText)) {
      const list = dynamicMatches
        .map(
          (i) =>
            `• *${i.name}:* ${i.salePrice > 0 ? `₡${i.salePrice.toLocaleString("es-CR")}` : "Según diseño"} (${
              i.stock > 0 ? `${i.stock} ${i.unit} disponibles` : "sin stock en este momento"
            })`
        )
        .join("\n");
      return `📦 *Disponibilidad en Bazar Copi Art:*\n${list}`;
    }
  }

  return answers.length > 0 ? answers.join("\n\n") : null;
}

function looksLikeQuestionOrGreeting(rawText) {
  const norm = stripAccents(rawText);
  if (rawText.includes("?") || rawText.includes("¿")) return true;
  const triggers = [
    "hola",
    "buenos dias",
    "buenas tardes",
    "buenas noches",
    "buenas",
    "cuanto",
    "como",
    "donde",
    "cual",
    "cuando",
    "tienen",
    "aceptan",
    "hacen",
    "precio",
    "horario",
    "menu",
    "ayuda",
    "info",
    "informacion",
  ];
  return triggers.some((t) => norm === t || norm.startsWith(`${t} `) || norm.includes(` ${t}`));
}

function extractNameCandidate(rawText) {
  const cleaned = String(rawText || "")
    .replace(/^(hola[\s,!.]+)?(mi nombre es|me llamo|soy)\s+/i, "")
    .trim();
  if (cleaned.length < 2 || cleaned.length > 60) return null;
  if (/\d{4,}/.test(cleaned)) return null;
  if (looksLikeQuestionOrGreeting(cleaned)) return null;
  return cleaned;
}

async function callAIWithHistory({ userText, session, db, channel }) {
  const aiStatus = getAIStatus();
  if (!aiStatus.enabled) return null;

  const catalogContext = formatCatalogForAI(db.inventory);
  const currentDraft = {
    step: session.step || "IDLE",
    name: session.name || "",
    phone: session.phone || "",
    email: session.email || "",
    serviceName: session.serviceName || "",
    details: session.details || "",
  };

  const systemPrompt =
    `Eres el asistente virtual oficial de "Bazar Copi Art" en Costa Rica, atendiendo por ${channel === "whatsapp" ? "WhatsApp" : "el chat de la página web"}.\n` +
    `Tu personalidad: cálido, claro, respetuoso, breve y muy coherente con el historial de la conversación.\n\n` +
    `${catalogContext}\n\n` +
    `BORRADOR ACTUAL DEL PEDIDO DEL CLIENTE:\n${JSON.stringify(currentDraft)}\n\n` +
    `REGLAS DE COHERENCIA:\n` +
    `1. Responde SIEMPRE en español natural y directo, coherente con lo último que escribió el cliente y lo que ya conversaron antes.\n` +
    `2. Si el cliente hace una pregunta (precios, horarios, SINPE, regalos, copias, impresiones, tiempos, disponibilidad), respóndela con exactitud usando el catálogo real arriba.\n` +
    `3. Si el cliente quiere hacer un pedido o encargo, recopila de forma amable y natural los datos que falten: Nombre, Teléfono (en WhatsApp ya tenemos su número si no lo da, pero confírmalo si hace falta), Servicio y Detalles/Cantidad (el correo es opcional).\n` +
    `4. Si el cliente YA dio todos los datos del pedido o pegó una ficha de pedido completa y confirmó o pidió enviarlo, pon "orderReadyToSave": true y llena "orderDraft" con los datos extraídos y "estimatedTotal" en colones (solo número entero).\n` +
    `5. Nunca inventes precios que no estén en el catálogo; si algo es personalizado, indica "desde" según catálogo o que un colaborador confirmará en menos de 10 minutos.\n` +
    `6. Responde ÚNICAMENTE en JSON válido con este formato exacto:\n` +
    `{\n` +
    `  "reply": "Mensaje amable para el cliente (usa *negrita* estilo WhatsApp si ayuda)",\n` +
    `  "intent": "faq | order_in_progress | order_completed | greeting | other",\n` +
    `  "orderReadyToSave": false,\n` +
    `  "orderDraft": {\n` +
    `    "name": "",\n` +
    `    "phone": "",\n` +
    `    "email": "",\n` +
    `    "serviceName": "",\n` +
    `    "details": "",\n` +
    `    "estimatedTotal": 0\n` +
    `  }\n` +
    `}`;

  const history = Array.isArray(session.history) ? session.history : [];

  try {
    if (aiStatus.provider === "gemini") {
      const contents = [
        ...history.map((h) => ({
          role: h.role === "assistant" ? "model" : "user",
          parts: [{ text: h.text }],
        })),
        { role: "user", parts: [{ text: userText }] },
      ];

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${aiStatus.model}:generateContent?key=${encodeURIComponent(
          process.env.GEMINI_API_KEY
        )}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: {
              temperature: 0.4,
              maxOutputTokens: 650,
              responseMimeType: "application/json",
            },
          }),
        }
      );

      if (!res.ok) {
        console.error("Error Gemini API:", res.status, await res.text());
        return null;
      }

      const data = await res.json();
      const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawJson) return null;
      return JSON.parse(rawJson);
    }

    if (aiStatus.provider === "cloudflare_ai") {
      const messages = [
        { role: "system", content: systemPrompt },
        ...history.map((h) => ({
          role: h.role === "assistant" ? "assistant" : "user",
          content: h.text,
        })),
        { role: "user", content: userText },
      ];

      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${aiStatus.model}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages,
            temperature: 0.4,
            max_tokens: 650,
          }),
        }
      );

      if (!res.ok) {
        console.error("Error Cloudflare Workers AI:", res.status, await res.text());
        return null;
      }

      const data = await res.json();
      const rawText = String(data?.result?.response || "").trim();
      if (!rawText) return null;
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : { reply: rawText, intent: "other", orderReadyToSave: false };
    }

    if (aiStatus.provider === "openai") {
      const messages = [
        { role: "system", content: systemPrompt },
        ...history.map((h) => ({
          role: h.role === "assistant" ? "assistant" : "user",
          content: h.text,
        })),
        { role: "user", content: userText },
      ];

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: aiStatus.model,
          messages,
          temperature: 0.4,
          response_format: { type: "json_object" },
        }),
      });

      if (!res.ok) {
        console.error("Error OpenAI API:", res.status, await res.text());
        return null;
      }

      const data = await res.json();
      const rawJson = data?.choices?.[0]?.message?.content;
      if (!rawJson) return null;
      return JSON.parse(rawJson);
    }
  } catch (err) {
    console.error("Error invocando proveedor IA:", err);
  }

  return null;
}

function getStepReminderText(step) {
  switch (step) {
    case "ASK_NAME":
      return "Cuando gustes, indícame tu *nombre completo* para continuar con tu pedido:";
    case "ASK_PHONE":
      return "Para seguir con tu pedido, indícame tu *número de teléfono* (ej. 8888-8888):";
    case "ASK_EMAIL":
      return "Para seguir, escribe tu *correo electrónico* (o responde *omitir* si prefieres solo WhatsApp):";
    case "ASK_SERVICE":
      return "Para continuar, elige un *número del 1 al 9* o dime qué servicio necesitas:";
    case "ASK_DETAILS":
      return "Cuéntame la *cantidad y detalles* de tu pedido para finalizarlo:";
    default:
      return "";
  }
}

async function runContextualFallback({
  sessionId,
  cleanText,
  session,
  db,
  channel,
  mediaType,
  whatsappFrom,
}) {
  const norm = stripAccents(cleanText);

  // 0. Manejo coherente de archivos adjuntos (PDF, fotos, audios) en WhatsApp
  if (mediaType && !cleanText) {
    const mediaLabel =
      mediaType === "image"
        ? "imagen"
        : mediaType === "document"
        ? "documento/archivo"
        : mediaType === "audio"
        ? "audio"
        : "archivo";
    const reminder = getStepReminderText(session.step);
    const reply =
      `📎 ¡Recibimos tu *${mediaLabel}* en Bazar Copi Art! Lo tendremos en cuenta para tu atención.` +
      (reminder ? `\n\n${reminder}` : "\n\nSi deseas registrar un pedido con este archivo, dime qué necesitas o escribe *PEDIDO*.");
    return { reply, session, savedOrder: null };
  }

  // 1. Detectar ficha de pedido completa pegada desde el sitio web
  const prebuilt = parsePrebuiltWebOrder(cleanText);
  if (prebuilt) {
    const savedOrder = await recordOrder(
      {
        source: channel === "whatsapp" ? "whatsapp" : "web_chatbot",
        customerName: prebuilt.name,
        phone: prebuilt.phone || whatsappFrom || "",
        whatsappFrom: whatsappFrom || "",
        email: prebuilt.email,
        serviceName: prebuilt.serviceName,
        details: prebuilt.details,
      },
      channel
    );

    const updatedSession = {
      ...session,
      step: "COMPLETED",
      name: prebuilt.name,
      phone: prebuilt.phone || whatsappFrom || "",
      email: prebuilt.email,
      serviceName: prebuilt.serviceName,
      details: prebuilt.details,
      lastOrderId: savedOrder.id,
      updatedAt: Date.now(),
    };

    const reply =
      `🎉 *¡Pedido Recibido y Registrado (${savedOrder.id})!*\n\n` +
      `Hola *${savedOrder.customerName}*, ya tenemos tu ficha en nuestro sistema:\n` +
      `• *Servicio:* ${savedOrder.serviceName}\n` +
      `• *Detalles:* ${savedOrder.details}\n` +
      (savedOrder.total > 0 ? `• *Total estimado:* ₡${savedOrder.total.toLocaleString("es-CR")}\n` : "") +
      `\n⏱️ En menos de *10 minutos* un colaborador confirmará tu encargo. Si necesitas imprimir algún archivo, puedes adjuntarlo aquí mismo.`;

    return { reply, session: updatedSession, savedOrder };
  }

  // 2. Comandos de cancelación o menú explícito
  if (norm === "cancelar" || norm === "salir") {
    const resetSession = {
      ...session,
      step: "IDLE",
      name: "",
      phone: "",
      email: "",
      serviceNumber: "",
      serviceName: "",
      details: "",
      updatedAt: Date.now(),
    };
    return {
      reply:
        "De acuerdo, cancelamos el registro anterior. 😊 Estoy aquí si tienes alguna consulta sobre precios, horarios o si luego deseas hacer un pedido.",
      session: resetSession,
      savedOrder: null,
    };
  }

  if (norm === "menu" || norm === "menú" || norm === "catalogo" || norm === "catálogo") {
    return {
      reply: `${buildNumberedMenuText(session.name)}\n\n_(Si quieres iniciar un pedido paso a paso, escribe *PEDIDO* o responde con el número del servicio)._`,
      session: { ...session, step: session.step === "IDLE" ? "ASK_SERVICE" : session.step, updatedAt: Date.now() },
      savedOrder: null,
    };
  }

  // 3. Detectar intención explícita de iniciar pedido paso a paso
  const wantsOrderStart =
    norm === "pedido" ||
    norm === "ordenar" ||
    norm === "encargar" ||
    norm === "comprar" ||
    norm === "cotizar" ||
    norm.includes("hacer un pedido") ||
    norm.includes("quiero pedir") ||
    norm.includes("quiero hacer un pedido") ||
    norm.includes("quiero encargar");

  if (wantsOrderStart && (session.step === "IDLE" || session.step === "COMPLETED")) {
    const matchedSvc = matchServiceFromText(cleanText);
    const newSession = {
      ...session,
      step: "ASK_NAME",
      name: "",
      phone: channel === "whatsapp" && whatsappFrom ? whatsappFrom : "",
      email: "",
      serviceNumber: matchedSvc ? matchedSvc.num : "",
      serviceName: matchedSvc ? matchedSvc.name : "",
      details: matchedSvc ? cleanText : "",
      updatedAt: Date.now(),
    };

    const reply = matchedSvc
      ? `¡Con gusto preparamos tu pedido de *${matchedSvc.name}*! 📝\n\n*Paso 1:* ¿Cuál es tu *nombre completo*?`
      : `¡Con mucho gusto! Vamos a registrar tu pedido en *Bazar Copi Art*. 📝\n\n*Paso 1:* Por favor escribe tu *nombre completo*:`;

    return { reply, session: newSession, savedOrder: null };
  }

  // 4. Detectar preguntas frecuentes (FAQ) de forma contextual sin romper respuestas válidas de un paso activo
  const isExplicitQuestion = looksLikeQuestionOrGreeting(cleanText);
  const isSelectingService = session.step === "ASK_SERVICE" && !isExplicitQuestion && Boolean(matchServiceFromText(cleanText));
  const isProvidingDetails = session.step === "ASK_DETAILS" && !isExplicitQuestion;
  const isSingleDayName = session.step === "ASK_NAME" && !isExplicitQuestion && (norm === "domingo" || norm === "sabado");

  if (!isSelectingService && !isProvidingDetails && !isSingleDayName) {
    const faqAnswer = detectFAQAnswer(cleanText, db.inventory);
    if (faqAnswer) {
      const reminder = getStepReminderText(session.step);
      const reply = reminder
        ? `${faqAnswer}\n\n—\n${reminder}`
        : `${faqAnswer}\n\n¿Te gustaría iniciar un pedido o consultar algo más? Puedes escribir *PEDIDO* o decirme qué necesitas.`;
      return { reply, session, savedOrder: null };
    }
  }

  // 5. Agradecimientos / despedidas cortas cuando está en IDLE o COMPLETED
  if (
    (session.step === "IDLE" || session.step === "COMPLETED") &&
    (norm.includes("gracias") || norm.includes("pura vida") || norm.includes("muchas gracias"))
  ) {
    return {
      reply: "¡Con mucho gusto! En *Bazar Copi Art* estamos para servirte. 😊 Escríbenos cuando necesites algo más.",
      session,
      savedOrder: null,
    };
  }

  // 6. Saludo inicial en IDLE o COMPLETED
  if (
    (session.step === "IDLE" || session.step === "COMPLETED") &&
    (norm === "hola" ||
      norm.startsWith("hola ") ||
      norm.includes("buenos dias") ||
      norm.includes("buenas tardes") ||
      norm.includes("buenas noches") ||
      norm === "buenas")
  ) {
    // Si saludó y de una vez mencionó un servicio (ej: "Hola quiero 5 copias a color")
    const svcInGreeting = matchServiceFromText(cleanText);
    if (svcInGreeting) {
      const nextSession = {
        ...session,
        step: "ASK_NAME",
        name: "",
        phone: channel === "whatsapp" && whatsappFrom ? whatsappFrom : "",
        email: "",
        serviceNumber: svcInGreeting.num,
        serviceName: svcInGreeting.name,
        details: cleanText,
        updatedAt: Date.now(),
      };
      return {
        reply:
          `¡Hola! 👋 Bienvenido(a) a *Bazar Copi Art*.\n\n` +
          `Veo que te interesa *${svcInGreeting.name}*. Si quieres dejar registrado tu pedido de una vez, indícame tu *nombre completo* (o pregúntame lo que necesites sobre precios/horario):`,
        session: nextSession,
        savedOrder: null,
      };
    }

    return {
      reply:
        `¡Hola! 👋 Bienvenido(a) a *Bazar Copi Art* _(Papelería, Impresiones y Regalos)_.\n\n` +
        `Puedes preguntarme por *precios, horarios, métodos de pago (SINPE/Efectivo)* o escribir *PEDIDO* / *MENU* si deseas encargar algo paso a paso. ¿En qué te ayudo hoy?`,
      session: { ...session, step: "IDLE", updatedAt: Date.now() },
      savedOrder: null,
    };
  }

  // 7. Flujo paso a paso coherente cuando hay un pedido activo
  if (session.step === "ASK_NAME") {
    const candidate = extractNameCandidate(cleanText);
    if (!candidate) {
      return {
        reply:
          "Para avanzar con tu pedido necesito primero tu *nombre completo* (por ejemplo: _María Pérez_). Si prefieres cancelar, escribe *CANCELAR*.",
        session,
        savedOrder: null,
      };
    }

    session.name = candidate;
    session.step = "ASK_PHONE";
    session.updatedAt = Date.now();
    return {
      reply:
        `¡Mucho gusto, *${session.name}*! 😊\n\n` +
        `Indícame tu *número de teléfono* de contacto (ej. 8888-8888):`,
      session,
      savedOrder: null,
    };
  }

  if (session.step === "ASK_PHONE") {
    const digits = cleanText.replace(/\D/g, "");
    if (digits.length < 7) {
      return {
        reply: "Por favor indícanos un *número de teléfono válido* de al menos 7 u 8 dígitos (ej. 8888-8888):",
        session,
        savedOrder: null,
      };
    }

    session.phone = cleanText;
    session.step = "ASK_EMAIL";
    session.updatedAt = Date.now();
    return {
      reply:
        `Teléfono registrado (*${session.phone}*). 📱\n\n` +
        `Ahora indícame tu *correo electrónico* (o escribe *omitir* si prefieres continuar sin correo):`,
      session,
      savedOrder: null,
    };
  }

  if (session.step === "ASK_EMAIL") {
    const wantsSkip = norm === "omitir" || norm === "no tengo" || norm === "sin correo" || norm === "no";
    if (!wantsSkip && (!cleanText.includes("@") || !cleanText.includes("."))) {
      return {
        reply: "Por favor escribe un *correo electrónico válido* (ej. cliente@correo.com) o responde *omitir*:",
        session,
        savedOrder: null,
      };
    }

    session.email = wantsSkip ? "" : cleanText;

    // Si ya traía servicio detectado desde el inicio, saltamos directo a detalles
    if (session.serviceName) {
      session.step = "ASK_DETAILS";
      session.updatedAt = Date.now();
      return {
        reply:
          `¡Gracias, *${session.name}*! Ya tenemos tu servicio (*${session.serviceName}*).\n\n` +
          `Por último, confírmanos la *cantidad y detalles* exactos de tu pedido (ej. color o B/N, tamaño o modelo):`,
        session,
        savedOrder: null,
      };
    }

    session.step = "ASK_SERVICE";
    session.updatedAt = Date.now();
    return {
      reply: buildNumberedMenuText(session.name),
      session,
      savedOrder: null,
    };
  }

  if (session.step === "ASK_SERVICE") {
    const matched = matchServiceFromText(cleanText);
    if (!matched) {
      return {
        reply:
          `No logré identificar el servicio. Por favor responde con un *número del 1 al 9* o escribe el nombre (ej. _impresiones_, _taza_, _emplasticado_):\n\n` +
          buildNumberedMenuText(session.name),
        session,
        savedOrder: null,
      };
    }

    session.serviceNumber = matched.num;
    session.serviceName = matched.name;
    session.step = "ASK_DETAILS";
    session.updatedAt = Date.now();
    return {
      reply:
        `Has elegido:\n✅ *${session.serviceName}*\n\n` +
        `*Último paso:* Escríbenos la *cantidad y detalles* de lo que necesitas (ej. B/N o color, cantidad, tamaño o especificaciones):`,
      session,
      savedOrder: null,
    };
  }

  if (session.step === "ASK_DETAILS") {
    if (cleanText.length < 2) {
      return {
        reply: "Cuéntanos brevemente la *cantidad o detalles* de tu pedido para poder registrarlo:",
        session,
        savedOrder: null,
      };
    }

    session.details = cleanText;
    session.step = "COMPLETED";
    session.updatedAt = Date.now();

    const savedOrder = await recordOrder(
      {
        source: channel === "whatsapp" ? "whatsapp" : "web_chatbot",
        customerName: session.name || "Cliente",
        phone: session.phone || whatsappFrom || "",
        whatsappFrom: whatsappFrom || "",
        email: session.email || "",
        serviceName: session.serviceName,
        details: session.details,
      },
      channel
    );
    session.lastOrderId = savedOrder.id;

    const estLine =
      savedOrder.total > 0
        ? `• *Total estimado:* ₡${savedOrder.total.toLocaleString("es-CR")}\n`
        : "";

    const reply =
      `🎉 *¡Pedido Registrado con Éxito (${savedOrder.id})!*\n\n` +
      `• *Nombre:* ${savedOrder.customerName}\n` +
      `• *Teléfono:* ${savedOrder.phone || "Por WhatsApp"}\n` +
      (savedOrder.email ? `• *Correo:* ${savedOrder.email}\n` : "") +
      `• *Servicio:* ${savedOrder.serviceName}\n` +
      `• *Detalles:* ${savedOrder.details}\n` +
      estLine +
      `\n⏱️ En menos de *10 minutos* confirmaremos tu encargo para que pases a retirar sin filas.\n` +
      `💳 *Pagos:* SINPE Móvil y Efectivo.\n` +
      `📎 _Si debes imprimir un documento o imagen, puedes enviarlo ahora mismo._`;

    return { reply, session, savedOrder };
  }

  // 8. Mensaje libre en IDLE: si menciona un servicio, responde precios + ofrece iniciar pedido
  const freeService = matchServiceFromText(cleanText);
  if (freeService) {
    const est = estimateOrderAmount(freeService.name, cleanText, db.inventory);
    const priceHint =
      est.total > 0 ? ` El estimado aproximado sería de *₡${est.total.toLocaleString("es-CR")}*.` : "";
    return {
      reply:
        `Con gusto te ayudamos con *${freeService.name}*.${priceHint}\n\n` +
        `Si deseas dejarlo encargado de una vez, escribe *PEDIDO* (o dime tu nombre y cantidad) y lo registramos al instante.`,
      session: { ...session, step: "IDLE", updatedAt: Date.now() },
      savedOrder: null,
    };
  }

  return {
    reply:
      `¡Gracias por escribir a *Bazar Copi Art*! 😊\n` +
      `Ofrecemos fotocopias (desde ₡20), impresiones (desde ₡50), copias de cédula, folletos, emplasticado, tarjetas, facturas, volantes, papelería y regalos.\n\n` +
      `Puedes preguntarme precios u horarios, o escribir *PEDIDO* para registrar tu encargo paso a paso.`,
    session: { ...session, step: "IDLE", updatedAt: Date.now() },
    savedOrder: null,
  };
}

/**
 * Procesa cualquier conversación (WhatsApp Cloud API, Chat Web con IA o Simulador)
 * manteniendo historial, coherencia contextual y registro automático en la BD/CRM.
 */
export async function processCoherentMessage({
  sessionId,
  incomingText = "",
  channel = "whatsapp", // "whatsapp" | "web_chat" | "web_simulator"
  existingSession = null,
  forceStepMode = false,
  mediaType = null,
  whatsappFrom = "",
}) {
  const cleanText = String(incomingText || "").trim();
  const db = await readDatabase();

  let session = existingSession || (await loadWhatsAppSession(sessionId)) || {
    step: "IDLE",
    name: "",
    phone: whatsappFrom || "",
    email: "",
    serviceNumber: "",
    serviceName: "",
    details: "",
    history: [],
    updatedAt: Date.now(),
  };

  if (forceStepMode && session.step === "IDLE") {
    session.step = "ASK_NAME";
  }

  let reply = "";
  let savedOrder = null;
  let usedAI = false;

  // En modo paso a paso explícito de UI web, priorizar el flujo estructurado pero conservando preguntas coherentes;
  // en WhatsApp o Chat Web libre, intentar primero la IA con historial completo si hay API Key.
  const canTryAI = !forceStepMode && cleanText.length > 0 && getAIStatus().enabled;

  if (canTryAI) {
    const aiResult = await callAIWithHistory({
      userText: cleanText,
      session,
      db,
      channel,
    });

    if (aiResult && aiResult.reply) {
      usedAI = true;
      reply = String(aiResult.reply).trim();
      const draft = aiResult.orderDraft || {};
      session.name = draft.name || session.name;
      session.phone = draft.phone || session.phone || whatsappFrom || "";
      session.email = draft.email || session.email;
      session.serviceName = draft.serviceName || session.serviceName;
      session.details = draft.details || session.details;

      if (aiResult.orderReadyToSave && (draft.serviceName || draft.details)) {
        savedOrder = await recordOrder(
          {
            source: channel === "whatsapp" ? "whatsapp" : "web_chatbot",
            customerName: session.name || "Cliente",
            phone: session.phone || whatsappFrom || "",
            whatsappFrom: whatsappFrom || "",
            email: session.email || "",
            serviceName: session.serviceName || "Pedido por Asistente IA",
            details: session.details || cleanText,
            total: Number(draft.estimatedTotal) > 0 ? Number(draft.estimatedTotal) : undefined,
          },
          usedAI ? `${channel}_ai` : channel
        );
        session.step = "COMPLETED";
        session.lastOrderId = savedOrder.id;
        if (!reply.includes(savedOrder.id)) {
          reply += `\n\n✅ *Código de pedido registrado:* ${savedOrder.id}`;
        }
      }
    }
  }

  if (!usedAI) {
    const fallbackResult = await runContextualFallback({
      sessionId,
      cleanText,
      session,
      db,
      channel,
      mediaType,
      whatsappFrom,
    });
    reply = fallbackResult.reply;
    session = fallbackResult.session;
    savedOrder = fallbackResult.savedOrder;
  }

  session.history = appendHistory(
    session,
    "user",
    cleanText || `[Archivo adjunto: ${mediaType || "multimedia"}]`
  );
  session.history = appendHistory(session, "assistant", reply);
  session.updatedAt = Date.now();

  await saveWhatsAppSession(sessionId, session);

  return {
    reply,
    session,
    savedOrder,
    aiUsed: usedAI,
    aiProvider: usedAI ? getAIStatus().provider : "contextual_local",
  };
}
