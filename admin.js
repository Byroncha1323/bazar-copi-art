import {
  buildXlsxBytes,
  buildCsvText,
  parseCsvToObjects,
  parseXlsxToObjects,
  parseAllXlsxSheets,
} from "./xlsx-utils.js";

const TOKEN_KEY = "bazar_admin_token";
const IDB_NAME = "BazarCopiArtLocalDB";
const IDB_STORE = "snapshots";

let authToken = sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || "";
let dbState = null;
let localDirHandle = null;
let modalSubmitHandler = null;
let waTesterSession = { step: "IDLE", history: [] };

const el = (id) => document.getElementById(id);

function showToast(msg) {
  const toast = el("toastEl");
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 3200);
}

function escapeHTML(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatColones(amount) {
  const num = Number(amount) || 0;
  return `₡${num.toLocaleString("es-CR")}`;
}

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("es-CR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatWaCustomerPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length === 8 ? `506${digits}` : digits;
}

// ================= INDEXEDDB LOCAL MIRROR =================
function openLocalIDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB no disponible"));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveLocalMirror(state) {
  try {
    const idb = await openLocalIDB();
    const tx = idb.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    store.put({
      key: "latest",
      savedAt: new Date().toISOString(),
      data: {
        inventory: state.inventory,
        orders: state.orders,
        customers: state.customers,
        machines: state.machines,
        backups: state.backups,
      },
    });
    const label = el("localMirrorText");
    if (label) {
      const hora = new Date().toLocaleTimeString("es-CR").replace(/\.$/, "");
      label.textContent = `Copia de seguridad en esta computadora: guardada a las ${hora}.`;
    }
  } catch {
    // Silenciar si IndexedDB está bloqueado en modo privado
  }
}

async function loadLocalMirror() {
  try {
    const idb = await openLocalIDB();
    return await new Promise((resolve) => {
      const tx = idb.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get("latest");
      req.onsuccess = () => resolve(req.result?.data || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function writeToLinkedLocalFolder(state) {
  if (!localDirHandle) return;
  try {
    const perm = await localDirHandle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") return;

    const jsonHandle = await localDirHandle.getFileHandle("bazar-copi-art-bd-local.json", {
      create: true,
    });
    const jWritable = await jsonHandle.createWritable();
    await jWritable.write(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          inventory: state.inventory,
          orders: state.orders,
          customers: state.customers,
          machines: state.machines,
          backups: state.backups,
        },
        null,
        2
      )
    );
    await jWritable.close();

    const xlsxBytes = buildXlsxBytes(buildWorkbookSheets(state));
    const xlsxHandle = await localDirHandle.getFileHandle("Bazar-Copi-Art-CRM.xlsx", {
      create: true,
    });
    const xWritable = await xlsxHandle.createWritable();
    await xWritable.write(xlsxBytes);
    await xWritable.close();
  } catch (err) {
    console.warn("No se pudo escribir en carpeta local vinculada:", err);
  }
}

// ================= API FETCH HELPER =================
async function apiFetch(url, options = {}) {
  const headers = {
    ...(options.headers || {}),
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    handleForceLogout();
    throw new Error("Sesión expirada.");
  }
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || "Error en la operación.");
  }
  return data;
}

function handleForceLogout() {
  authToken = "";
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
  el("adminShell").style.display = "none";
  el("loginView").style.display = "flex";
}

// ================= LOGIN Y AUTENTICACIÓN =================
let loginTurnstileToken = "";
let loginTurnstileWidgetId = null;

function initLoginTurnstile(siteKey) {
  const container = el("loginTurnstileBox");
  if (!container || !siteKey || loginTurnstileWidgetId !== null) return;

  const render = () => {
    if (!window.turnstile || loginTurnstileWidgetId !== null) return;
    loginTurnstileWidgetId = window.turnstile.render(container, {
      sitekey: siteKey,
      theme: "light",
      callback: (token) => {
        loginTurnstileToken = token;
      },
      "expired-callback": () => {
        loginTurnstileToken = "";
      },
      "error-callback": () => {
        loginTurnstileToken = "";
      },
    });
  };

  if (window.turnstile) {
    render();
    return;
  }

  const s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  s.async = true;
  s.defer = true;
  s.onload = render;
  document.head.appendChild(s);
}

async function checkInitialAuth() {
  try {
    const res = await fetch("/api/auth", {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    const data = await res.json();
    if (data.turnstileSiteKey) {
      initLoginTurnstile(data.turnstileSiteKey);
    }
    if (data.authenticated) {
      showAdminShell();
      await refreshDatabase();
      return;
    }
  } catch {
    // Mostrar login
  }
  el("loginView").style.display = "flex";
  el("adminShell").style.display = "none";
}

function showAdminShell() {
  el("loginView").style.display = "none";
  el("adminShell").style.display = "flex";
}

el("loginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = el("loginUser").value.trim();
  const password = el("loginPass").value;
  const errEl = el("loginError");
  const btn = el("loginSubmitBtn");

  errEl.classList.remove("visible");

  if (loginTurnstileWidgetId !== null && !loginTurnstileToken) {
    errEl.textContent = "Completa la verificación de seguridad antes de entrar.";
    errEl.classList.add("visible");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Verificando...";

  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        cfTurnstileToken: loginTurnstileToken,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Usuario o contraseña incorrectos.");
    }

    authToken = data.token;
    sessionStorage.setItem(TOKEN_KEY, authToken);
    localStorage.setItem(TOKEN_KEY, authToken);
    el("loginPass").value = "";
    showAdminShell();
    await refreshDatabase();
    showToast(`¡Bienvenido(a), ${data.username}!`);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add("visible");
  } finally {
    if (window.turnstile && loginTurnstileWidgetId !== null) {
      loginTurnstileToken = "";
      window.turnstile.reset(loginTurnstileWidgetId);
    }
    btn.disabled = false;
    btn.textContent = "🔐 Entrar a Mi Negocio";
  }
});

el("logoutBtn")?.addEventListener("click", async () => {
  try {
    await fetch("/api/auth", { method: "DELETE" });
  } catch {
    // Continuar
  }
  handleForceLogout();
});

// ================= SINCRONIZACIÓN DE DATOS =================
async function refreshDatabase(silent = false) {
  try {
    const prevOrdersCount = dbState?.orders?.length || 0;
    const data = await apiFetch("/api/db");

    // Si el servidor reinició en caché volátil sin datos de pedidos, pero el espejo local tiene datos reales,
    // sincronizar desde local para proteger el historial.
    const localCopy = await loadLocalMirror();
    if (
      localCopy &&
      Array.isArray(localCopy.orders) &&
      localCopy.orders.length > 0 &&
      (data.orders || []).length === 0
    ) {
      const restored = await apiFetch("/api/db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "restore_backup",
          snapshotData: localCopy,
        }),
      });
      dbState = restored;
      showToast("Datos recuperados automáticamente desde tu base local.");
    } else {
      dbState = data;
      if (silent && prevOrdersCount > 0 && (dbState.orders?.length || 0) > prevOrdersCount) {
        showToast("🔔 ¡Llegó un nuevo pedido desde la web o WhatsApp!");
      }
    }

    await saveLocalMirror(dbState);
    await writeToLinkedLocalFolder(dbState);
    renderAll();
    if (!silent) {
      updateSyncPill(true);
    }
  } catch (err) {
    if (!silent) showToast(err.message);
    updateSyncPill(false);
  }
}

