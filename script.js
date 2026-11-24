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
    chip.addEventListener("click", () => {
      const key = chip.dataset.faq;
      const item = FAQ_DATA[key];
      if (!item) return;

      appendChatMessage("user", item.question, false);
      setTimeout(() => {
        appendChatMessage("bot", item.answer, true);
      }, 220);
    });
  });

  if (chatbotForm && chatbotInput) {
    chatbotForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const userQuestion = chatbotInput.value.trim();
      if (!userQuestion) return;

      appendChatMessage("user", userQuestion, false);
      chatbotInput.value = "";

      const answerHTML = matchFreeTextQuestion(userQuestion);
      setTimeout(() => {
        appendChatMessage("bot", answerHTML, true);
      }, 250);
    });
  }

  if (chatbotReset && chatbotMessages) {
    chatbotReset.addEventListener("click", () => {
      chatbotMessages.innerHTML = `
        <div class="chat-msg bot">
          <div class="chat-bubble">
            ¡Hola! 👋 Soy el asistente virtual de <strong>Bazar Copi Art</strong>.
            Selecciona una pregunta frecuente a la izquierda o escribe tu duda abajo y con gusto te ayudaré.
          </div>
        </div>
      `;
    });
  }
});
