import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getCache } from "@vercel/functions";

const DB_KEY = "bazar_copi_art:main_db:v1";
const SESSION_PREFIX = "bazar_copi_art:wa_session:";
const PROCESSED_MSG_PREFIX = "bazar_copi_art:wa_msg:";
const SESSION_TTL_SECONDS = 60 * 60 * 6; // 6 horas de memoria conversacional
const MAX_BACKUPS_IN_DB = 25;

// Memoria en proceso para fallback inmediato cuando no hay Redis/Supabase o disco persistente
const globalMemory = globalThis.__bazarCopiArtMem || {
  db: null,
  sessions: new Map(),
  processedMessages: new Map(),
};
globalThis.__bazarCopiArtMem = globalMemory;

const LOCAL_DATA_DIR = path.join(process.cwd(), "data");
const LOCAL_DB_FILE = path.join(LOCAL_DATA_DIR, "bazar-db.json");
const LOCAL_BACKUPS_DIR = path.join(LOCAL_DATA_DIR, "backups");

export function createInitialDatabase() {
  const now = new Date().toISOString();
  return {
    version: 1,
    lastUpdatedAt: now,
    settings: {
      businessName: "Bazar Copi Art",
      whatsappNumber: "50664760290",
      whatsappUrl: "https://wa.me/50664760290",
      adminUsername: "",
      adminPasswordHash: "",
      authSecret: crypto
        .createHash("sha256")
        .update(
          `${process.env.ADMIN_AUTH_SECRET || process.env.VERCEL_PROJECT_ID || process.env.WHATSAPP_VERIFY_TOKEN || "bazar-copi-art-2026"}:auth-secret`
        )
        .digest("hex"),
      autoBackupOnChange: true,
    },
    inventory: [
      {
        id: "INV-001",
        sku: "IMP-BN",
        name: "Impresiones Blanco y Negro",
        category: "Impresión",
        type: "Servicio",
        stock: 2500,
        minStock: 300,
        unit: "hojas",
        costPrice: 12,
        salePrice: 50,
        supplier: "Insumo papel bond + tóner",
        notes: "Descuento por volumen o docentes en folletos.",
        updatedAt: now,
      },
      {
        id: "INV-002",
        sku: "IMP-COL",
        name: "Impresiones a Color",
        category: "Impresión",
        type: "Servicio",
        stock: 1500,
        minStock: 250,
        unit: "hojas",
        costPrice: 35,
        salePrice: 100,
        supplier: "Tinta original color",
        notes: "Ideal para tareas, imágenes y trabajos.",
        updatedAt: now,
      },
      {
        id: "INV-003",
        sku: "COP-BN",
        name: "Fotocopias Blanco y Negro",
        category: "Copiado",
        type: "Servicio",
        stock: 3000,
        minStock: 500,
        unit: "hojas",
        costPrice: 8,
        salePrice: 20,
        supplier: "Resma papel bond",
        notes: "Entrega inmediata.",
        updatedAt: now,
      },
      {
        id: "INV-004",
        sku: "COP-COL",
        name: "Fotocopias a Color",
        category: "Copiado",
        type: "Servicio",
        stock: 1000,
        minStock: 200,
        unit: "hojas",
        costPrice: 28,
        salePrice: 75,
        supplier: "Tinta color + papel bond",
        notes: "Nitidez garantizada.",
        updatedAt: now,
      },
      {
        id: "INV-005",
        sku: "CED-BN",
        name: "Copia de Cédula (B/N)",
        category: "Copiado",
        type: "Servicio",
        stock: 500,
        minStock: 100,
        unit: "hojas",
        costPrice: 15,
        salePrice: 60,
        supplier: "Papel bond",
        notes: "Color disponible a ₡180.",
        updatedAt: now,
      },
      {
        id: "INV-006",
        sku: "EMP-GEN",
        name: "Emplasticado (Desde ₡600)",
        category: "Negocios",
        type: "Servicio",
        stock: 120,
        minStock: 25,
        unit: "láminas",
        costPrice: 180,
        salePrice: 600,
        supplier: "Láminas térmicas surtidas",
        notes: "Precio varía según tamaño (carné, carta, oficio).",
        updatedAt: now,
      },
      {
        id: "INV-007",
        sku: "TAR-1L",
        name: "Tarjetas de Presentación (1 lado)",
        category: "Negocios",
        type: "Servicio",
        stock: 200,
        minStock: 40,
        unit: "paquetes",
        costPrice: 700,
        salePrice: 2000,
        supplier: "Cartulina opalina/couche",
        notes: "Ambos lados a ₡2.500.",
        updatedAt: now,
      },
      {
        id: "INV-008",
        sku: "VOL-100",
        name: "Volantes Papel Bond (100 uds)",
        category: "Negocios",
        type: "Servicio",
        stock: 80,
        minStock: 15,
        unit: "paquetes",
        costPrice: 1800,
        salePrice: 5000,
        supplier: "Papel bond",
        notes: "Facturas desde ₡3.000 según diseño.",
        updatedAt: now,
      },
      {
        id: "INV-009",
        sku: "PAP-STK",
        name: "Stickers Personalizados (50 uds)",
        category: "Papelería",
        type: "Producto",
        stock: 60,
        minStock: 15,
        unit: "paquetes",
        costPrice: 900,
        salePrice: 2500,
        supplier: "Papel adhesivo fotográfico",
        notes: "Papelería personalizada desde ₡8.000.",
        updatedAt: now,
      },
      {
        id: "INV-010",
        sku: "REG-TAZ",
        name: "Tazas de Regalo",
        category: "Regalos",
        type: "Producto",
        stock: 24,
        minStock: 6,
        unit: "uds",
        costPrice: 850,
        salePrice: 1700,
        supplier: "Proveedor regalos",
        notes: "Listas para regalar o personalizar.",
        updatedAt: now,
      },
      {
        id: "INV-011",
        sku: "REG-PEL",
        name: "Peluches",
        category: "Regalos",
        type: "Producto",
        stock: 15,
        minStock: 4,
        unit: "uds",
        costPrice: 1300,
        salePrice: 2500,
        supplier: "Proveedor regalos",
        notes: "Desde ₡2.500 según tamaño.",
        updatedAt: now,
      },
      {
        id: "INV-012",
        sku: "REG-BOL",
        name: "Bolsos de Tela",
        category: "Regalos",
        type: "Producto",
        stock: 18,
        minStock: 5,
        unit: "uds",
        costPrice: 1500,
        salePrice: 3000,
        supplier: "Textil local",
        notes: "Reutilizables y resistentes.",
        updatedAt: now,
      },
      {
        id: "INV-013",
        sku: "REG-SEP",
        name: "Separadores de Libros",
        category: "Regalos",
        type: "Producto",
        stock: 30,
        minStock: 8,
        unit: "uds",
        costPrice: 500,
        salePrice: 1500,
        supplier: "Producción propia",
        notes: "Varios diseños.",
        updatedAt: now,
      },
      {
        id: "INV-014",
        sku: "REG-BRO",
        name: "Broches (Pequeño / Grande)",
        category: "Regalos",
        type: "Producto",
        stock: 40,
        minStock: 10,
        unit: "uds",
        costPrice: 250,
        salePrice: 600,
        supplier: "Accesorios",
        notes: "Pequeños ₡600 · Grandes ₡1.000.",
        updatedAt: now,
      },
      {
        id: "INV-015",
        sku: "INS-RES",
        name: "Resma Papel Bond Carta (500 hojas)",
        category: "Insumos",
        type: "Insumo",
        stock: 14,
        minStock: 4,
        unit: "resmas",
        costPrice: 2400,
        salePrice: 0,
        supplier: "Distribuidora Papelería",
        notes: "Insumo interno de copiado e impresión.",
        updatedAt: now,
      },
    ],
    orders: [],
    customers: [],
    machines: [
      {
        id: "MAQ-001",
        name: "Fotocopiadora Principal B/N",
        model: "Multifuncional Láser B/N",
        type: "Fotocopiadora",
        status: "Operativa",
        meterCount: 12450,
        supplyLevel: "Tóner 85%",
        lastMaintenance: now.slice(0, 10),
        nextMaintenance: "",
        maintenanceCost: 0,
        notes: "Equipo principal para copias rápidas y folletos.",
        updatedAt: now,
      },
      {
        id: "MAQ-002",
        name: "Impresora Multifuncional Color",
        model: "Sistema Continuo Color",
        type: "Impresora",
        status: "Operativa",
        meterCount: 5320,
        supplyLevel: "Tintas CMYK 75%",
        lastMaintenance: now.slice(0, 10),
        nextMaintenance: "",
        maintenanceCost: 0,
        notes: "Para impresiones color, tarjetas, stickers y papelería.",
        updatedAt: now,
      },
      {
        id: "MAQ-003",
        name: "Emplasticadora Térmica",
        model: "Laminadora A3/A4",
        type: "Emplasticadora",
        status: "Operativa",
        meterCount: 640,
        supplyLevel: "Rodillos limpios",
        lastMaintenance: now.slice(0, 10),
        nextMaintenance: "",
        maintenanceCost: 0,
        notes: "Carnés, cédulas, láminas y documentos.",
        updatedAt: now,
      },
      {
        id: "MAQ-004",
        name: "Guillotina / Cortadora de Papel",
        model: "Cizalla de Palanca",
        type: "Corte/Acabado",
        status: "Operativa",
        meterCount: 980,
        supplyLevel: "Cuchilla óptima",
        lastMaintenance: now.slice(0, 10),
        nextMaintenance: "",
        maintenanceCost: 0,
        notes: "Corte de tarjetas, volantes y separadores.",
        updatedAt: now,
      },
      {
        id: "MAQ-005",
        name: "Computadora de Diseño y Caja",
        model: "Estación Principal",
        type: "Cómputo",
        status: "Operativa",
        meterCount: 0,
        supplyLevel: "Sistema actualizado",
        lastMaintenance: now.slice(0, 10),
        nextMaintenance: "",
        maintenanceCost: 0,
        notes: "Atención de pedidos, diseño y panel CRM.",
        updatedAt: now,
      },
    ],
    backups: [],
  };
}

function getUpstashConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    return { url: url.replace(/\/+$/, ""), token };
  }
  return null;
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    return { url: url.replace(/\/+$/, ""), key };
  }
  return null;
}

function isVercelRuntime() {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
}

export function getStorageStatus() {
  if (getUpstashConfig()) {
    return {
      mode: "upstash_redis",
      persistent: true,
      label: "Upstash Redis / Vercel KV (Nube Permanente)",
    };
  }
  if (getSupabaseConfig()) {
    return {
      mode: "supabase",
      persistent: true,
      label: "Supabase PostgreSQL (Nube Permanente)",
    };
  }
  if (!isVercelRuntime()) {
    return {
      mode: "local_file",
      persistent: true,
      label: "Base de Datos Local en Disco (data/bazar-db.json)",
    };
  }
  return {
    mode: "vercel_cache",
    persistent: false,
    label: "Cache Runtime Vercel + Respaldo Local en Navegador (IndexedDB)",
  };
}

async function upstashCommand(args) {
  const cfg = getUpstashConfig();
  if (!cfg) return null;
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error(`Upstash error ${res.status}: ${await res.text()}`);
  }
  const payload = await res.json();
  return payload.result;
}

async function supabaseGet(key) {
  const cfg = getSupabaseConfig();
  if (!cfg) return null;
  const res = await fetch(
    `${cfg.url}/rest/v1/bazar_store?id=eq.${encodeURIComponent(key)}&select=data`,
    {
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
      },
    }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0]?.data ?? null;
}