async function mutateDb(payload, toastMessage = "") {
  const data = await apiFetch("/api/db", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  dbState = data;
  await saveLocalMirror(dbState);
  await writeToLinkedLocalFolder(dbState);
  renderAll();
  if (toastMessage) showToast(toastMessage);
}

function updateSyncPill(ok) {
  const pill = el("syncStatusPill");
  if (!pill) return;
  if (!ok) {
    pill.textContent = "● Sin conexión al servidor";
    pill.classList.add("warn");
    return;
  }
  const persistent = dbState?.storageStatus?.persistent;
  pill.textContent = persistent
    ? "● Todo guardado al día"
    : "● Guardado automáticamente";
  pill.classList.toggle("warn", !persistent);
}

// Auto-sincronización cada 15s cuando no hay modal abierto ni edición en curso
setInterval(() => {
  if (!authToken || !dbState) return;
  if (el("editorModal")?.classList.contains("open")) return;
  const activeTag = document.activeElement?.tagName;
  if (activeTag === "INPUT" || activeTag === "SELECT" || activeTag === "TEXTAREA") return;
  refreshDatabase(true);
}, 15000);

el("syncNowBtn")?.addEventListener("click", () => {
  refreshDatabase(false);
  showToast("Base de datos sincronizada.");
});

// ================= NAVEGACIÓN POR PESTAÑAS =================
function activateTab(tabName) {
  document.querySelectorAll(".admin-tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  document.querySelectorAll(".admin-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${tabName}`);
  });
}

document.querySelectorAll(".admin-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => activateTab(btn.dataset.tab));
});

document.querySelectorAll("[data-jump-tab]").forEach((btn) => {
  btn.addEventListener("click", () => activateTab(btn.dataset.jumpTab));
});

el("goToSecurityBtn")?.addEventListener("click", () => activateTab("respaldos"));

el("togglePassBtn")?.addEventListener("click", () => {
  const input = el("loginPass");
  if (!input) return;
  input.type = input.type === "password" ? "text" : "password";
});

el("quickNewOrderBtn")?.addEventListener("click", () => openOrderModal(null));
el("quickExportXlsxBtn")?.addEventListener("click", exportFullExcelWorkbook);
el("dayCloseBtn")?.addEventListener("click", async () => {
  await mutateDb(
    { action: "create_backup", reason: `Cierre del día ${new Date().toLocaleDateString("es-CR")}` },
    ""
  );
  exportFullExcelWorkbook();
  showToast("✅ Cierre del día listo: respaldo guardado y Excel descargado.");
});
el("quickInvBtn")?.addEventListener("click", () => activateTab("inventario"));
el("quickHelpBtn")?.addEventListener("click", () => {
  openModal(
    "❓ Guía Fácil de Uso",
    `
      <div class="full-span" style="display:flex;flex-direction:column;gap:10px;font-size:0.92rem;">
        <div class="guide-step"><strong>1. Pedidos que llegan solos:</strong> Cada vez que un cliente pide desde la página, aparece automáticamente en <em>📋 Ventas y Pedidos</em>.</div>
        <div class="guide-step"><strong>2. Avisar al cliente con 1 clic:</strong> Toca <em>✅ Listo</em> cuando termines el trabajo y luego <em>💬 WhatsApp</em> para mandarle el aviso ya escrito.</div>
        <div class="guide-step"><strong>3. Ventas en el mostrador:</strong> En <em>🏠 Inicio</em> toca <em>+ Apuntar Venta en Tienda</em> y elige el producto para que se descuente del inventario.</div>
        <div class="guide-step"><strong>4. Inventario y Máquinas:</strong> En <em>📦 Inventario</em> usa <strong>+ / -</strong> para sumar o restar cantidad, y en <em>🖨️ Máquinas</em> anota tintas y mantenimientos.</div>
        <div class="guide-step"><strong>5. Al cerrar el día:</strong> Toca <strong>📊 Cierre del Día (Guardar + Excel)</strong>; guarda una copia de seguridad y descarga tu Excel completo del día.</div>
      </div>
    `,
    async () => closeModal(),
    { readOnly: true }
  );
});

// ================= RENDERIZADO GLOBAL =================
function renderAll() {
  if (!dbState) return;

  el("defaultPassBanner").style.display = dbState.usingDefaultPassword ? "flex" : "none";
  if (el("newAdminUser") && !el("newAdminUser").value) {
    el("newAdminUser").value = dbState.username || "copiart";
  }

  updateSyncPill(true);
  renderDashboard();
  renderCRMOrders();
  renderInventory();
  renderCustomers();
  renderMachines();
  renderBackupsAndStatus();
}

function renderDashboard() {
  const orders = dbState.orders || [];
  const inventory = dbState.inventory || [];
  const machines = dbState.machines || [];
  const customers = dbState.customers || [];

  const todayIso = new Date().toISOString().slice(0, 10);
  const todaySales = orders
    .filter((o) => o.status !== "Cancelado" && String(o.createdAt || "").startsWith(todayIso))
    .reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  const totalSales = orders
    .filter((o) => o.status !== "Cancelado")
    .reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  const pendingOrders = orders.filter(
    (o) => o.status === "Pendiente" || o.status === "En Proceso"
  ).length;
  const lowStock = inventory.filter((i) => Number(i.stock) <= Number(i.minStock));
  const activeMachines = machines.filter((m) => m.status === "Operativa").length;

  const crmTabBtn = el("crmTabBtn");
  if (crmTabBtn) {
    crmTabBtn.textContent =
      pendingOrders > 0
        ? `📋 Ventas y Pedidos (${pendingOrders})`
        : "📋 Ventas y Pedidos";
  }

  el("kpiStatsGrid").innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Ventas de Hoy</div>
      <div class="stat-value">${formatColones(todaySales)}</div>
      <div class="stat-sub">Total acumulado: ${formatColones(totalSales)} (${orders.length} pedidos)</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Pedidos Por Atender</div>
      <div class="stat-value">${pendingOrders}</div>
      <div class="stat-sub">Pendientes o en preparación</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Productos por Acabarse</div>
      <div class="stat-value">${lowStock.length}</div>
      <div class="stat-sub">De ${inventory.length} productos en total</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Máquinas Trabajando</div>
      <div class="stat-value">${activeMachines} / ${machines.length}</div>
      <div class="stat-sub">Fotocopiadoras, impresoras y equipos</div>
    </div>
  `;

  const recentRows = orders.slice(0, 6);
  el("recentOrdersBody").innerHTML =
    recentRows.length === 0
      ? `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:18px;">Todavía no hay pedidos. Apenas un cliente pida desde la página web, aparecerá aquí solo.</td></tr>`
      : recentRows
          .map(
            (o) => `
          <tr>
            <td><strong>${escapeHTML(o.id)}</strong></td>
            <td>${escapeHTML(o.customerName)}</td>
            <td>${escapeHTML(o.serviceName)}</td>
            <td><strong>${formatColones(o.total)}</strong></td>
            <td><span class="badge badge-plum">${escapeHTML(o.status)}</span></td>
          </tr>
        `
          )
          .join("");

  const alerts = [];
  lowStock.forEach((item) => {
    alerts.push(
      `<div class="guide-step" style="border-left-color:#d92d20;">📦 <strong>Stock bajo:</strong> ${escapeHTML(
        item.name
      )} (${item.stock} ${escapeHTML(item.unit)} restantes, mínimo ${item.minStock})</div>`
    );
  });
  machines
    .filter((m) => m.status !== "Operativa")
    .forEach((m) => {
      alerts.push(
        `<div class="guide-step" style="border-left-color:#e09112;">🖨️ <strong>Equipo en ${escapeHTML(
          m.status
        )}:</strong> ${escapeHTML(m.name)} (${escapeHTML(m.supplyLevel || "revisar")})</div>`
      );
    });

  el("alertsList").innerHTML =
    alerts.length > 0
      ? `<div class="guide-steps">${alerts.join("")}</div>`
      : `<div class="guide-step" style="border-left-color:#1da851;">✅ Todo el inventario y todas las máquinas se encuentran en estado óptimo.</div>`;
}

// ================= CRM EXCEL (VENTAS Y PEDIDOS) =================
function sourceLabel(src) {
  switch (src) {
    case "web_form":
      return "Formulario Web";
    case "web_chatbot":
      return "Chatbot Web";
    case "whatsapp":
      return "WhatsApp";
    case "excel_import":
      return "Excel";
    default:
      return "Tienda / Manual";
  }
}

function renderCRMOrders() {
  const query = (el("orderSearchInput")?.value || "").toLowerCase().trim();
  const statusFilter = el("orderStatusFilter")?.value || "all";
  const sourceFilter = el("orderSourceFilter")?.value || "all";

  const filtered = (dbState.orders || []).filter((o) => {
    if (statusFilter !== "all" && o.status !== statusFilter) return false;
    if (sourceFilter !== "all" && o.source !== sourceFilter) return false;
    if (query) {
      const hay = `${o.id} ${o.customerName} ${o.phone} ${o.email} ${o.serviceName} ${o.details}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  const tbody = el("crmOrdersBody");
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:20px;">No hay pedidos con ese filtro o búsqueda.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((o) => {
      const waDigits = formatWaCustomerPhone(o.phone || o.whatsappFrom);
      const readyText =
        o.status === "Listo para Retiro"
          ? `¡Hola ${o.customerName}! 😊 Tu pedido ${o.id} (${o.serviceName}) en Bazar Copi Art ya está *listo para retirar*.` +
            (Number(o.total) > 0 ? ` Total: ₡${Number(o.total).toLocaleString("es-CR")}.` : "")
          : `¡Hola ${o.customerName}! Te saludamos de Bazar Copi Art sobre tu pedido ${o.id} (${o.serviceName}). Estado actual: ${o.status}.`;
      const waMsg = encodeURIComponent(readyText);
      const waBtn = waDigits
        ? `<a class="icon-btn wa" href="https://wa.me/${waDigits}?text=${waMsg}" target="_blank" rel="noopener noreferrer" title="Enviar mensaje de WhatsApp al cliente">💬 WhatsApp</a>`
        : "";
      const quickFlowBtn =
        o.status === "Pendiente" || o.status === "En Proceso"
          ? `<button type="button" class="icon-btn js-mark-ready" title="Marcar Listo para Retiro">✅ Listo</button>`
          : o.status === "Listo para Retiro"
          ? `<button type="button" class="icon-btn js-mark-delivered" title="Marcar como Entregado">🎉 Entregado</button>`
          : "";

      return `
        <tr data-order-id="${escapeHTML(o.id)}">
          <td>
            <strong>${escapeHTML(o.id)}</strong>
            <div style="font-size:0.72rem;color:var(--text-muted);">${escapeHTML(sourceLabel(o.source))}</div>
          </td>
          <td style="white-space:nowrap;font-size:0.8rem;">${escapeHTML(formatDateTime(o.createdAt))}</td>
          <td>
            <strong>${escapeHTML(o.customerName)}</strong>
            ${o.phone ? `<div style="font-size:0.75rem;color:var(--text-muted);">📱 ${escapeHTML(o.phone)}</div>` : ""}
          </td>
          <td style="min-width:170px;">
            <strong>${escapeHTML(o.serviceName)}</strong>
            ${o.details ? `<div style="font-size:0.76rem;color:var(--text-muted);">${escapeHTML(o.details)}</div>` : ""}
          </td>
          <td>${Number(o.quantity) || 1}</td>
          <td>
            <input type="number" class="cell-input cell-input-sm js-order-total" value="${Number(o.total) || 0}" min="0" step="50" />
          </td>
          <td>
            <select class="cell-select js-order-payment">
              ${["Pendiente", "SINPE Móvil", "Efectivo"]
                .map((p) => `<option value="${p}" ${o.paymentMethod === p ? "selected" : ""}>${p}</option>`)
                .join("")}
            </select>
          </td>
          <td>
            <select class="cell-select js-order-status">
              ${["Pendiente", "En Proceso", "Listo para Retiro", "Entregado", "Cancelado"]
                .map((s) => `<option value="${s}" ${o.status === s ? "selected" : ""}>${s}</option>`)
                .join("")}
            </select>
          </td>
          <td>
            <div class="row-actions">
              ${quickFlowBtn}
              ${waBtn}
              <button type="button" class="icon-btn js-edit-order">Editar</button>
              <button type="button" class="icon-btn danger js-del-order" title="Borrar">✕</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll("tr[data-order-id]").forEach((row) => {
    const id = row.dataset.orderId;
    const order = dbState.orders.find((x) => x.id === id);
    if (!order) return;

    row.querySelector(".js-order-total")?.addEventListener("change", (e) => {
      mutateDb(
        { action: "upsert_order", order: { ...order, total: Number(e.target.value) || 0 } },
        `Monto actualizado en ${id}`
      );
    });
    row.querySelector(".js-order-payment")?.addEventListener("change", (e) => {
      mutateDb(
        { action: "upsert_order", order: { ...order, paymentMethod: e.target.value } },
        `Pago actualizado en ${id}`
      );
    });
    row.querySelector(".js-order-status")?.addEventListener("change", (e) => {
      mutateDb(
        { action: "upsert_order", order: { ...order, status: e.target.value } },
        `Estado actualizado en ${id}`
      );
    });
    row.querySelector(".js-mark-ready")?.addEventListener("click", () => {
      mutateDb(
        { action: "upsert_order", order: { ...order, status: "Listo para Retiro" } },
        `Pedido ${id} marcado Listo para Retiro. Ya puedes tocar 💬 WA para avisarle.`
      );
    });
    row.querySelector(".js-mark-delivered")?.addEventListener("click", () => {
      mutateDb(
        { action: "upsert_order", order: { ...order, status: "Entregado" } },
        `Pedido ${id} marcado como Entregado.`
      );
    });
    row.querySelector(".js-edit-order")?.addEventListener("click", () => openOrderModal(order));
    row.querySelector(".js-del-order")?.addEventListener("click", () => {
      if (confirm(`¿Eliminar el pedido ${id}?`)) {
        mutateDb({ action: "delete_order", id }, "Pedido eliminado.");
      }
    });
  });
}

el("orderSearchInput")?.addEventListener("input", renderCRMOrders);
el("orderStatusFilter")?.addEventListener("change", renderCRMOrders);
el("orderSourceFilter")?.addEventListener("change", renderCRMOrders);

// ================= INVENTARIO Y STOCK =================
function renderInventory() {
  const query = (el("invSearchInput")?.value || "").toLowerCase().trim();
  const cat = el("invCategoryFilter")?.value || "all";

  const filtered = (dbState.inventory || []).filter((item) => {
    if (cat !== "all" && item.category !== cat) return false;
    if (query) {
      const hay = `${item.sku} ${item.name} ${item.category} ${item.supplier} ${item.notes}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  const tbody = el("inventoryBody");
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:20px;">No hay productos con ese nombre o categoría.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((i) => {
      const stock = Number(i.stock) || 0;
      const min = Number(i.minStock) || 0;
      const badge =
        stock <= 0
          ? `<span class="badge badge-danger">Agotado</span>`
          : stock <= min
          ? `<span class="badge badge-warn">Por acabarse</span>`
          : `<span class="badge badge-ok">Disponible</span>`;

      return `
        <tr data-inv-id="${escapeHTML(i.id)}">
          <td>
            <strong>${escapeHTML(i.name)}</strong>
            <div style="font-size:0.74rem;color:var(--text-muted);">Cód: ${escapeHTML(i.sku)}${i.notes ? ` · ${escapeHTML(i.notes)}` : ""}</div>
          </td>
          <td>${escapeHTML(i.category)}</td>
          <td>
            <div class="stock-stepper">
              <button type="button" class="step-btn js-stock-minus" title="Restar 1">-</button>
              <strong>${stock}</strong> <span style="font-size:0.76rem;color:var(--text-muted);">${escapeHTML(i.unit)}</span>
              <button type="button" class="step-btn js-stock-plus" title="Sumar 1">+</button>
            </div>
          </td>
          <td>${min}</td>
          <td>${badge}</td>
          <td>${formatColones(i.costPrice)}</td>
          <td><strong>${i.salePrice > 0 ? formatColones(i.salePrice) : "Uso interno"}</strong></td>
          <td>
            <div class="row-actions">
              <button type="button" class="icon-btn js-edit-inv">Editar</button>
              <button type="button" class="icon-btn danger js-del-inv" title="Borrar">✕</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll("tr[data-inv-id]").forEach((row) => {
    const id = row.dataset.invId;
    const item = dbState.inventory.find((x) => x.id === id);
    if (!item) return;

    row.querySelector(".js-stock-minus")?.addEventListener("click", () => {
      mutateDb({ action: "adjust_stock", id, delta: -1 });
    });
    row.querySelector(".js-stock-plus")?.addEventListener("click", () => {
      mutateDb({ action: "adjust_stock", id, delta: 1 });
    });
    row.querySelector(".js-edit-inv")?.addEventListener("click", () => openInventoryModal(item));
    row.querySelector(".js-del-inv")?.addEventListener("click", () => {
      if (confirm(`¿Eliminar "${item.name}" del inventario?`)) {
        mutateDb({ action: "delete_inventory", id }, "Artículo eliminado del inventario.");
      }
    });
  });
}

el("invSearchInput")?.addEventListener("input", renderInventory);
el("invCategoryFilter")?.addEventListener("change", renderInventory);

// ================= CLIENTES CRM =================
function getCustomerSegment(c) {
  const count = Number(c.ordersCount) || 0;
  if (count >= 5) return { label: "Frecuente", badgeClass: "badge-ok" };
  const lastMs = c.lastOrderAt ? new Date(c.lastOrderAt).getTime() : 0;
  const daysSinceLast = lastMs ? (Date.now() - lastMs) / 86400000 : 0;
  if (daysSinceLast > 30 && count < 5) return { label: "En riesgo", badgeClass: "badge-danger" };
  const createdMs = c.createdAt ? new Date(c.createdAt).getTime() : lastMs;
  const daysSinceCreated = createdMs ? (Date.now() - createdMs) / 86400000 : 0;
  if (daysSinceCreated <= 30) return { label: "Nuevo", badgeClass: "badge-plum" };
  return { label: "Activo", badgeClass: "badge-warn" };
}

function renderCustomers() {
  const query = (el("customerSearchInput")?.value || "").toLowerCase().trim();
  const filtered = (dbState.customers || []).filter((c) => {
    if (!query) return true;
    return `${c.name} ${c.phone} ${c.email} ${c.notes}`.toLowerCase().includes(query);
  });

  const tbody = el("customersBody");
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:20px;">Todavía no hay clientes anotados. Se irán guardando solos con cada pedido.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((c) => {
      const seg = getCustomerSegment(c);
      const waDigits = formatWaCustomerPhone(c.phone);
      const waBtn = waDigits
        ? `<a class="icon-btn wa" href="https://wa.me/${waDigits}" target="_blank" rel="noopener noreferrer">💬 WhatsApp</a>`
        : "";
      return `
        <tr data-cust-id="${escapeHTML(c.id)}">
          <td>
            <strong>${escapeHTML(c.name)}</strong>
            <div style="font-size:0.74rem;color:var(--text-muted);">Por: ${escapeHTML(sourceLabel(c.lastChannel || c.source))}</div>
          </td>
          <td>${escapeHTML(c.phone || "—")}</td>
          <td>${escapeHTML(c.email || "—")}</td>
          <td><span class="badge ${seg.badgeClass}">${seg.label}</span></td>
          <td>${Number(c.ordersCount) || 0}</td>
          <td><strong>${formatColones(c.totalSpent)}</strong></td>
          <td style="font-size:0.8rem;">${escapeHTML(formatDateTime(c.lastOrderAt))}</td>
          <td>
            <div class="row-actions">
              ${waBtn}
              <button type="button" class="icon-btn js-edit-cust">Editar</button>
              <button type="button" class="icon-btn danger js-del-cust" title="Borrar">✕</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll("tr[data-cust-id]").forEach((row) => {
    const id = row.dataset.custId;
    const cust = dbState.customers.find((x) => x.id === id);
    if (!cust) return;
    row.querySelector(".js-edit-cust")?.addEventListener("click", () => openCustomerModal(cust));
    row.querySelector(".js-del-cust")?.addEventListener("click", () => {
      if (confirm(`¿Eliminar al cliente ${cust.name}?`)) {
        mutateDb({ action: "delete_customer", id }, "Cliente eliminado.");
      }
    });
  });
}

el("customerSearchInput")?.addEventListener("input", renderCustomers);

// ================= MÁQUINAS Y EQUIPOS =================
function renderMachines() {
  const machines = dbState.machines || [];
  const grid = el("machinesGrid");
  if (machines.length === 0) {
    grid.innerHTML = `<p style="color:var(--text-muted);">No hay máquinas registradas aún.</p>`;
    return;
  }

  grid.innerHTML = machines
    .map((m) => {
      const statusClass =
        m.status === "Operativa" ? "" : m.status === "Mantenimiento" ? "warn" : "danger";
      const badgeClass =
        m.status === "Operativa"
          ? "badge-ok"
          : m.status === "Mantenimiento"
          ? "badge-warn"
          : "badge-danger";

      return `
        <article class="machine-card ${statusClass}" data-machine-id="${escapeHTML(m.id)}">
          <div class="machine-top">
            <div>
              <div style="font-size:0.75rem;color:var(--text-muted);font-weight:700;">${escapeHTML(m.id)} · ${escapeHTML(m.type)}</div>
              <h3 class="machine-title">${escapeHTML(m.name)}</h3>
              <div style="font-size:0.84rem;color:var(--text-muted);">${escapeHTML(m.model || "Sin modelo")}</div>
            </div>
            <span class="badge ${badgeClass}">${escapeHTML(m.status)}</span>
          </div>
          <div class="machine-meta">
            <div><strong>Contador / Uso:</strong> ${Number(m.meterCount || 0).toLocaleString("es-CR")} págs/ciclos</div>
            <div><strong>Insumos / Tinta:</strong> ${escapeHTML(m.supplyLevel || "—")}</div>
            <div><strong>Último mantenimiento:</strong> ${escapeHTML(m.lastMaintenance || "—")}</div>
            <div><strong>Próximo mantenimiento:</strong> ${escapeHTML(m.nextMaintenance || "Sin programar")}</div>
            <div><strong>Gasto acumulado:</strong> ${formatColones(m.maintenanceCost)}</div>
            ${m.notes ? `<div><em>${escapeHTML(m.notes)}</em></div>` : ""}
          </div>
          <div class="row-actions" style="margin-top:auto;padding-top:8px;">
            <button type="button" class="icon-btn js-edit-machine">Editar / Mantenimiento</button>
            <button type="button" class="icon-btn danger js-del-machine">Eliminar</button>
          </div>
        </article>
      `;
    })
    .join("");

  grid.querySelectorAll("[data-machine-id]").forEach((card) => {
    const id = card.dataset.machineId;
    const machine = dbState.machines.find((x) => x.id === id);
    if (!machine) return;
    card.querySelector(".js-edit-machine")?.addEventListener("click", () => openMachineModal(machine));
    card.querySelector(".js-del-machine")?.addEventListener("click", () => {
      if (confirm(`¿Eliminar equipo "${machine.name}"?`)) {
        mutateDb({ action: "delete_machine", id }, "Máquina eliminada.");
      }
    });
  });
}

// ================= COPIAS DE SEGURIDAD Y WHATSAPP =================
function renderBackupsAndStatus() {
  const storage = dbState.storageStatus || {};

  el("storageModeText").innerHTML = storage.persistent
    ? `✅ <strong>Guardado en la nube activo:</strong> tus ventas, inventario y máquinas quedan guardados de forma segura (último cambio: ${escapeHTML(
        formatDateTime(dbState.lastUpdatedAt)
      )}).`
    : `✅ <strong>Guardado automático activo:</strong> tus datos se respaldan en esta computadora mientras trabajas (último cambio: ${escapeHTML(
        formatDateTime(dbState.lastUpdatedAt)
      )}).`;

  el("aiModeText").innerHTML =
    `✅ <strong>Asistente de la página listo:</strong> responde precios, horarios, formas de pago y apunta pedidos solo.`;

  const backups = dbState.backups || [];
  el("backupsBody").innerHTML =
    backups.length === 0
      ? `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:16px;">Aquí aparecerán tus copias de seguridad automáticamente conforme hagas cambios.</td></tr>`
      : backups
          .map(
            (b) => `
          <tr data-bkp-id="${escapeHTML(b.id)}">
            <td style="white-space:nowrap;">${escapeHTML(formatDateTime(b.createdAt))}</td>
            <td>${escapeHTML(b.reason)}</td>
            <td>${b.summary?.orders ?? 0} ped · ${b.summary?.inventory ?? 0} prod · ${b.summary?.machines ?? 0} maq</td>
            <td>
              <div class="row-actions">
                <button type="button" class="icon-btn js-restore-bkp">Volver a esta copia</button>
                <button type="button" class="icon-btn js-dl-bkp">⬇ Bajar</button>
              </div>
            </td>
          </tr>
        `
          )
          .join("");

  el("backupsBody").querySelectorAll("tr[data-bkp-id]").forEach((row) => {
    const id = row.dataset.bkpId;
    const bkp = backups.find((b) => b.id === id);
    if (!bkp) return;

    row.querySelector(".js-restore-bkp")?.addEventListener("click", () => {
      if (confirm(`¿Seguro que quieres devolver los datos a como estaban el ${formatDateTime(bkp.createdAt)}?`)) {
        mutateDb({ action: "restore_backup", backupId: id }, "¡Listo! Datos devueltos a esa copia.");
      }
    });
    row.querySelector(".js-dl-bkp")?.addEventListener("click", () => {
      downloadBlob(
        new Blob([JSON.stringify(bkp.snapshotData, null, 2)], { type: "application/json" }),
        `${bkp.id}.json`
      );
    });
  });
}

// ================= EXPORTACIÓN E IMPORTACIÓN EXCEL (.XLSX / .CSV) =================
function buildWorkbookSheets(state) {
  const ordersSheet = [
    [
      "ID",
      "Fecha",
      "Canal",
      "Cliente",
      "Teléfono",
      "Correo",
      "Servicio",
      "Detalles",
      "Cantidad",
      "Precio Unitario",
      "Total",
      "Método Pago",
      "Estado",
      "Notas",
    ],
    ...(state.orders || []).map((o) => [
      o.id,
      formatDateTime(o.createdAt),
      sourceLabel(o.source),
      o.customerName,
      o.phone || o.whatsappFrom || "",
      o.email || "",
      o.serviceName,
      o.details,
      Number(o.quantity) || 1,
      Number(o.unitPrice) || 0,
      Number(o.total) || 0,
      o.paymentMethod || "Pendiente",
      o.status || "Pendiente",
      o.notes || "",
    ]),
  ];

  const invSheet = [
    ["ID", "SKU", "Nombre", "Categoría", "Tipo", "Stock", "Stock Mínimo", "Unidad", "Precio Costo", "Precio Venta", "Proveedor", "Notas"],
    ...(state.inventory || []).map((i) => [
      i.id,
      i.sku,
      i.name,
      i.category,
      i.type,
      Number(i.stock) || 0,
      Number(i.minStock) || 0,
      i.unit,
      Number(i.costPrice) || 0,
      Number(i.salePrice) || 0,
      i.supplier || "",
      i.notes || "",
    ]),
  ];

  const custSheet = [
    ["ID", "Nombre", "Teléfono", "Correo", "Canal", "Segmento", "Pedidos", "Total Comprado", "Último Pedido", "Notas"],
    ...(state.customers || []).map((c) => [
      c.id,
      c.name,
      c.phone || "",
      c.email || "",
      sourceLabel(c.lastChannel || c.source),
      getCustomerSegment(c).label,
      Number(c.ordersCount) || 0,
      Number(c.totalSpent) || 0,
      formatDateTime(c.lastOrderAt),
      c.notes || "",
    ]),
  ];

  const machSheet = [
    ["ID", "Nombre", "Modelo", "Tipo", "Estado", "Contador", "Insumo/Tinta", "Último Mant.", "Próximo Mant.", "Costo Mant.", "Notas"],
    ...(state.machines || []).map((m) => [
      m.id,
      m.name,
      m.model || "",
      m.type,
      m.status,
      Number(m.meterCount) || 0,
      m.supplyLevel || "",
      m.lastMaintenance || "",
      m.nextMaintenance || "",
      Number(m.maintenanceCost) || 0,
      m.notes || "",
    ]),
  ];

  const activeOrders = (state.orders || []).filter((o) => o.status !== "Cancelado");
  const totalRevenue = activeOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const deliveredCount = activeOrders.filter((o) => o.status === "Entregado").length;
  const pendingCount = activeOrders.filter((o) => o.status === "Pendiente" || o.status === "En Proceso").length;
  const lowStockCount = (state.inventory || []).filter((i) => Number(i.stock) <= Number(i.minStock)).length;
  const freqCustCount = (state.customers || []).filter((c) => getCustomerSegment(c).label === "Frecuente").length;
  const maintCostTotal = (state.machines || []).reduce((s, m) => s + (Number(m.maintenanceCost) || 0), 0);

  const summarySheet = [
    ["Indicador Bazar Copi Art", "Valor Actual", "Fecha Corte"],
    ["Ventas Totales Registradas (₡)", totalRevenue, formatDateTime(new Date().toISOString())],
    ["Pedidos Totales", (state.orders || []).length, ""],
    ["Pedidos Entregados", deliveredCount, ""],
    ["Pedidos Pendientes / En Proceso", pendingCount, ""],
    ["Clientes Registrados", (state.customers || []).length, ""],
    ["Clientes Frecuentes (5+ pedidos)", freqCustCount, ""],
    ["Artículos en Inventario", (state.inventory || []).length, ""],
    ["Artículos con Stock Bajo", lowStockCount, ""],
    ["Máquinas Registradas", (state.machines || []).length, ""],
    ["Gasto Acumulado Mantenimiento Máquinas (₡)", maintCostTotal, ""],
  ];

  return [
    { name: "Ventas_CRM", rows: ordersSheet },
    { name: "Clientes_CRM", rows: custSheet },
    { name: "Inventario_Stock", rows: invSheet },
    { name: "Maquinas_Equipos", rows: machSheet },
    { name: "Resumen_KPI", rows: summarySheet },
  ];
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportFullExcelWorkbook() {
  if (!dbState) return;
  const bytes = buildXlsxBytes(buildWorkbookSheets(dbState));
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadBlob(
    new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `Bazar-Copi-Art-CRM-${dateStr}.xlsx`
  );
  showToast("Libro Excel (.xlsx) descargado con 5 hojas.");
}

el("exportXlsxBtn")?.addEventListener("click", exportFullExcelWorkbook);
el("downloadXlsxTopBtn")?.addEventListener("click", exportFullExcelWorkbook);

el("exportOrdersCsvBtn")?.addEventListener("click", () => {
  if (!dbState) return;
  const sheets = buildWorkbookSheets(dbState);
  const csv = buildCsvText(sheets[0].rows, ";");
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `Bazar-Copi-Art-Ventas-${dateStr}.csv`);
  showToast("CSV de ventas descargado.");
});

async function handleSpreadsheetImport(file, target) {
  if (!file) return;
  try {
    let rows = [];
    let customersRows = [];
    if (file.name.toLowerCase().endsWith(".xlsx")) {
      const buf = await file.arrayBuffer();
      if (target === "inventory") {
        rows = await parseXlsxToObjects(buf, ["Inventario_Stock", "Inventario"]);
      } else {
        const { sheets, sheetOrder } = await parseAllXlsxSheets(buf);
        const orderSheet =
          sheetOrder.find((n) => ["ventas_crm", "pedidos"].includes(n.toLowerCase())) ||
          sheetOrder.find((n) => sheets[n]?.length > 0);
        const custSheet = sheetOrder.find((n) =>
          ["clientes", "clientes_crm"].includes(n.toLowerCase())
        );
        rows = orderSheet ? sheets[orderSheet] || [] : [];
        customersRows = custSheet ? sheets[custSheet] || [] : [];
      }
    } else {
      rows = parseCsvToObjects(await file.text());
    }
    if (rows.length === 0 && customersRows.length === 0) {
      showToast("El archivo está vacío o no tiene encabezados válidos.");
      return;
    }
    await mutateDb(
      { action: "import_crm_rows", target, rows, customersRows },
      `Importados ${rows.length} pedidos${
        customersRows.length ? ` y ${customersRows.length} clientes` : ""
      } desde ${file.name}.`
    );
  } catch (err) {
    showToast(err.message);
  }
}

el("importOrdersFile")?.addEventListener("change", (e) => {
  handleSpreadsheetImport(e.target.files?.[0], "orders");
  e.target.value = "";
});

el("importInventoryFile")?.addEventListener("change", (e) => {
  handleSpreadsheetImport(e.target.files?.[0], "inventory");
  e.target.value = "";
});

// ================= MODALES CRUD =================
function openModal(title, fieldsHTML, onSubmit, options = {}) {
  el("modalTitle").textContent = title;
  const form = el("modalForm");
  const footerHTML = options.readOnly
    ? `<div class="modal-actions">
        <button type="button" class="btn btn-primary btn-sm" id="modalCancelBtn">¡Entendido!</button>
      </div>`
    : `<div class="modal-actions">
        <button type="button" class="btn btn-outline btn-sm" id="modalCancelBtn">Cancelar</button>
        <button type="submit" class="btn btn-primary btn-sm">Guardar Cambios</button>
      </div>`;
  form.innerHTML = fieldsHTML + footerHTML;
  modalSubmitHandler = onSubmit;
  el("modalCancelBtn")?.addEventListener("click", closeModal);
  el("editorModal").classList.add("open");
}

function closeModal() {
  el("editorModal").classList.remove("open");
  modalSubmitHandler = null;
}

el("modalCloseBtn")?.addEventListener("click", closeModal);
el("editorModal")?.addEventListener("click", (e) => {
  if (e.target === el("editorModal")) closeModal();
});
el("modalForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (modalSubmitHandler) {
    await modalSubmitHandler(new FormData(e.target));
  }
});

function openOrderModal(existing = null) {
  const o = existing || {
    id: "",
    customerName: "",
    phone: "",
    email: "",
    serviceName: "",
    details: "",
    quantity: 1,
    total: 0,
    paymentMethod: "Pendiente",
    status: "Pendiente",
    inventoryItemId: "",
    notes: "",
  };

  const invOptions = (dbState.inventory || [])
    .map(
      (i) =>
        `<option value="${escapeHTML(i.id)}" ${o.inventoryItemId === i.id ? "selected" : ""}>${escapeHTML(
          i.name
        )} (Stock: ${i.stock} · ${formatColones(i.salePrice)})</option>`
    )
    .join("");

  openModal(
    existing ? `Editar Pedido ${o.id}` : "Apuntar Venta o Pedido Nuevo",
    `
      <div class="form-group">
        <label>Nombre del cliente</label>
        <input name="customerName" value="${escapeHTML(o.customerName)}" required />
      </div>
      <div class="form-group">
        <label>Teléfono / WhatsApp</label>
        <input name="phone" value="${escapeHTML(o.phone)}" placeholder="Ej. 8888-8888" />
      </div>
      <div class="form-group">
        <label>Correo (opcional)</label>
        <input name="email" type="email" value="${escapeHTML(o.email)}" />
      </div>
      <div class="form-group">
        <label>Producto del inventario (opcional)</label>
        <select name="inventoryItemId" id="modalInvSelect">
          <option value="">— No descontar del inventario —</option>
          ${invOptions}
        </select>
      </div>
      <div class="form-group full-span">
        <label>Servicio o producto</label>
        <input name="serviceName" id="modalOrderService" value="${escapeHTML(o.serviceName)}" placeholder="Ej. Impresiones a color / Taza" required />
      </div>
      <div class="form-group full-span">
        <label>Detalles del pedido</label>
        <textarea name="details" rows="2">${escapeHTML(o.details)}</textarea>
      </div>
      <div class="form-group">
        <label>Cantidad</label>
        <input name="quantity" id="modalOrderQty" type="number" min="1" value="${Number(o.quantity) || 1}" />
      </div>
      <div class="form-group">
        <label>Total (₡)</label>
        <input name="total" id="modalOrderTotal" type="number" min="0" step="50" value="${Number(o.total) || 0}" />
      </div>
      <div class="form-group">
        <label>Forma de pago</label>
        <select name="paymentMethod">
          ${["Pendiente", "SINPE Móvil", "Efectivo"]
            .map((p) => `<option value="${p}" ${o.paymentMethod === p ? "selected" : ""}>${p}</option>`)
            .join("")}
        </select>
      </div>
      <div class="form-group">
        <label>Estado del pedido</label>
        <select name="status">
          ${["Pendiente", "En Proceso", "Listo para Retiro", "Entregado", "Cancelado"]
            .map((s) => `<option value="${s}" ${o.status === s ? "selected" : ""}>${s}</option>`)
            .join("")}
        </select>
      </div>
      ${
        !existing
          ? `<div class="form-group full-span">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="checkbox" name="deductStock" value="1" checked />
                Descontar automáticamente de la cantidad en inventario
              </label>
            </div>`
          : ""
      }
      <div class="form-group full-span">
        <label>Notas (opcional)</label>
        <input name="notes" value="${escapeHTML(o.notes || "")}" />
      </div>
    `,
    async (fd) => {
      await mutateDb(
        {
          action: "upsert_order",
          order: {
            ...o,
            customerName: fd.get("customerName"),
            phone: fd.get("phone"),
            email: fd.get("email"),
            inventoryItemId: fd.get("inventoryItemId"),
            serviceName: fd.get("serviceName"),
            details: fd.get("details"),
            quantity: Number(fd.get("quantity")) || 1,
            total: Number(fd.get("total")) || 0,
            paymentMethod: fd.get("paymentMethod"),
            status: fd.get("status"),
            deductStock: fd.get("deductStock") === "1",
            notes: fd.get("notes"),
          },
        },
        existing ? "¡Pedido actualizado!" : "¡Venta apuntada en la lista y en el Excel!"
      );
      closeModal();
    }
  );

  const invSelect = el("modalInvSelect");
  const qtyInput = el("modalOrderQty");
  const totalInput = el("modalOrderTotal");
  const svcInput = el("modalOrderService");

  function syncTotalFromSelectedInv() {
    const selectedId = invSelect?.value;
    if (!selectedId) return;
    const item = (dbState.inventory || []).find((x) => x.id === selectedId);
    if (!item) return;
    if (svcInput && !svcInput.value.trim()) svcInput.value = item.name;
    if (totalInput && item.salePrice > 0) {
      totalInput.value = (Number(qtyInput?.value) || 1) * Number(item.salePrice);
    }
  }

  invSelect?.addEventListener("change", () => {
    const item = (dbState.inventory || []).find((x) => x.id === invSelect.value);
    if (item && svcInput) svcInput.value = item.name;
    syncTotalFromSelectedInv();
  });
  qtyInput?.addEventListener("input", syncTotalFromSelectedInv);
}

function openInventoryModal(existing = null) {
  const i = existing || {
    id: "",
    sku: "",
    name: "",
    category: "Papelería",
    type: "Producto",
    stock: 10,
    minStock: 5,
    unit: "uds",
    costPrice: 0,
    salePrice: 0,
    supplier: "",
    notes: "",
  };

  openModal(
    existing ? `Editar ${i.name}` : "Agregar Producto Nuevo",
    `
      <div class="form-group">
        <label>Código (opcional)</label>
        <input name="sku" value="${escapeHTML(i.sku)}" placeholder="Ej. TAZA-01" />
      </div>
      <div class="form-group">
        <label>Nombre del producto o servicio</label>
        <input name="name" value="${escapeHTML(i.name)}" required />
      </div>
      <div class="form-group">
        <label>Categoría</label>
        <select name="category">
          ${["Impresión", "Copiado", "Negocios", "Papelería", "Regalos", "Insumos"]
            .map((c) => `<option value="${c}" ${i.category === c ? "selected" : ""}>${c}</option>`)
            .join("")}
        </select>
      </div>
      <div class="form-group">
        <label>Tipo</label>
        <select name="type">
          ${["Producto", "Servicio", "Insumo"]
            .map((t) => `<option value="${t}" ${i.type === t ? "selected" : ""}>${t}</option>`)
            .join("")}
        </select>
      </div>
      <div class="form-group">
        <label>Cantidad que tienes ahora</label>
        <input name="stock" type="number" min="0" value="${Number(i.stock) || 0}" required />
      </div>
      <div class="form-group">
        <label>Avisar cuando queden menos de</label>
        <input name="minStock" type="number" min="0" value="${Number(i.minStock) || 0}" required />
      </div>
      <div class="form-group">
        <label>Unidad (uds, hojas, resmas...)</label>
        <input name="unit" value="${escapeHTML(i.unit)}" required />
      </div>
      <div class="form-group">
        <label>Proveedor</label>
        <input name="supplier" value="${escapeHTML(i.supplier || "")}" />
      </div>
      <div class="form-group">
        <label>Precio Costo (₡)</label>
        <input name="costPrice" type="number" min="0" value="${Number(i.costPrice) || 0}" />
      </div>
      <div class="form-group">
        <label>Precio Venta (₡)</label>
        <input name="salePrice" type="number" min="0" value="${Number(i.salePrice) || 0}" />
      </div>
      <div class="form-group full-span">
        <label>Notas</label>
        <input name="notes" value="${escapeHTML(i.notes || "")}" />
      </div>
    `,
    async (fd) => {
      await mutateDb(
        {
          action: "upsert_inventory",
          item: {
            ...i,
            sku: fd.get("sku"),
            name: fd.get("name"),
            category: fd.get("category"),
            type: fd.get("type"),
            stock: Number(fd.get("stock")) || 0,
            minStock: Number(fd.get("minStock")) || 0,
            unit: fd.get("unit"),
            supplier: fd.get("supplier"),
            costPrice: Number(fd.get("costPrice")) || 0,
            salePrice: Number(fd.get("salePrice")) || 0,
            notes: fd.get("notes"),
          },
        },
        "Inventario actualizado."
      );
      closeModal();
    }
  );
}

function openCustomerModal(existing = null) {
  const c = existing || { id: "", name: "", phone: "", email: "", notes: "" };
  openModal(
    existing ? `Editar Cliente ${c.name}` : "Agregar Cliente",
    `
      <div class="form-group full-span">
        <label>Nombre completo</label>
        <input name="name" value="${escapeHTML(c.name)}" required />
      </div>
      <div class="form-group">
        <label>Teléfono / WhatsApp</label>
        <input name="phone" value="${escapeHTML(c.phone || "")}" />
      </div>
      <div class="form-group">
        <label>Correo electrónico</label>
        <input name="email" type="email" value="${escapeHTML(c.email || "")}" />
      </div>
      <div class="form-group full-span">
        <label>Notas</label>
        <input name="notes" value="${escapeHTML(c.notes || "")}" />
      </div>
    `,
    async (fd) => {
      await mutateDb(
        {
          action: "upsert_customer",
          customer: {
            ...c,
            name: fd.get("name"),
            phone: fd.get("phone"),
            email: fd.get("email"),
            notes: fd.get("notes"),
          },
        },
        "Cliente guardado."
      );
      closeModal();
    }
  );
}

function openMachineModal(existing = null) {
  const m = existing || {
    id: "",
    name: "",
    model: "",
    type: "Impresora",
    status: "Operativa",
    meterCount: 0,
    supplyLevel: "",
    lastMaintenance: new Date().toISOString().slice(0, 10),
    nextMaintenance: "",
    maintenanceCost: 0,
    notes: "",
  };

  openModal(
    existing ? `Equipo: ${m.name}` : "Registrar Máquina o Equipo",
    `
      <div class="form-group">
        <label>Nombre del equipo</label>
        <input name="name" value="${escapeHTML(m.name)}" required />
      </div>
      <div class="form-group">
        <label>Modelo / Marca</label>
        <input name="model" value="${escapeHTML(m.model || "")}" />
      </div>
      <div class="form-group">
        <label>Tipo</label>
        <select name="type">
          ${["Impresora", "Fotocopiadora", "Emplasticadora", "Corte/Acabado", "Cómputo", "Otro"]
            .map((t) => `<option value="${t}" ${m.type === t ? "selected" : ""}>${t}</option>`)
            .join("")}
        </select>
      </div>
      <div class="form-group">
        <label>Estado operativo</label>
        <select name="status">
          ${["Operativa", "Mantenimiento", "Con Falla", "Inactiva"]
            .map((s) => `<option value="${s}" ${m.status === s ? "selected" : ""}>${s}</option>`)
            .join("")}
        </select>
      </div>
      <div class="form-group">
        <label>Contador de uso / copias</label>
        <input name="meterCount" type="number" min="0" value="${Number(m.meterCount) || 0}" />
      </div>
      <div class="form-group">
        <label>Nivel de tinta / tóner / insumo</label>
        <input name="supplyLevel" value="${escapeHTML(m.supplyLevel || "")}" placeholder="Ej. Tóner 80%" />
      </div>
      <div class="form-group">
        <label>Último mantenimiento</label>
        <input name="lastMaintenance" type="date" value="${escapeHTML(m.lastMaintenance || "")}" />
      </div>
      <div class="form-group">
        <label>Próximo mantenimiento</label>
        <input name="nextMaintenance" type="date" value="${escapeHTML(m.nextMaintenance || "")}" />
      </div>
      <div class="form-group">
        <label>Gasto mantenimiento (₡)</label>
        <input name="maintenanceCost" type="number" min="0" value="${Number(m.maintenanceCost) || 0}" />
      </div>
      <div class="form-group full-span">
        <label>Notas del equipo</label>
        <textarea name="notes" rows="2">${escapeHTML(m.notes || "")}</textarea>
      </div>
    `,
    async (fd) => {
      await mutateDb(
        {
          action: "upsert_machine",
          machine: {
            ...m,
            name: fd.get("name"),
            model: fd.get("model"),
            type: fd.get("type"),
            status: fd.get("status"),
            meterCount: Number(fd.get("meterCount")) || 0,
            supplyLevel: fd.get("supplyLevel"),
            lastMaintenance: fd.get("lastMaintenance"),
            nextMaintenance: fd.get("nextMaintenance"),
            maintenanceCost: Number(fd.get("maintenanceCost")) || 0,
            notes: fd.get("notes"),
          },
        },
        "Máquina / equipo guardado."
      );
      closeModal();
    }
  );
}

el("newOrderBtn")?.addEventListener("click", () => openOrderModal(null));
el("newInventoryBtn")?.addEventListener("click", () => openInventoryModal(null));
el("newCustomerBtn")?.addEventListener("click", () => openCustomerModal(null));
el("newMachineBtn")?.addEventListener("click", () => openMachineModal(null));

// ================= RESPALDOS, CARPETA LOCAL, TESTER WHATSAPP Y CLAVE =================
el("createBackupBtn")?.addEventListener("click", () => {
  mutateDb({ action: "create_backup", reason: "Copia manual guardada" }, "¡Copia de seguridad guardada!");
});

el("downloadBackupJsonBtn")?.addEventListener("click", () => {
  if (!dbState) return;
  const payload = {
    exportedAt: new Date().toISOString(),
    inventory: dbState.inventory,
    orders: dbState.orders,
    customers: dbState.customers,
    machines: dbState.machines,
  };
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    `Bazar-Copi-Art-Respaldo-${dateStr}.json`
  );
  showToast("Archivo de respaldo guardado en tus Descargas.");
});

el("restoreBackupJsonFile")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const snapshot = parsed.snapshotData || parsed;
    await mutateDb(
      { action: "restore_backup", snapshotData: snapshot },
      "¡Listo! Datos recuperados desde tu archivo."
    );
  } catch {
    showToast("Ese archivo no es un respaldo válido del bazar.");
  }
  e.target.value = "";
});

el("linkLocalFolderBtn")?.addEventListener("click", async () => {
  if (!window.showDirectoryPicker) {
    showToast("Abre esta página en Google Chrome o Microsoft Edge para elegir una carpeta.");
    return;
  }
  try {
    localDirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    el("localFolderStatus").textContent = `✅ Guardando en carpeta: ${localDirHandle.name}`;
    await writeToLinkedLocalFolder(dbState);
    showToast(`¡Listo! Todo se guardará también en la carpeta "${localDirHandle.name}".`);
  } catch {
    showToast("No se eligió ninguna carpeta.");
  }
});

el("copyWebhookBtn")?.addEventListener("click", async () => {
  const url = el("webhookUrlText")?.textContent || "";
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(url);
    showToast("URL del webhook copiada.");
  }
});

el("copyWaWelcomeBtn")?.addEventListener("click", async () => {
  const msg = el("waWelcomeTemplateText")?.textContent?.trim() || "";
  if (navigator.clipboard && msg) {
    await navigator.clipboard.writeText(msg);
    showToast("Mensaje de bienvenida copiado para WhatsApp Business.");
  }
});

el("copyWaAwayBtn")?.addEventListener("click", async () => {
  const msg = el("waAwayTemplateText")?.textContent?.trim() || "";
  if (navigator.clipboard && msg) {
    await navigator.clipboard.writeText(msg);
    showToast("Mensaje de ausencia copiado para WhatsApp Business.");
  }
});

el("waTesterForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = el("waTesterInput");
  const log = el("waTesterLog");
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  const uBubble = document.createElement("div");
  uBubble.className = "tester-bubble user";
  uBubble.textContent = text;
  log.appendChild(uBubble);

  try {
    const res = await fetch("/api/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "simulate",
        sessionId: "admin-tester",
        text,
        session: waTesterSession,
      }),
    });
    const data = await res.json();
    waTesterSession = data.session || waTesterSession;

    const bBubble = document.createElement("div");
    bBubble.className = "tester-bubble bot";
    bBubble.innerHTML = escapeHTML(data.reply || "").replace(/\n/g, "<br>");
    log.appendChild(bBubble);
    log.scrollTop = log.scrollHeight;

    if (data.savedOrder) {
      await refreshDatabase(true);
      showToast(`Pedido de prueba ${data.savedOrder.id} guardado en Ventas y Pedidos.`);
    }
  } catch {
    showToast("No se pudo probar el asistente en este momento.");
  }
});

