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
      label.textContent = `Espejo local en navegador (IndexedDB): guardado ${new Date().toLocaleTimeString(
        "es-CR"
      )}.`;
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
async function checkInitialAuth() {
  try {
    const res = await fetch("/api/auth", {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    const data = await res.json();
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
  btn.disabled = true;
  btn.textContent = "Verificando...";

  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Credenciales incorrectas.");
    }

    authToken = data.token;
    sessionStorage.setItem(TOKEN_KEY, authToken);
    localStorage.setItem(TOKEN_KEY, authToken);
    el("loginPass").value = "";
    showAdminShell();
    await refreshDatabase();
    showToast(`Bienvenido(a), ${data.username}`);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add("visible");
  } finally {
    btn.disabled = false;
    btn.textContent = "🔐 Ingresar al Panel";
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
    : "● Guardado local + nube";
  pill.classList.toggle("warn", !persistent);
}

// Auto-sincronización cada 15s cuando no hay modal abierto
setInterval(() => {
  if (!authToken || !dbState) return;
  if (el("editorModal")?.classList.contains("open")) return;
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
el("quickBackupBtn")?.addEventListener("click", () => {
  mutateDb({ action: "create_backup", reason: "Copia rápida desde Resumen" }, "Copia de seguridad guardada.");
});
el("quickInvBtn")?.addEventListener("click", () => activateTab("inventario"));

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

  const totalSales = orders
    .filter((o) => o.status !== "Cancelado")
    .reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  const pendingOrders = orders.filter(
    (o) => o.status === "Pendiente" || o.status === "En Proceso"
  ).length;
  const lowStock = inventory.filter((i) => Number(i.stock) <= Number(i.minStock));
  const activeMachines = machines.filter((m) => m.status === "Operativa").length;

  el("kpiStatsGrid").innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Ventas Registradas (CRM)</div>
      <div class="stat-value">${formatColones(totalSales)}</div>
      <div class="stat-sub">${orders.length} pedidos totales · ${customers.length} clientes</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Pedidos Pendientes</div>
      <div class="stat-value">${pendingOrders}</div>
      <div class="stat-sub">En espera o en preparación</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Alertas de Stock Bajo</div>
      <div class="stat-value">${lowStock.length}</div>
      <div class="stat-sub">De ${inventory.length} artículos en inventario</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Máquinas Operativas</div>
      <div class="stat-value">${activeMachines} / ${machines.length}</div>
      <div class="stat-sub">Equipos de copiado, impresión y acabado</div>
    </div>
  `;

  const recentRows = orders.slice(0, 6);
  el("recentOrdersBody").innerHTML =
    recentRows.length === 0
      ? `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:18px;">Aún no hay pedidos registrados. Cuando un cliente compre en la web o WhatsApp aparecerá aquí automáticamente.</td></tr>`
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
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;color:var(--text-muted);padding:20px;">No hay pedidos con los filtros actuales.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((o) => {
      const waDigits = formatWaCustomerPhone(o.phone || o.whatsappFrom);
      const waMsg = encodeURIComponent(
        `¡Hola ${o.customerName}! Te saludamos de Bazar Copi Art sobre tu pedido ${o.id} (${o.serviceName}). Estado actual: ${o.status}.`
      );
      const waBtn = waDigits
        ? `<a class="icon-btn wa" href="https://wa.me/${waDigits}?text=${waMsg}" target="_blank" rel="noopener noreferrer">💬 WA</a>`
        : "";

      return `
        <tr data-order-id="${escapeHTML(o.id)}">
          <td><strong>${escapeHTML(o.id)}</strong></td>
          <td style="white-space:nowrap;">${escapeHTML(formatDateTime(o.createdAt))}</td>
          <td><span class="badge badge-plum">${escapeHTML(sourceLabel(o.source))}</span></td>
          <td>${escapeHTML(o.customerName)}</td>
          <td>${escapeHTML(o.phone || "—")}</td>
          <td>${escapeHTML(o.serviceName)}</td>
          <td style="min-width:180px;">${escapeHTML(o.details)}</td>
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
              ${waBtn}
              <button type="button" class="icon-btn js-edit-order">Editar</button>
              <button type="button" class="icon-btn danger js-del-order">✕</button>
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
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:20px;">No hay artículos que coincidan.</td></tr>`;
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
          ? `<span class="badge badge-warn">Stock Bajo</span>`
          : `<span class="badge badge-ok">Disponible</span>`;

      return `
        <tr data-inv-id="${escapeHTML(i.id)}">
          <td><strong>${escapeHTML(i.sku)}</strong></td>
          <td>
            <strong>${escapeHTML(i.name)}</strong>
            ${i.notes ? `<div style="font-size:0.76rem;color:var(--text-muted);">${escapeHTML(i.notes)}</div>` : ""}
          </td>
          <td>${escapeHTML(i.category)}</td>
          <td>${escapeHTML(i.type)}</td>
          <td>
            <div class="stock-stepper">
              <button type="button" class="step-btn js-stock-minus" title="Restar 1">-</button>
              <strong>${stock}</strong> <span style="font-size:0.78rem;color:var(--text-muted);">${escapeHTML(i.unit)}</span>
              <button type="button" class="step-btn js-stock-plus" title="Sumar 1">+</button>
            </div>
          </td>
          <td>${min}</td>
          <td>${badge}</td>
          <td>${formatColones(i.costPrice)}</td>
          <td><strong>${i.salePrice > 0 ? formatColones(i.salePrice) : "Interno"}</strong></td>
          <td>
            <div class="row-actions">
              <button type="button" class="icon-btn js-edit-inv">Editar</button>
              <button type="button" class="icon-btn danger js-del-inv">✕</button>
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
function renderCustomers() {
  const query = (el("customerSearchInput")?.value || "").toLowerCase().trim();
  const filtered = (dbState.customers || []).filter((c) => {
    if (!query) return true;
    return `${c.name} ${c.phone} ${c.email} ${c.notes}`.toLowerCase().includes(query);
  });

  const tbody = el("customersBody");
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:20px;">Aún no hay clientes registrados.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((c) => {
      const waDigits = formatWaCustomerPhone(c.phone);
      const waBtn = waDigits
        ? `<a class="icon-btn wa" href="https://wa.me/${waDigits}" target="_blank" rel="noopener noreferrer">💬 WA</a>`
        : "";
      return `
        <tr data-cust-id="${escapeHTML(c.id)}">
          <td><strong>${escapeHTML(c.id)}</strong></td>
          <td><strong>${escapeHTML(c.name)}</strong></td>
          <td>${escapeHTML(c.phone || "—")}</td>
          <td>${escapeHTML(c.email || "—")}</td>
          <td><span class="badge badge-plum">${escapeHTML(sourceLabel(c.lastChannel || c.source))}</span></td>
          <td>${Number(c.ordersCount) || 0}</td>
          <td><strong>${formatColones(c.totalSpent)}</strong></td>
          <td>${escapeHTML(formatDateTime(c.lastOrderAt))}</td>
          <td>
            <div class="row-actions">
              ${waBtn}
              <button type="button" class="icon-btn js-edit-cust">Editar</button>
              <button type="button" class="icon-btn danger js-del-cust">✕</button>
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

// ================= RESPALDOS, BD Y WHATSAPP IA =================
function renderBackupsAndStatus() {
  const storage = dbState.storageStatus || {};
  const ai = dbState.aiStatus || {};

  el("storageModeText").innerHTML = `<strong>Motor BD activo:</strong> ${escapeHTML(
    storage.label || "Desconocido"
  )} · Última actualización: ${escapeHTML(formatDateTime(dbState.lastUpdatedAt))}`;

  el("aiModeText").innerHTML = ai.enabled
    ? `✅ <strong>IA Activa (${escapeHTML(ai.provider)} · ${escapeHTML(ai.model)}):</strong> Respondiendo con memoria conversacional.`
    : `🧠 <strong>Motor Contextual Coherente activo:</strong> Responde preguntas, pedidos pegados y flujos con contexto. Para IA generativa libre agrega <code>GEMINI_API_KEY</code> en Vercel.`;

  const backups = dbState.backups || [];
  el("backupsBody").innerHTML =
    backups.length === 0
      ? `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:16px;">Aún no hay snapshots guardados.</td></tr>`
      : backups
          .map(
            (b) => `
          <tr data-bkp-id="${escapeHTML(b.id)}">
            <td style="white-space:nowrap;">${escapeHTML(formatDateTime(b.createdAt))}</td>
            <td>${escapeHTML(b.reason)}</td>
            <td>${b.summary?.orders ?? 0} ped · ${b.summary?.inventory ?? 0} inv · ${b.summary?.machines ?? 0} maq</td>
            <td>
              <div class="row-actions">
                <button type="button" class="icon-btn js-restore-bkp">Restaurar</button>
                <button type="button" class="icon-btn js-dl-bkp">⬇ JSON</button>
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
      if (confirm(`¿Restaurar la base de datos al respaldo "${bkp.reason}" (${formatDateTime(bkp.createdAt)})?`)) {
        mutateDb({ action: "restore_backup", backupId: id }, "Base de datos restaurada con éxito.");
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
    ["ID", "Nombre", "Teléfono", "Correo", "Canal", "Pedidos", "Total Comprado", "Último Pedido", "Notas"],
    ...(state.customers || []).map((c) => [
      c.id,
      c.name,
      c.phone || "",
      c.email || "",
      sourceLabel(c.lastChannel || c.source),
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

  return [
    { name: "Ventas_CRM", rows: ordersSheet },
    { name: "Inventario_Stock", rows: invSheet },
    { name: "Clientes_CRM", rows: custSheet },
    { name: "Maquinas_Equipos", rows: machSheet },
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
  showToast("Libro Excel (.xlsx) descargado con 4 hojas.");
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
function openModal(title, fieldsHTML, onSubmit) {
  el("modalTitle").textContent = title;
  const form = el("modalForm");
  form.innerHTML =
    fieldsHTML +
    `
      <div class="modal-actions">
        <button type="button" class="btn btn-outline btn-sm" id="modalCancelBtn">Cancelar</button>
        <button type="submit" class="btn btn-primary btn-sm">Guardar Cambios</button>
      </div>
    `;
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
    existing ? `Editar Pedido ${o.id}` : "Registrar Venta / Pedido Manual",
    `
      <div class="form-group">
        <label>Cliente</label>
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
        <label>Vincular a artículo de stock (opcional)</label>
        <select name="inventoryItemId" id="modalInvSelect">
          <option value="">— Sin rebajar stock automático —</option>
          ${invOptions}
        </select>
      </div>
      <div class="form-group full-span">
        <label>Servicio o producto</label>
        <input name="serviceName" id="modalOrderService" value="${escapeHTML(o.serviceName)}" placeholder="Ej. Impresiones a color / Taza" required />
      </div>
      <div class="form-group full-span">
        <label>Detalles</label>
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
        <label>Método de pago</label>
        <select name="paymentMethod">
          ${["Pendiente", "SINPE Móvil", "Efectivo"]
            .map((p) => `<option value="${p}" ${o.paymentMethod === p ? "selected" : ""}>${p}</option>`)
            .join("")}
        </select>
      </div>
      <div class="form-group">
        <label>Estado</label>
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
                Rebajar automáticamente del stock si se vinculó un artículo
              </label>
            </div>`
          : ""
      }
      <div class="form-group full-span">
        <label>Notas internas</label>
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
        existing ? "Pedido actualizado." : "Venta / pedido registrado en CRM."
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
    existing ? `Editar ${i.name}` : "Agregar Artículo al Inventario",
    `
      <div class="form-group">
        <label>SKU / Código</label>
        <input name="sku" value="${escapeHTML(i.sku)}" placeholder="Ej. REG-TAZ2" />
      </div>
      <div class="form-group">
        <label>Nombre del artículo / servicio</label>
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
        <label>Stock actual</label>
        <input name="stock" type="number" min="0" value="${Number(i.stock) || 0}" required />
      </div>
      <div class="form-group">
        <label>Stock mínimo alerta</label>
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
        <label>Observaciones técnicas</label>
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
  mutateDb({ action: "create_backup", reason: "Respaldo manual por administración" }, "Respaldo creado.");
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
  showToast("Respaldo JSON descargado.");
});

el("restoreBackupJsonFile")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const snapshot = parsed.snapshotData || parsed;
    await mutateDb(
      { action: "restore_backup", snapshotData: snapshot },
      "Respaldo JSON restaurado correctamente."
    );
  } catch {
    showToast("El archivo JSON no es un respaldo válido.");
  }
  e.target.value = "";
});

el("linkLocalFolderBtn")?.addEventListener("click", async () => {
  if (!window.showDirectoryPicker) {
    showToast("Usa Google Chrome o Microsoft Edge para vincular una carpeta local de tu PC.");
    return;
  }
  try {
    localDirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    el("localFolderStatus").textContent = `✅ Vinculada: ${localDirHandle.name}`;
    await writeToLinkedLocalFolder(dbState);
    showToast(`Carpeta "${localDirHandle.name}" vinculada para respaldos y Excel automáticos.`);
  } catch {
    showToast("Vinculación cancelada.");
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
      showToast(`Pedido de prueba ${data.savedOrder.id} registrado en CRM.`);
    }
  } catch {
    showToast("Error probando el simulador de WhatsApp.");
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

checkInitialAuth();