async function supabaseSet(key, data) {
  const cfg = getSupabaseConfig();
  if (!cfg) return false;
  const res = await fetch(`${cfg.url}/rest/v1/bazar_store`, {
    method: "POST",
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify([{ id: key, data, updated_at: new Date().toISOString() }]),
  });
  return res.ok;
}

function normalizeDbShape(raw) {
  const base = createInitialDatabase();
  if (!raw || typeof raw !== "object") return base;

  return {
    version: raw.version || 1,
    lastUpdatedAt: raw.lastUpdatedAt || base.lastUpdatedAt,
    settings: {
      ...base.settings,
      ...(raw.settings || {}),
      authSecret: raw.settings?.authSecret || base.settings.authSecret,
    },
    inventory: Array.isArray(raw.inventory) ? raw.inventory : base.inventory,
    orders: Array.isArray(raw.orders) ? raw.orders : [],
    customers: Array.isArray(raw.customers) ? raw.customers : [],
    machines: Array.isArray(raw.machines) ? raw.machines : base.machines,
    backups: Array.isArray(raw.backups) ? raw.backups : [],
  };
}

export async function readDatabase() {
  // 1. Upstash / Vercel KV
  if (getUpstashConfig()) {
    try {
      const rawStr = await upstashCommand(["GET", DB_KEY]);
      if (rawStr) {
        const parsed = typeof rawStr === "string" ? JSON.parse(rawStr) : rawStr;
        const normalized = normalizeDbShape(parsed);
        globalMemory.db = normalized;
        return normalized;
      }
      const seeded = createInitialDatabase();
      await upstashCommand(["SET", DB_KEY, JSON.stringify(seeded)]);
      globalMemory.db = seeded;
      return seeded;
    } catch (err) {
      console.error("Error leyendo Upstash DB:", err);
    }
  }

  // 2. Supabase
  if (getSupabaseConfig()) {
    try {
      const data = await supabaseGet(DB_KEY);
      if (data) {
        const normalized = normalizeDbShape(data);
        globalMemory.db = normalized;
        return normalized;
      }
      const seeded = createInitialDatabase();
      await supabaseSet(DB_KEY, seeded);
      globalMemory.db = seeded;
      return seeded;
    } catch (err) {
      console.error("Error leyendo Supabase DB:", err);
    }
  }

  // 3. Disco local (cuando no está en Vercel serverless read-only)
  if (!isVercelRuntime()) {
    try {
      const content = await fs.readFile(LOCAL_DB_FILE, "utf8");
      const normalized = normalizeDbShape(JSON.parse(content));
      globalMemory.db = normalized;
      return normalized;
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.error("Error leyendo archivo local DB:", err);
      }
      const seeded = globalMemory.db ? normalizeDbShape(globalMemory.db) : createInitialDatabase();
      await writeLocalDiskDb(seeded);
      globalMemory.db = seeded;
      return seeded;
    }
  }

  // 4. Vercel Runtime Cache + memoria
  try {
    const cache = getCache({ namespace: "bazar-db" });
    const cached = await cache.get(DB_KEY);
    if (cached && typeof cached === "object") {
      const normalized = normalizeDbShape(cached);
      globalMemory.db = normalized;
      return normalized;
    }
  } catch {
    // Fuera de entorno Vercel Runtime Cache
  }

  if (globalMemory.db) {
    return structuredClone(normalizeDbShape(globalMemory.db));
  }

  const seeded = createInitialDatabase();
  globalMemory.db = seeded;
  if (isVercelRuntime()) {
    try {
      const cache = getCache({ namespace: "bazar-db" });
      await cache.set(DB_KEY, seeded, {
        ttl: 60 * 60 * 24 * 7,
        tags: ["bazar-db"],
        name: "bazar-main-database",
      });
    } catch {
      // Ignorar si cache no está disponible
    }
  }
  return seeded;
}