el("passwordForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const data = await apiFetch("/api/auth", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        newUsername: el("newAdminUser").value.trim(),
        currentPassword: el("currentAdminPass").value,
        newPassword: el("newAdminPass").value,
      }),
    });
    authToken = data.token;
    sessionStorage.setItem(TOKEN_KEY, authToken);
    localStorage.setItem(TOKEN_KEY, authToken);
    el("currentAdminPass").value = "";
    el("newAdminPass").value = "";
    dbState.usingDefaultPassword = false;
    el("defaultPassBanner").style.display = "none";
    showToast("Usuario y contraseña actualizados.");
  } catch (err) {
    showToast(err.message);
  }
});

// ================= ACCESIBILIDAD: TAMAÑO DE LETRA =================
(() => {
  const fontBtn = el("a11yFontToggle");
  if (!fontBtn) return;

  const applyLargeText = (enabled) => {
    document.documentElement.classList.toggle("large-text", enabled);
    fontBtn.setAttribute("aria-pressed", enabled ? "true" : "false");
    fontBtn.textContent = enabled ? "Aa-" : "Aa+";
  };

  let isLarge = false;
  try {
    isLarge = localStorage.getItem("bazar_large_text") === "1";
  } catch {
    isLarge = false;
  }
  applyLargeText(isLarge);

  fontBtn.addEventListener("click", () => {
    isLarge = !isLarge;
    applyLargeText(isLarge);
    try {
      localStorage.setItem("bazar_large_text", isLarge ? "1" : "0");
    } catch {
      // Ignorar si almacenamiento local está bloqueado
    }
  });
})();

checkInitialAuth();
