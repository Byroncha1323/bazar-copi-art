document.addEventListener("DOMContentLoaded", () => {
  const WHATSAPP_URL = "https://wa.me/message/I5R57DVEH2T7L1";

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
    const day = now.getDay(); // 0 = Domingo, 1..5 = L-V, 6 = Sábado
    const minutes = now.getHours() * 60 + now.getMinutes();

    let isOpen = false;
    let message = "";

    if (day >= 1 && day <= 5) {
      // L-V: 6:30am (390) - 4:30pm (990)
      isOpen = minutes >= 390 && minutes < 990;
      message = isOpen
        ? "Abierto ahora · L-V hasta las 4:30 p.m."
        : "Cerrado ahora · L-V de 6:30 a.m. a 4:30 p.m.";
    } else if (day === 6) {
      // S: 9:00am (540) - 1:00pm (780)
      isOpen = minutes >= 540 && minutes < 780;
      message = isOpen
        ? "Abierto ahora · Sábados hasta la 1:00 p.m."
        : "Cerrado ahora · Sábados de 9:00 a.m. a 1:00 p.m.";
    } else {
      // Domingo
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

  /* 6. Formulario rápido para preparar pedido y abrir WhatsApp */
  const orderForm = document.getElementById("whatsappOrderForm");
  const formFeedback = document.getElementById("formFeedback");

  if (orderForm) {
    orderForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const name = document.getElementById("customerName").value.trim();
      const service = document.getElementById("serviceType").value;
      const details = document.getElementById("orderDetails").value.trim();

      const formattedMessage =
        `Hola Bazar Copi Art, mi nombre es ${name}. ` +
        `Me interesa: ${service}. ` +
        `Detalles: ${details}`;

      let copied = false;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(formattedMessage);
          copied = true;
        } catch {
          copied = false;
        }
      }

      if (formFeedback) {
        formFeedback.textContent = copied
          ? "Mensaje copiado al portapapeles. Abriendo WhatsApp para que solo lo pegues y envíes..."
          : "Abriendo WhatsApp oficial de Bazar Copi Art...";
      }

      window.open(WHATSAPP_URL, "_blank", "noopener,noreferrer");
    });
  }

  /* 7. Chatbot de Preguntas Frecuentes (FAQ) */
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

  function getDirectContactFollowupHTML() {
    return `
      <div class="chat-direct-followup">
        <p>¿Tienes consultas más directas o deseas hacer tu pedido personalizado? Contáctanos directamente:</p>
        <a href="${WHATSAPP_URL}" target="_blank" rel="noopener noreferrer" class="chat-wa-link">
          💬 Contactar directamente por WhatsApp
        </a>
      </div>
    `;
  }

  function appendChatMessage(role, htmlContent, includeFollowup = false) {
    if (!chatbotMessages) return;

    const msgDiv = document.createElement("div");
    msgDiv.className = `chat-msg ${role}`;

    const bubbleDiv = document.createElement("div");
    bubbleDiv.className = "chat-bubble";
    bubbleDiv.innerHTML =
      htmlContent + (includeFollowup ? getDirectContactFollowupHTML() : "");

    msgDiv.appendChild(bubbleDiv);
    chatbotMessages.appendChild(msgDiv);
    chatbotMessages.scrollTop = chatbotMessages.scrollHeight;
  }

  function matchFreeTextQuestion(rawText) {
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
      "¡Gracias por tu consulta! En <strong>Bazar Copi Art</strong> ofrecemos fotocopias, impresiones, emplasticado, tarjetas de presentación, facturas, volantes, artículos de papelería y regalos."
    );
  }

  faqChips.forEach((chip) => {
    if (chip.id === "startStepOrderBtn") return;
    chip.addEventListener("click", () => {
      const key = chip.dataset.faq;
      const item = FAQ_DATA[key];
      if (!item) return;

      stepBotActive = false;
      stepSession = null;

      appendChatMessage("user", item.question, false);
      setTimeout(() => {
        appendChatMessage("bot", item.answer, true);
      }, 220);
    });
  });

  /* 8. Modo Bot Paso a Paso (Nombre -> Teléfono -> Correo -> Menú 1 al 9 -> Detalles -> Enviar armado a WhatsApp) */
  const startStepOrderBtn = document.getElementById("startStepOrderBtn");
  let stepBotActive = false;
  let stepSession = null;
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
      `• Correo: ${session.email}\n` +
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
    // Botones del menú numérico (1 al 9)
    containerEl.querySelectorAll(".chat-num-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const num = btn.getAttribute("data-menu-num");
        if (!num) return;
        handleStepBotUserInput(num);
      });
    });

    // Acciones finales cuando el pedido está completo
    if (completedSession) {
      const waText = buildWhatsAppOrderText(completedSession);
      const sendWaBtn = containerEl.querySelector(".js-send-order-wa");
      const copyOrderBtn = containerEl.querySelector(".js-copy-order-wa");
      const noticeEl = containerEl.querySelector(".js-copied-notice");

      if (sendWaBtn) {
        sendWaBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          const copied = await copyTextToClipboard(waText);
          if (noticeEl) {
            noticeEl.textContent = copied
              ? "✅ ¡Ficha copiada! Abriendo WhatsApp oficial para que solo la pegues y envíes..."
              : "Abriendo WhatsApp oficial de Bazar Copi Art...";
          }
          window.open(WHATSAPP_URL, "_blank", "noopener,noreferrer");
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

  async function processLocalOrRemoteStep(userText) {
    const clean = (userText || "").trim();
    const lower = clean.toLowerCase();

    // Sincronizar en segundo plano con /api/whatsapp en Vercel
    fetch("/api/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "simulate",
        sessionId: webSessionId,
        text: clean,
        session: stepSession,
      }),
    }).catch(() => {});

    const isReset =
      !stepSession ||
      lower === "hola" ||
      lower === "inicio" ||
      lower === "menu" ||
      lower === "menú" ||
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
      };
      if (chatbotInput) {
        chatbotInput.placeholder = "Paso 1: Escribe tu nombre completo...";
      }
      appendStepBotMessage(
        "¡Perfecto! Vamos a preparar tu pedido paso a paso para <strong>Bazar Copi Art</strong>. 📝<br><br>" +
          "<strong>Paso 1 de 5:</strong> Por favor escribe tu <strong>nombre completo</strong>:"
      );
      return;
    }

    if (stepSession.step === "ASK_NAME") {
      if (clean.length < 2) {
        appendStepBotMessage("Por favor escribe tu <strong>nombre completo</strong> para continuar:");
        return;
      }
      stepSession.name = clean;
      stepSession.step = "ASK_PHONE";
      if (chatbotInput) {
        chatbotInput.placeholder = "Paso 2: Escribe tu número de teléfono (ej. 8888-8888)...";
      }
      appendStepBotMessage(
        `¡Mucho gusto, <strong>${stepSession.name}</strong>! 😊<br><br>` +
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
      if (chatbotInput) {
        chatbotInput.placeholder = "Paso 3: Escribe tu correo electrónico (ej. nombre@correo.com)...";
      }
      appendStepBotMessage(
        `Teléfono registrado (<strong>${stepSession.phone}</strong>). 📱<br><br>` +
          `<strong>Paso 3 de 5:</strong> Ahora escribe tu <strong>correo electrónico</strong>:`
      );
      return;
    }

    if (stepSession.step === "ASK_EMAIL") {
      if (!clean.includes("@") || !clean.includes(".")) {
        appendStepBotMessage("Por favor ingresa un <strong>correo electrónico válido</strong> (ej. cliente@correo.com):");
        return;
      }
      stepSession.email = clean;
      stepSession.step = "ASK_SERVICE";
      if (chatbotInput) {
        chatbotInput.placeholder = "Paso 4: Escribe un número del 1 al 9 o haz clic en una opción...";
      }
      appendStepBotMessage(
        `¡Gracias, <strong>${stepSession.name}</strong>! Ya guardamos tus datos personales.<br><br>` +
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
      if (chatbotInput) {
        chatbotInput.placeholder = "Paso 5: Escribe la cantidad y detalles de tu pedido...";
      }
      appendStepBotMessage(
        `Has seleccionado:<br>✅ <strong>${stepSession.serviceName}</strong><br><br>` +
          `<strong>Paso 5 de 5:</strong> Escribe la <strong>cantidad y detalles</strong> de lo que necesitas (ej. blanco y negro o color, tamaño, o especificaciones):`
      );
      return;
    }

    if (stepSession.step === "ASK_DETAILS") {
      stepSession.details = clean;
      stepSession.step = "COMPLETED";
      stepBotActive = false;
      if (chatbotInput) {
        chatbotInput.placeholder = "Escribe tu pregunta aquí (ej. precios, horario, SINPE, regalos)...";
      }

      const completedSnapshot = { ...stepSession };
      const waFormatted = buildWhatsAppOrderText(completedSnapshot);
      await copyTextToClipboard(waFormatted);

      // Rellenar también el formulario de contacto inferior automáticamente
      const nameInput = document.getElementById("customerName");
      const detailsInput = document.getElementById("orderDetails");
      if (nameInput) nameInput.value = completedSnapshot.name;
      if (detailsInput) {
        detailsInput.value = `Tel: ${completedSnapshot.phone} | Correo: ${completedSnapshot.email} | Servicio: ${completedSnapshot.serviceName} | Detalles: ${completedSnapshot.details}`;
      }

      const summaryHTML =
        `🎉 <strong>¡Ficha de Pedido Lista para Enviar!</strong><br><br>` +
        `• <strong>Nombre:</strong> ${completedSnapshot.name}<br>` +
        `• <strong>Teléfono:</strong> ${completedSnapshot.phone}<br>` +
        `• <strong>Correo:</strong> ${completedSnapshot.email}<br>` +
        `• <strong>Servicio:</strong> ${completedSnapshot.serviceName}<br>` +
        `• <strong>Detalles:</strong> ${completedSnapshot.details}<br><br>` +
        `Hemos copiado tu ficha automáticamente. Haz clic abajo para abrir nuestro WhatsApp oficial, pegar tu pedido y recibir atención directa en menos de 10 minutos:`;

      const actionsHTML = `
        <div class="chat-order-summary-actions">
          <a href="${WHATSAPP_URL}" target="_blank" rel="noopener noreferrer" class="chat-wa-link js-send-order-wa">
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
  }

  async function handleStepBotUserInput(text) {
    appendChatMessage("user", text, false);
    await processLocalOrRemoteStep(text);
    if (chatbotInput) chatbotInput.focus();
  }

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

      if (
        stepBotActive ||
        lower === "hola" ||
        lower === "menu" ||
        lower === "menú" ||
        lower === "pedido" ||
        lower === "comprar"
      ) {
        stepBotActive = true;
        await handleStepBotUserInput(userQuestion);
        return;
      }

      appendChatMessage("user", userQuestion, false);
      const answerHTML = matchFreeTextQuestion(userQuestion);
      setTimeout(() => {
        appendChatMessage("bot", answerHTML, true);
      }, 250);
    });
  }

  if (chatbotReset && chatbotMessages) {
    chatbotReset.addEventListener("click", () => {
      stepBotActive = false;
      stepSession = null;
      if (chatbotInput) {
        chatbotInput.placeholder = "Escribe tu pregunta aquí (ej. precios, horario, SINPE, regalos)...";
      }
      chatbotMessages.innerHTML = `
        <div class="chat-msg bot">
          <div class="chat-bubble">
            ¡Hola! 👋 Soy el asistente virtual de <strong>Bazar Copi Art</strong>.
            Selecciona <strong>"📝 Hacer Pedido Paso a Paso"</strong> a la izquierda para registrar tu pedido con menú numérico, o elige una pregunta frecuente.
          </div>
        </div>
      `;
    });
  }
});