async function writeLocalDiskDb(db) {
  await fs.mkdir(LOCAL_DATA_DIR, { recursive: true });
  await fs.writeFile(LOCAL_DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function buildSnapshotPayload(db) {
  return structuredClone({
    version: db.version,
    exportedAt: new Date().toISOString(),
    inventory: db.inventory,
    orders: db.orders,
    customers: db.customers,
    machines: db.machines,
  });
}

export function appendBackupSnapshot(db, reason = "Respaldo automático", actor = "sistema") {
  const now = new Date().toISOString();
  const id = `BKP-${now.replace(/[-:TZ.]/g, "").slice(0, 14)}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;

  const snapshot = {
    id,
    createdAt: now,
    reason,
    createdBy: actor,
    summary: {
      orders: db.orders.length,
      inventory: db.inventory.length,
      customers: db.customers.length,
      machines: db.machines.length,
    },
    snapshotData: buildSnapshotPayload(db),
  };

  db.backups = [snapshot, ...(db.backups || [])].slice(0, MAX_BACKUPS_IN_DB);
  return snapshot;
}

export async function writeDatabase(db, options = {}) {
  const {
    createBackup = false,
    reason = "Actualización automática",
    actor = "sistema",
  } = options;

  const cleanDb = normalizeDbShape(db);
  cleanDb.lastUpdatedAt = new Date().toISOString();

  let createdBackup = null;
  if (createBackup || cleanDb.settings?.autoBackupOnChange) {
    // Evitar crear respaldo duplicado si fue apenas hace < 30 segundos por cambios seguidos, salvo respaldo manual
    const latest = cleanDb.backups?.[0];
    const isManual = reason.toLowerCase().includes("manual");
    const elapsedMs = latest ? Date.now() - new Date(latest.createdAt).getTime() : Infinity;
    if (createBackup || isManual || elapsedMs > 30000) {
      createdBackup = appendBackupSnapshot(cleanDb, reason, actor);
    }
  }

  globalMemory.db = structuredClone(cleanDb);

  if (getUpstashConfig()) {
    try {
      await upstashCommand(["SET", DB_KEY, JSON.stringify(cleanDb)]);
    } catch (err) {
      console.error("Error guardando en Upstash DB:", err);
    }
  } else if (getSupabaseConfig()) {
    try {
      await supabaseSet(DB_KEY, cleanDb);
    } catch (err) {
      console.error("Error guardando en Supabase DB:", err);
    }
  } else if (!isVercelRuntime()) {
    try {
      await writeLocalDiskDb(cleanDb);
      if (createdBackup) {
        await fs.mkdir(LOCAL_BACKUPS_DIR, { recursive: true });
        await fs.writeFile(
          path.join(LOCAL_BACKUPS_DIR, `${createdBackup.id}.json`),
          JSON.stringify(createdBackup, null, 2),
          "utf8"
        );
      }
    } catch (err) {
      console.error("Error guardando DB local en disco:", err);
    }
  } else {
    try {
      const cache = getCache({ namespace: "bazar-db" });
      await cache.set(DB_KEY, cleanDb, {
        ttl: 60 * 60 * 24 * 7,
        tags: ["bazar-db"],
        name: "bazar-main-database",
      });
    } catch {
      // Silencio fuera de Vercel Runtime
    }
  }

  return { db: cleanDb, backup: createdBackup };
}

function normalizePhoneDigits(phone) {
  return String(phone || "").replace(/\D/g, "");
}

export function upsertCustomerFromOrder(db, order) {
  const phoneDigits = normalizePhoneDigits(order.phone || order.whatsappFrom);
  const emailLower = String(order.email || "").trim().toLowerCase();
  const nameClean = String(order.customerName || "Cliente").trim();

  if (!nameClean && !phoneDigits && !emailLower) return null;

  let existing = db.customers.find((c) => {
    const cDigits = normalizePhoneDigits(c.phone);
    if (phoneDigits && cDigits && (cDigits.endsWith(phoneDigits.slice(-8)) || phoneDigits.endsWith(cDigits.slice(-8)))) {
      return true;
    }
    if (emailLower && c.email && c.email.toLowerCase() === emailLower) return true;
    return false;
  });

  const amount = Number(order.total) || 0;
  const now = new Date().toISOString();

  if (existing) {
    existing.name = nameClean || existing.name;
    if (order.phone) existing.phone = order.phone;
    if (emailLower) existing.email = emailLower;
    existing.ordersCount = (Number(existing.ordersCount) || 0) + 1;
    existing.totalSpent = (Number(existing.totalSpent) || 0) + amount;
    existing.lastOrderAt = now;
    if (order.source) existing.lastChannel = order.source;
    return existing;
  }

  const newCustomer = {
    id: `CLI-${String(db.customers.length + 1).padStart(4, "0")}`,
    name: nameClean || "Cliente WhatsApp",
    phone: order.phone || order.whatsappFrom || "",
    email: emailLower,
    source: order.source || "web",
    lastChannel: order.source || "web",
    ordersCount: 1,
    totalSpent: amount,
    lastOrderAt: now,
    notes: "",
    createdAt: now,
  };

  db.customers.unshift(newCustomer);
  return newCustomer;
}

export function estimateOrderAmount(serviceName, details, inventory = []) {
  const text = `${serviceName || ""} ${details || ""}`.toLowerCase();
  const qtyMatch = String(details || "").match(/\b(\d{1,4})\b/);
  const qty = qtyMatch ? Math.max(1, parseInt(qtyMatch[1], 10)) : 1;

  // Buscar coincidencia directa en el inventario
  const invMatch = inventory.find((item) => {
    const n = item.name.toLowerCase();
    return text.includes(n) || (item.sku && text.includes(item.sku.toLowerCase()));
  });

  if (invMatch && invMatch.salePrice > 0) {
    return { quantity: qty, unitPrice: invMatch.salePrice, total: qty * invMatch.salePrice };
  }

  if (text.includes("cédula") || text.includes("cedula")) {
    const unit = text.includes("color") ? 180 : 60;
    return { quantity: qty, unitPrice: unit, total: qty * unit };
  }
  if (text.includes("copia") || text.includes("fotocopia")) {
    const unit = text.includes("color") ? 75 : 20;
    return { quantity: qty, unitPrice: unit, total: qty * unit };
  }
  if (text.includes("impres")) {
    const unit = text.includes("color") ? 100 : 50;
    return { quantity: qty, unitPrice: unit, total: qty * unit };
  }
  if (text.includes("folleto")) {
    return { quantity: qty, unitPrice: 20, total: qty * 20 };
  }
  if (text.includes("emplastic")) {
    return { quantity: qty, unitPrice: 600, total: qty * 600 };
  }
  if (text.includes("tarjeta")) {
    const unit = text.includes("2") || text.includes("ambos") ? 2500 : 2000;
    return { quantity: 1, unitPrice: unit, total: unit };
  }
  if (text.includes("volante")) {
    return { quantity: 1, unitPrice: 5000, total: 5000 };
  }
  if (text.includes("factura")) {
    return { quantity: 1, unitPrice: 3000, total: 3000 };
  }
  if (text.includes("sticker")) {
    return { quantity: 1, unitPrice: 2500, total: 2500 };
  }
  if (text.includes("papelería personalizada") || text.includes("papeleria personalizada")) {
    return { quantity: 1, unitPrice: 8000, total: 8000 };
  }
  if (text.includes("taza")) {
    return { quantity: qty, unitPrice: 1700, total: qty * 1700 };
  }
  if (text.includes("separador")) {
    return { quantity: qty, unitPrice: 1500, total: qty * 1500 };
  }
  if (text.includes("bolso")) {
    return { quantity: qty, unitPrice: 3000, total: qty * 3000 };
  }
  if (text.includes("peluche")) {
    return { quantity: qty, unitPrice: 2500, total: qty * 2500 };
  }
  if (text.includes("broche")) {
    const unit = text.includes("grande") ? 1000 : 600;
    return { quantity: qty, unitPrice: unit, total: qty * unit };
  }

  return { quantity: qty, unitPrice: 0, total: 0 };
}

export async function recordOrder(orderInput, actor = "web") {
  const db = await readDatabase();
  const now = new Date();
  const dateTag = now.toISOString().slice(0, 10).replace(/-/g, "");
  const seq = String(db.orders.length + 1).padStart(3, "0");
  const id = orderInput.id || `PED-${dateTag}-${seq}`;

  const estimated = estimateOrderAmount(
    orderInput.serviceName,
    orderInput.details,
    db.inventory
  );

  const quantity =
    Number(orderInput.quantity) > 0 ? Number(orderInput.quantity) : estimated.quantity;
  const total =
    Number(orderInput.total) >= 0 && orderInput.total !== undefined && orderInput.total !== ""
      ? Number(orderInput.total)
      : estimated.total;
  const unitPrice =
    Number(orderInput.unitPrice) > 0
      ? Number(orderInput.unitPrice)
      : quantity > 0 && total > 0
      ? Math.round(total / quantity)
      : estimated.unitPrice;

  const newOrder = {
    id,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    source: orderInput.source || "web",
    customerName: String(orderInput.customerName || orderInput.name || "Cliente").trim(),
    phone: String(orderInput.phone || orderInput.whatsappFrom || "").trim(),
    whatsappFrom: String(orderInput.whatsappFrom || "").trim(),
    email: String(orderInput.email || "").trim(),
    serviceName: String(orderInput.serviceName || "Consulta / Pedido").trim(),
    details: String(orderInput.details || "").trim(),
    quantity,
    unitPrice,
    total,
    paymentMethod: orderInput.paymentMethod || "Pendiente",
    status: orderInput.status || "Pendiente",
    inventoryItemId: orderInput.inventoryItemId || "",
    notes: String(orderInput.notes || "").trim(),
  };

  // Si se asoció un artículo de inventario y se pidió rebajar stock
  if (orderInput.deductStock && newOrder.inventoryItemId) {
    const invItem = db.inventory.find((i) => i.id === newOrder.inventoryItemId);
    if (invItem) {
      invItem.stock = Math.max(0, Number(invItem.stock || 0) - quantity);
      invItem.updatedAt = now.toISOString();
    }
  }

  db.orders.unshift(newOrder);
  upsertCustomerFromOrder(db, newOrder);

  await writeDatabase(db, {
    createBackup: true,
    reason: `Nuevo pedido ${newOrder.id} (${newOrder.source})`,
    actor,
  });

  return newOrder;
}

// =========================================================================
// SESIONES DE WHATSAPP Y DEDUPLICACIÓN DE MENSAJES
// =========================================================================

export async function loadWhatsAppSession(sessionId) {
  const key = `${SESSION_PREFIX}${sessionId}`;

  if (getUpstashConfig()) {
    try {
      const raw = await upstashCommand(["GET", key]);
      if (raw) return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (err) {
      console.error("Error leyendo sesión WhatsApp de Upstash:", err);
    }
  }

  try {
    const cache = getCache({ namespace: "whatsapp-bot" });
    const data = await cache.get(key);
    if (data && typeof data === "object") return data;
  } catch {
    // Fuera de Vercel Runtime Cache
  }

  const mem = globalMemory.sessions.get(sessionId);
  if (mem && Date.now() - mem.savedAt < SESSION_TTL_SECONDS * 1000) {
    return mem.data;
  }
  return null;
}

export async function saveWhatsAppSession(sessionId, sessionData) {
  const key = `${SESSION_PREFIX}${sessionId}`;
  globalMemory.sessions.set(sessionId, { data: sessionData, savedAt: Date.now() });

  if (getUpstashConfig()) {
    try {
      await upstashCommand([
        "SET",
        key,
        JSON.stringify(sessionData),
        "EX",
        String(SESSION_TTL_SECONDS),
      ]);
    } catch (err) {
      console.error("Error guardando sesión WhatsApp en Upstash:", err);
    }
  }

  try {
    const cache = getCache({ namespace: "whatsapp-bot" });
    await cache.set(key, sessionData, {
      ttl: SESSION_TTL_SECONDS,
      tags: ["whatsapp-sessions"],
      name: "whatsapp-conversation-state",
    });
  } catch {
    // Fuera de Vercel Runtime Cache
  }
}

export async function isMessageAlreadyProcessed(messageId) {
  if (!messageId) return false;
  const key = `${PROCESSED_MSG_PREFIX}${messageId}`;

  if (globalMemory.processedMessages.has(messageId)) {
    return true;
  }
  globalMemory.processedMessages.set(messageId, Date.now());
  if (globalMemory.processedMessages.size > 500) {
    const firstKey = globalMemory.processedMessages.keys().next().value;
    globalMemory.processedMessages.delete(firstKey);
  }

  if (getUpstashConfig()) {
    try {
      const exists = await upstashCommand(["GET", key]);
      if (exists) return true;
      await upstashCommand(["SET", key, "1", "EX", "300"]);
    } catch {
      // Continuar
    }
  }

  return false;
}
