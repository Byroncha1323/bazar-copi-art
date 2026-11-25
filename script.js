document.addEventListener("DOMContentLoaded", () => {
  const WHATSAPP_NUMBER = "50664760290";
  const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}`;

  function buildWhatsAppLinkWithText(text = "") {
    if (!text) return WHATSAPP_URL;
    return `${WHATSAPP_URL}?text=${encodeURIComponent(text)}`;
  }

  function escapeHTML(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatWhatsAppTextToHTML(rawText) {
    return escapeHTML(rawText)
      .replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>")
      .replace(/_([^_\n]+)_/g, "<em>$1</em>")
      .replace(/\n/g, "<br>");
  }

  let orderTurnstileToken = "";
  let orderTurnstileWidgetId = null;

  function loadCloudflareTurnstile(containerId, siteKey, onToken) {
    const container = document.getElementById(containerId);
    if (!container || !siteKey) return;

    const renderWidget = () => {
      if (!window.turnstile) return;
      orderTurnstileWidgetId = window.turnstile.render(container, {
        sitekey: siteKey,
        theme: "light",
        callback: (token) => onToken(token),
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
      });
    };

    if (window.turnstile) {
      renderWidget();
      return;
    }

    const existingScript = document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]');
    if (existingScript) {
      existingScript.addEventListener("load", renderWidget);
      return;
    }

    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    s.onload = renderWidget;
    document.head.appendChild(s);
  }

  async function syncOrderToCRM(orderPayload, cfTurnstileToken = "") {
    try {
      const res = await fetch("/api/db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "public_order",
          order: orderPayload,
          cfTurnstileToken,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.order || null;
    } catch {
      return null;
    }
  }

  /* 1. Año actual en el footer */
  const yearEl = document.getElementById("currentYear");
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  /* 2. Menú móvil */
  const menuToggle = document.getElementById("menuToggle");
  const mainNav = document.getElementById("mainNav");

  if (menuToggle && mainNav) {
    menuToggle.addEventListener("click", () => {
      const isOpen = mainNav.classList.toggle("open");
      menuToggle.setAttribute("aria-expanded", String(isOpen));
    });

    mainNav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        mainNav.classList.remove("open");
        menuToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* 3. Estado en vivo del horario de atención */
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");

  function updateStoreStatus() {
    if (!statusDot || !statusText) return;

    const now = new Date();
    const day = now.getDay();
    const minutes = now.getHours() * 60 + now.getMinutes();

    let isOpen = false;
    let message = "";

    if (day >= 1 && day <= 5) {
      isOpen = minutes >= 390 && minutes < 990;
      message = isOpen
        ? "Abierto ahora · L-V hasta las 4:30 p.m."
        : "Cerrado ahora · L-V de 6:30 a.m. a 4:30 p.m.";
    } else if (day === 6) {
      isOpen = minutes >= 540 && minutes < 780;
      message = isOpen
        ? "Abierto ahora · Sábados hasta la 1:00 p.m."
        : "Cerrado ahora · Sábados de 9:00 a.m. a 1:00 p.m.";
    } else {
      isOpen = false;
      message = "Domingo: pedidos por encargo para retirar el lunes";
    }

    statusDot.classList.toggle("open", isOpen);
    statusDot.classList.toggle("closed", !isOpen);
    statusText.textContent = message;
  }

  updateStoreStatus();
  setInterval(updateStoreStatus, 60000);

  /* 4. Filtro de servicios y precios */
  const filterButtons = document.querySelectorAll(".filter-btn");
  const serviceCards = document.querySelectorAll(".service-card");

  filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const filter = btn.dataset.filter;

      filterButtons.forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");

      serviceCards.forEach((card) => {
        const match = filter === "all" || card.dataset.category === filter;
        card.classList.toggle("hidden", !match);
      });
    });
  });

  /* 5. Pestañas de Calidad y Compromiso */
  const qTabs = document.querySelectorAll(".q-tab");
  const qPanels = document.querySelectorAll(".q-panel");

  qTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const targetId = `panel-${tab.dataset.qtab}`;

      qTabs.forEach((t) => t.classList.remove("active"));
      qPanels.forEach((p) => p.classList.remove("active"));

      tab.classList.add("active");
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) targetPanel.classList.add("active");
    });
  });

  /* 6. Formulario rápido para preparar pedido, guardar en CRM y abrir WhatsApp prellenado */
  const orderForm = document.getElementById("whatsappOrderForm");
  const formFeedback = document.getElementById("formFeedback");
  const serviceSelect = document.getElementById("serviceType");

  // Sincronizar catálogo en vivo y seguridad Cloudflare Turnstile desde /api/db
  fetch("/api/db?action=public_catalog")
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data?.ok) return;
      if (data.turnstileSiteKey) {
        loadCloudflareTurnstile("orderTurnstileBox", data.turnstileSiteKey, (t) => {
          orderTurnstileToken = t;
        });
      }
      if (serviceSelect && Array.isArray(data.inventory)) {
        const existingVals = new Set(
          [...serviceSelect.options].map((o) => o.value.toLowerCase())
        );
        data.inventory
          .filter((item) => item.stock > 0 && item.salePrice > 0)
          .forEach((item) => {
            if ([...existingVals].some((v) => v.includes(item.name.toLowerCase()))) return;
            const opt = document.createElement("option");
            opt.value = `${item.name} (₡${item.salePrice.toLocaleString("es-CR")})`;
            opt.textContent = `${item.name} — ₡${item.salePrice.toLocaleString("es-CR")}`;
            serviceSelect.insertBefore(opt, serviceSelect.lastElementChild);
          });
      }
    })
    .catch(() => {});

  if (orderForm) {
    orderForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      if (orderTurnstileWidgetId !== null && !orderTurnstileToken) {
        if (formFeedback) {
          formFeedback.textContent = "Por favor completa la verificación de seguridad arriba antes de enviar.";
        }
        return;
      }

      const name = document.getElementById("customerName").value.trim();
      const phone = document.getElementById("customerPhone")?.value.trim() || "";
      const service = document.getElementById("serviceType").value;
      const details = document.getElementById("orderDetails").value.trim();

      const formattedMessage =
        `Hola Bazar Copi Art, mi nombre es ${name}` +
        (phone ? ` (Tel: ${phone})` : "") +
        `. Me interesa: ${service}. ` +
        `Detalles: ${details}`;

      if (formFeedback) {
        formFeedback.textContent = "Registrando tu pedido y abriendo WhatsApp...";
      }

      const [savedOrder] = await Promise.all([
        syncOrderToCRM(
          {
            source: "web_form",
            customerName: name,
            phone,
            serviceName: service,
            details,
          },
          orderTurnstileToken
        ),
        copyTextToClipboard(formattedMessage),
      ]);

      if (window.turnstile && orderTurnstileWidgetId !== null) {
        orderTurnstileToken = "";
        window.turnstile.reset(orderTurnstileWidgetId);
      }

      if (formFeedback) {
        formFeedback.textContent = savedOrder
          ? `✅ Pedido ${savedOrder.id} registrado en el sistema. Abriendo WhatsApp con tu mensaje listo...`
          : "✅ Mensaje preparado. Abriendo WhatsApp oficial de Bazar Copi Art...";
      }

      window.open(buildWhatsAppLinkWithText(formattedMessage), "_blank", "noopener,noreferrer");
    });
  }

  /* 7. Chatbot Inteligente (IA / Coherente + FAQ + Bot Paso a Paso) */
  const chatbotMessages = document.getElementById("chatbotMessages");
  const chatbotForm = document.getElementById("chatbotForm");
  const chatbotInput = document.getElementById("chatbotInput");
  const chatbotReset = document.getElementById("chatbotReset");
  const faqChips = document.querySelectorAll(".faq-chip");

  const FAQ_DATA = {
    horario: {
      question: "¿Cuál es el horario de atención?",
      answer:
        "Nuestro horario de atención es:<br>" +
        "• <strong>Lunes a Viernes:</strong> 6:30 a.m. – 4:30 p.m.<br>" +
        "• <strong>Sábados:</strong> 9:00 a.m. – 1:00 p.m.<br>" +
        "• <strong>Domingos:</strong> Cerrado para retiros físicos, pero recibimos pedidos por encargo vía WhatsApp para retirar el lunes.",
    },
    impresiones: {
      question: "¿Cuánto cuestan las impresiones y copias?",
      answer:
        "Estos son nuestros precios de impresión y fotocopiado:<br>" +
        "• <strong>Impresiones:</strong> Blanco y negro ₡50 | Color ₡100<br>" +
        "• <strong>Copias:</strong> Blanco y negro ₡20 | Color ₡75<br>" +
        "• <strong>Copias de cédula:</strong> Blanco y negro ₡60 | Color ₡180<br>" +
        "• <strong>Folletos:</strong> ₡20 por página (contamos con precio especial para docentes).",
    },
    encargo: {
      question: "¿Cómo hago un pedido por encargo?",
      answer:
        "¡Es muy fácil! Nos envías tus archivos o la lista de artículos que necesitas por WhatsApp desde tu casa u oficina. Nosotros preparamos todo y te avisamos para que <strong>solamente pases a retirar cuando esté listo</strong>, sin hacer filas.",
    },
    pagos: {
      question: "¿Qué métodos de pago aceptan?",
      answer:
        "Facilitamos tu pago de forma rápida y segura por medio de <strong>SINPE Móvil</strong> y <strong>Efectivo</strong>.",
    },
    regalos: {
      question: "¿Qué artículos de regalo y papelería ofrecen?",
      answer:
        "Contamos con gran variedad de detalles y papelería:<br>" +
        "• <strong>Broches:</strong> Pequeños ₡600 | Grandes ₡1.000<br>" +
        "• <strong>Separadores:</strong> ₡1.500<br>" +
        "• <strong>Tazas:</strong> ₡1.700<br>" +
        "• <strong>Peluches:</strong> Desde ₡2.500 en adelante<br>" +
        "• <strong>Bolsos de tela:</strong> ₡3.000<br>" +
        "• <strong>Stickers (50 uds):</strong> ₡2.500<br>" +
        "• <strong>Papelería personalizada:</strong> Desde ₡8.000 en adelante.",
    },
    negocios: {
      question: "¿Hacen tarjetas, facturas, volantes y emplasticados?",
      answer:
        "¡Sí! Ofrecemos soluciones para profesionales y negocios:<br>" +
        "• <strong>Emplasticado:</strong> Desde ₡600 en adelante (según el tamaño)<br>" +
        "• <strong>Tarjetas de presentación:</strong> Un solo lado ₡2.000 | Ambos lados ₡2.500<br>" +
        "• <strong>Facturas:</strong> Desde ₡3.000 en adelante (según diseño)<br>" +
        "• <strong>Volantes (Papel Bond, 100 uds):</strong> ₡5.000.",
    },
    tiempos: {
      question: "¿Cuánto tardan en responder y entregar?",
      answer:
        "Nuestro compromiso de servicio es:<br>" +
        "• <strong>Primera respuesta:</strong> Menos de 5 minutos presencial y menos de 10 minutos en línea.<br>" +
        "• <strong>Puntualidad y precisión:</strong> 97% de entregas a tiempo y 95% de precisión exacta en cada pedido.",
    },
  };

  function getDirectContactFollowupHTML(prefillText = "") {
    return `
      <div class="chat-direct-followup">
        <p>¿Deseas continuar o enviar tu consulta directo por WhatsApp?</p>
        <a href="${buildWhatsAppLinkWithText(prefillText)}" target="_blank" rel="noopener noreferrer" class="chat-wa-link">
          💬 Hablar por WhatsApp (+506 6476-0290)
        </a>
      </div>
    `;
  }

  function appendChatMessage(role, htmlContent, includeFollowup = false, prefillText = "") {
    if (!chatbotMessages) return null;

    const msgDiv = document.createElement("div");
    msgDiv.className = `chat-msg ${role}`;

    const bubbleDiv = document.createElement("div");
    bubbleDiv.className = "chat-bubble";
    bubbleDiv.innerHTML =
      htmlContent + (includeFollowup ? getDirectContactFollowupHTML(prefillText) : "");

    msgDiv.appendChild(bubbleDiv);
    chatbotMessages.appendChild(msgDiv);
    chatbotMessages.scrollTop = chatbotMessages.scrollHeight;
    return msgDiv;
  }

  function matchFreeTextQuestionLocal(rawText) {
    const text = rawText.toLowerCase();

    if (
      text.includes("horario") ||
      text.includes("hora") ||
      text.includes("abierto") ||
      text.includes("abren") ||
      text.includes("domingo") ||
      text.includes("sabado") ||
      text.includes("sábado")
    ) {
      return FAQ_DATA.horario.answer;
    }
    if (
      text.includes("impresion") ||
      text.includes("impresión") ||
      text.includes("copia") ||
      text.includes("cedula") ||
      text.includes("cédula") ||
      text.includes("folleto") ||
      text.includes("docente") ||
      text.includes("profe")
    ) {
      return FAQ_DATA.impresiones.answer;
    }
    if (
      text.includes("sinpe") ||
      text.includes("pago") ||
      text.includes("pagar") ||
      text.includes("efectivo")
    ) {
      return FAQ_DATA.pagos.answer;
    }
    if (
      text.includes("regalo") ||
      text.includes("taza") ||
      text.includes("peluche") ||
      text.includes("bolso") ||
      text.includes("broche") ||
      text.includes("separador") ||
      text.includes("sticker") ||
      text.includes("papeleria") ||
      text.includes("papelería")
    ) {
      return FAQ_DATA.regalos.answer;
    }
    if (
      text.includes("tarjeta") ||
      text.includes("factura") ||
      text.includes("volante") ||
      text.includes("emplastic")
    ) {
      return FAQ_DATA.negocios.answer;
    }
    if (
      text.includes("encargo") ||
      text.includes("pedido") ||
      text.includes("ubicacion") ||
      text.includes("ubicación") ||
      text.includes("donde") ||
      text.includes("dónde") ||
      text.includes("retir")
    ) {
      return FAQ_DATA.encargo.answer;
    }
    if (
      text.includes("tiempo") ||
      text.includes("tardan") ||
      text.includes("dur") ||
      text.includes("rapido") ||
      text.includes("rápido")
    ) {
      return FAQ_DATA.tiempos.answer;
    }
    if (text.includes("precio") || text.includes("costo") || text.includes("cuanto") || text.includes("cuánto")) {
      return (
        "Manejamos precios muy accesibles: copias desde ₡20, impresiones desde ₡50, emplasticados desde ₡600, regalos desde ₡600 y tarjetas de presentación desde ₡2.000."
      );
    }

    return (
      "¡Gracias por tu consulta! En <strong>Bazar Copi Art</strong> ofrecemos fotocopias, impresiones, emplasticado, tarjetas de presentación, facturas, volantes, artículos de papelería y regalos. Si quieres encargar algo, escribe <strong>PEDIDO</strong>."
    );
  }

  /* 8. Modo Bot Paso a Paso + IA Coherente con Historial */
  const startStepOrderBtn = document.getElementById("startStepOrderBtn");
  let stepBotActive = false;
  let stepSession = null;
  let freeChatSession = { step: "IDLE", history: [] };
  const webSessionId = "web-" + Math.random().toString(36).slice(2, 10);

  const STEP_SERVICE_MENU = {
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

  function buildWhatsAppOrderText(session) {
    return (
      `Hola Bazar Copi Art, quiero realizar el siguiente pedido:\n` +
      `• Nombre: ${session.name}\n` +
      `• Teléfono: ${session.phone}\n` +
      (session.email ? `• Correo: ${session.email}\n` : "") +
      `• Servicio: ${session.serviceName}\n` +
      `• Detalles: ${session.details}`
    );
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  function renderNumberedMenuButtonsHTML() {
    const buttons = Object.entries(STEP_SERVICE_MENU)
      .map(
        ([num, label]) =>
          `<button type="button" class="chat-num-btn" data-menu-num="${num}">${label}</button>`
      )
      .join("");
    return `<div class="chat-menu-options">${buttons}</div>`;
  }

  function attachStepBotInteractiveListeners(containerEl, completedSession) {
    containerEl.querySelectorAll(".chat-num-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const num = btn.getAttribute("data-menu-num");
        if (!num) return;
        handleStepBotUserInput(num);
      });
    });

    if (completedSession) {
      const waText = buildWhatsAppOrderText(completedSession);
      const sendWaBtn = containerEl.querySelector(".js-send-order-wa");
      const copyOrderBtn = containerEl.querySelector(".js-copy-order-wa");
      const noticeEl = containerEl.querySelector(".js-copied-notice");

      if (sendWaBtn) {
        sendWaBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          await copyTextToClipboard(waText);
          if (noticeEl) {
            noticeEl.textContent =
              "✅ Abriendo WhatsApp (+506 6476-0290) con tu pedido listo para enviar...";
          }
          window.open(buildWhatsAppLinkWithText(waText), "_blank", "noopener,noreferrer");
        });
      }

      if (copyOrderBtn) {
        copyOrderBtn.addEventListener("click", async () => {
          const copied = await copyTextToClipboard(waText);
          if (noticeEl) {
            noticeEl.textContent = copied
              ? "✅ ¡Ficha copiada al portapapeles! Lista para pegar en WhatsApp."
              : "No se pudo copiar automáticamente.";
          }
        });
      }
    }
  }

  function appendStepBotMessage(htmlContent, extraHTML = "", completedSession = null) {
    if (!chatbotMessages) return;

    const msgDiv = document.createElement("div");
    msgDiv.className = "chat-msg bot";

    const bubbleDiv = document.createElement("div");
    bubbleDiv.className = "chat-bubble";
    bubbleDiv.innerHTML = htmlContent + extraHTML;

    msgDiv.appendChild(bubbleDiv);
    chatbotMessages.appendChild(msgDiv);
    attachStepBotInteractiveListeners(bubbleDiv, completedSession);
    chatbotMessages.scrollTop = chatbotMessages.scrollHeight;
  }

  function updateStepInputPlaceholder(step) {
    if (!chatbotInput) return;
    switch (step) {
      case "ASK_NAME":
        chatbotInput.placeholder = "Paso 1: Escribe tu nombre completo...";
        break;
      case "ASK_PHONE":
        chatbotInput.placeholder = "Paso 2: Escribe tu número de teléfono (ej. 8888-8888)...";
        break;
      case "ASK_EMAIL":
        chatbotInput.placeholder = "Paso 3: Escribe tu correo (o escribe 'omitir')...";
        break;
      case "ASK_SERVICE":
        chatbotInput.placeholder = "Paso 4: Escribe un número del 1 al 9 o haz clic en una opción...";
        break;
      case "ASK_DETAILS":
        chatbotInput.placeholder = "Paso 5: Escribe la cantidad y detalles de tu pedido...";
        break;
      default:
        chatbotInput.placeholder = "Escribe tu pregunta o pedido aquí (ej. precios, horario, tazas)...";
    }
  }

  function renderCompletedOrderSummary(completedSnapshot, savedOrder) {
    const waFormatted = buildWhatsAppOrderText(completedSnapshot);
    copyTextToClipboard(waFormatted);

    const nameInput = document.getElementById("customerName");
    const detailsInput = document.getElementById("orderDetails");
    if (nameInput) nameInput.value = completedSnapshot.name;
    if (detailsInput) {
      detailsInput.value = `Tel: ${completedSnapshot.phone} | Correo: ${
        completedSnapshot.email || "No indicado"
      } | Servicio: ${completedSnapshot.serviceName} | Detalles: ${completedSnapshot.details}`;
    }

    const orderIdLine = savedOrder?.id
      ? `<span class="chat-order-badge">✅ Registrado en CRM: ${escapeHTML(savedOrder.id)}</span><br><br>`
      : "";

    const summaryHTML =
      `🎉 <strong>¡Ficha de Pedido Lista para Enviar!</strong><br>` +
      orderIdLine +
      `• <strong>Nombre:</strong> ${escapeHTML(completedSnapshot.name)}<br>` +
      `• <strong>Teléfono:</strong> ${escapeHTML(completedSnapshot.phone)}<br>` +
      (completedSnapshot.email
        ? `• <strong>Correo:</strong> ${escapeHTML(completedSnapshot.email)}<br>`
        : "") +
      `• <strong>Servicio:</strong> ${escapeHTML(completedSnapshot.serviceName)}<br>` +
      `• <strong>Detalles:</strong> ${escapeHTML(completedSnapshot.details)}<br><br>` +
      `Tu pedido ya quedó guardado y preparado. Haz clic abajo para abrir nuestro WhatsApp oficial (+506 6476-0290) con el mensaje listo:`;

    const actionsHTML = `
      <div class="chat-order-summary-actions">
        <a href="${buildWhatsAppLinkWithText(waFormatted)}" target="_blank" rel="noopener noreferrer" class="chat-wa-link js-send-order-wa">
          📲 Enviar Pedido Armado a WhatsApp Ahora
        </a>
        <button type="button" class="chat-copy-btn js-copy-order-wa">
          📋 Volver a copiar ficha del pedido
        </button>
        <span class="chat-copied-notice js-copied-notice">✅ Ficha copiada automáticamente al portapapeles</span>
      </div>
    `;

    appendStepBotMessage(summaryHTML, actionsHTML, completedSnapshot);
  }

  async function processLocalOrRemoteStep(userText) {
    const clean = (userText || "").trim();
    const lower = clean.toLowerCase();

    const isReset =
      !stepSession ||
      lower === "hola" ||
      lower === "inicio" ||
      lower === "reiniciar";

    if (isReset || stepSession.step === "COMPLETED") {
      stepSession = {
        step: "ASK_NAME",
        name: "",
        phone: "",
        email: "",
        serviceNumber: "",
        serviceName: "",
        details: "",
        history: [],
      };
      updateStepInputPlaceholder("ASK_NAME");
      appendStepBotMessage(
        "¡Perfecto! Vamos a preparar tu pedido paso a paso para <strong>Bazar Copi Art</strong>. 📝<br><br>" +
          "<strong>Paso 1 de 5:</strong> Por favor escribe tu <strong>nombre completo</strong>:"
      );
      return;
    }

    // Intentar primero con el servidor para mantener coherencia si el usuario hace una pregunta intermedia
    try {
      const res = await fetch("/api/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "simulate",
          sessionId: webSessionId,
          text: clean,
          session: stepSession,
          forceStepMode: true,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data?.ok && data.session) {
          stepSession = data.session;
          updateStepInputPlaceholder(stepSession.step);

          if (stepSession.step === "COMPLETED") {
            stepBotActive = false;
            renderCompletedOrderSummary({ ...stepSession }, data.savedOrder);
            return;
          }

          if (stepSession.step === "IDLE") {
            stepBotActive = false;
            appendStepBotMessage(formatWhatsAppTextToHTML(data.reply));
            return;
          }

          const extra =
            stepSession.step === "ASK_SERVICE" ? renderNumberedMenuButtonsHTML() : "";
          appendStepBotMessage(formatWhatsAppTextToHTML(data.reply), extra);
          return;
        }
      }
    } catch {
      // Fallback local si no hay servidor
    }

    // Fallback local si /api/whatsapp no respondió
    if (stepSession.step === "ASK_NAME") {
      if (clean.length < 2) {
        appendStepBotMessage("Por favor escribe tu <strong>nombre completo</strong> para continuar:");
        return;
      }
      stepSession.name = clean;
      stepSession.step = "ASK_PHONE";
      updateStepInputPlaceholder("ASK_PHONE");
      appendStepBotMessage(
        `¡Mucho gusto, <strong>${escapeHTML(stepSession.name)}</strong>! 😊<br><br>` +
          `<strong>Paso 2 de 5:</strong> Indícanos tu <strong>número de teléfono</strong> de contacto (ej. 8888-8888):`
      );
      return;
    }

    if (stepSession.step === "ASK_PHONE") {
      const digits = clean.replace(/\D/g, "");
      if (digits.length < 7) {
        appendStepBotMessage("Por favor ingresa un <strong>número de teléfono válido</strong> (ej. 8888-8888):");
        return;
      }
      stepSession.phone = clean;
      stepSession.step = "ASK_EMAIL";
      updateStepInputPlaceholder("ASK_EMAIL");
      appendStepBotMessage(
        `Teléfono registrado (<strong>${escapeHTML(stepSession.phone)}</strong>). 📱<br><br>` +
          `<strong>Paso 3 de 5:</strong> Ahora escribe tu <strong>correo electrónico</strong> (o escribe <strong>omitir</strong>):`
      );
      return;
    }

    if (stepSession.step === "ASK_EMAIL") {
      const skip = lower === "omitir" || lower === "no" || lower === "sin correo";
      if (!skip && (!clean.includes("@") || !clean.includes("."))) {
        appendStepBotMessage("Por favor ingresa un <strong>correo electrónico válido</strong> o escribe <strong>omitir</strong>:");
        return;
      }
      stepSession.email = skip ? "" : clean;
      stepSession.step = "ASK_SERVICE";
      updateStepInputPlaceholder("ASK_SERVICE");
      appendStepBotMessage(
        `¡Gracias, <strong>${escapeHTML(stepSession.name)}</strong>! Ya guardamos tus datos.<br><br>` +
          `<strong>Paso 4 de 5:</strong> Escribe el <strong>número (del 1 al 9)</strong> o haz clic en el servicio que necesitas:`,
        renderNumberedMenuButtonsHTML()
      );
      return;
    }

    if (stepSession.step === "ASK_SERVICE") {
      const match = clean.match(/^[1-9]$/);
      const num = match ? match[0] : null;
      if (!num || !STEP_SERVICE_MENU[num]) {
        appendStepBotMessage(
          "Por favor responde con un <strong>número del 1 al 9</strong> o selecciona una opción de la lista:",
          renderNumberedMenuButtonsHTML()
        );
        return;
      }
      stepSession.serviceNumber = num;
      stepSession.serviceName = STEP_SERVICE_MENU[num];
      stepSession.step = "ASK_DETAILS";
      updateStepInputPlaceholder("ASK_DETAILS");
      appendStepBotMessage(
        `Has seleccionado:<br>✅ <strong>${escapeHTML(stepSession.serviceName)}</strong><br><br>` +
          `<strong>Paso 5 de 5:</strong> Escribe la <strong>cantidad y detalles</strong> de lo que necesitas:`
      );
      return;
    }

    if (stepSession.step === "ASK_DETAILS") {
      stepSession.details = clean;
      stepSession.step = "COMPLETED";
      stepBotActive = false;
      updateStepInputPlaceholder("IDLE");

      const completedSnapshot = { ...stepSession };
      const savedOrder = await syncOrderToCRM({
        source: "web_chatbot",
        customerName: completedSnapshot.name,
        phone: completedSnapshot.phone,
        email: completedSnapshot.email,
        serviceName: completedSnapshot.serviceName,
        details: completedSnapshot.details,
      });

      renderCompletedOrderSummary(completedSnapshot, savedOrder);
    }
  }

  async function handleStepBotUserInput(text) {
    appendChatMessage("user", escapeHTML(text), false);
    await processLocalOrRemoteStep(text);
    if (chatbotInput) chatbotInput.focus();
  }

  async function handleFreeAIChatInput(userQuestion) {
    appendChatMessage("user", escapeHTML(userQuestion), false);

    const typingNode = appendChatMessage(
      "bot",
      '<span class="chat-typing">Escribiendo respuesta coherente...</span>',
      false
    );

    try {
      const res = await fetch("/api/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "chat",
          sessionId: webSessionId,
          text: userQuestion,
          session: freeChatSession,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (typingNode) typingNode.remove();

        if (data?.ok && data.reply) {
          freeChatSession = data.session || freeChatSession;
          let html = formatWhatsAppTextToHTML(data.reply);
          if (data.savedOrder?.id) {
            html += `<br><span class="chat-order-badge">✅ Pedido registrado en CRM: ${escapeHTML(
              data.savedOrder.id
            )}</span>`;
          }
          const waPrefill = data.savedOrder
            ? `Hola Bazar Copi Art, acabo de registrar mi pedido ${data.savedOrder.id} (${data.savedOrder.serviceName}: ${data.savedOrder.details}) a nombre de ${data.savedOrder.customerName}.`
            : userQuestion;

          appendChatMessage("bot", html, true, waPrefill);
          return;
        }
      }
    } catch {
      // Fallback local
    }

    if (typingNode) typingNode.remove();
    const localReply = matchFreeTextQuestionLocal(userQuestion);
    appendChatMessage("bot", localReply, true, userQuestion);
  }

  faqChips.forEach((chip) => {
    if (chip.id === "startStepOrderBtn") return;
    chip.addEventListener("click", () => {
      const key = chip.dataset.faq;
      const item = FAQ_DATA[key];
      if (!item) return;

      stepBotActive = false;
      stepSession = null;
      updateStepInputPlaceholder("IDLE");

      appendChatMessage("user", escapeHTML(item.question), false);
      setTimeout(() => {
        appendChatMessage("bot", item.answer, true, item.question);
      }, 180);
    });
  });

  if (startStepOrderBtn) {
    startStepOrderBtn.addEventListener("click", async () => {
      stepBotActive = true;
      stepSession = null;
      appendChatMessage("user", "Quiero hacer un pedido paso a paso", false);
      await processLocalOrRemoteStep("hola");
      if (chatbotInput) chatbotInput.focus();
    });
  }

  if (chatbotForm && chatbotInput) {
    chatbotForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const userQuestion = chatbotInput.value.trim();
      if (!userQuestion) return;

      chatbotInput.value = "";
      const lower = userQuestion.toLowerCase();

      if (stepBotActive) {
        await handleStepBotUserInput(userQuestion);
        return;
      }

      if (lower === "pedido paso a paso" || lower === "paso a paso") {
        stepBotActive = true;
        await handleStepBotUserInput("hola");
        return;
      }

      await handleFreeAIChatInput(userQuestion);
    });
  }

  if (chatbotReset && chatbotMessages) {
    chatbotReset.addEventListener("click", () => {
      stepBotActive = false;
      stepSession = null;
      freeChatSession = { step: "IDLE", history: [] };
      updateStepInputPlaceholder("IDLE");
      chatbotMessages.innerHTML = `
        <div class="chat-msg bot">
          <div class="chat-bubble">
            ¡Hola! 👋 Soy el asistente virtual de <strong>Bazar Copi Art</strong>.
            Escríbeme cualquier pregunta o pedido con total libertad, o selecciona <strong>"📝 Hacer Pedido Paso a Paso"</strong> a la izquierda.
          </div>
        </div>
      `;
    });
  }
});
