import { requireAdmin } from "./_lib/auth.js";
import { getAIStatus } from "./_lib/assistant.js";
import {
  readDatabase,
  writeDatabase,
  recordOrder,
  upsertCustomerFromOrder,
  getStorageStatus,
} from "./_lib/db.js";

function sanitizeDbForClient(db, session) {
  const { adminPasswordHash, authSecret, ...safeSettings } = db.settings || {};
  return {
    ok: true,
    version: db.version,
    lastUpdatedAt: db.lastUpdatedAt,
    settings: safeSettings,
    inventory: db.inventory || [],
    orders: db.orders || [],
    customers: db.customers || [],
    machines: db.machines || [],
    backups: db.backups || [],
    storageStatus: getStorageStatus(),
    aiStatus: getAIStatus(),
    username: session.username,
    usingDefaultPassword: session.usingDefaultPassword,
  };
}

function makeId(prefix, existingList) {
  const max = existingList.reduce((acc, item) => {
    const match = String(item.id || "").match(/(\d+)$/);
    return match ? Math.max(acc, parseInt(match[1], 10)) : acc;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  if (action === "public_catalog") {
    const db = await readDatabase();
    return Response.json({
      ok: true,
      whatsappUrl: db.settings?.whatsappUrl || "https://wa.me/50664760290",
      aiStatus: getAIStatus(),
      inventory: (db.inventory || [])
        .filter((i) => i.type !== "Insumo")
        .map((i) => ({
          id: i.id,
          name: i.name,
          category: i.category,
          type: i.type,
          salePrice: i.salePrice,
          stock: i.stock,
          unit: i.unit,
          notes: i.notes,
        })),
    });
  }

  const session = await requireAdmin(request);
  if (!session.ok) {
    return Response.json({ ok: false, error: "Sesión no autorizada." }, { status: 401 });
  }

  return Response.json(sanitizeDbForClient(session.db, session));
}

export async function POST(request) {
  try {
    const body = await request.json();
    const action = body?.action;

    // Acción pública: registrar pedido desde la página web (formulario o chatbot)
    if (action === "public_order") {
      const payload = body?.order || {};
      if (!payload.customerName && !payload.details) {
        return Response.json(
          { ok: false, error: "Faltan los datos del pedido." },
          { status: 400 }
        );
      }

      const order = await recordOrder(
        {
          ...payload,
          source: payload.source || "web_form",
        },
        payload.source || "web"
      );

      return Response.json({ ok: true, order }, { status: 201 });
    }

    // Todas las demás acciones requieren autenticación de administración
    const session = await requireAdmin(request);
    if (!session.ok) {
      return Response.json({ ok: false, error: "Sesión no autorizada." }, { status: 401 });
    }

    const db = session.db;
    const now = new Date().toISOString();
    const actor = session.username || "admin";

    if (action === "upsert_order") {
      const item = body.order || {};
      const existingIdx = db.orders.findIndex((o) => o.id === item.id);

      if (existingIdx >= 0) {
        const prev = db.orders[existingIdx];
        db.orders[existingIdx] = {
          ...prev,
          ...item,
          quantity: Number(item.quantity ?? prev.quantity ?? 1),
          unitPrice: Number(item.unitPrice ?? prev.unitPrice ?? 0),
          total: Number(item.total ?? prev.total ?? 0),
          updatedAt: now,
        };
        const { db: saved } = await writeDatabase(db, {
          reason: `Actualización pedido ${db.orders[existingIdx].id}`,
          actor,
        });
        return Response.json(sanitizeDbForClient(saved, session));
      } else {
        const created = await recordOrder(
          {
            ...item,
            source: item.source || "manual",
            deductStock: Boolean(item.deductStock),
          },
          actor
        );
        const refreshed = await readDatabase();
        return Response.json({
          ok: true,
          order: created,
          ...sanitizeDbForClient(refreshed, session),
        });
      }
    }

    if (action === "delete_order") {
      db.orders = db.orders.filter((o) => o.id !== body.id);
      const { db: saved } = await writeDatabase(db, {
        createBackup: true,
        reason: `Eliminación pedido ${body.id}`,
        actor,
      });
      return Response.json(sanitizeDbForClient(saved, session));
    }

    if (action === "upsert_inventory") {
      const item = body.item || {};
      const idx = db.inventory.findIndex((i) => i.id === item.id);

      if (idx >= 0) {
        db.inventory[idx] = {
          ...db.inventory[idx],
          ...item,
          stock: Math.max(0, Number(item.stock ?? db.inventory[idx].stock)),
          minStock: Math.max(0, Number(item.minStock ?? db.inventory[idx].minStock)),
          costPrice: Math.max(0, Number(item.costPrice ?? db.inventory[idx].costPrice)),
          salePrice: Math.max(0, Number(item.salePrice ?? db.inventory[idx].salePrice)),
          updatedAt: now,
        };
      } else {
        const newItem = {
          id: item.id || makeId("INV", db.inventory),
          sku: String(item.sku || "").trim() || `SKU-${Date.now().toString().slice(-4)}`,
          name: String(item.name || "Producto Nuevo").trim(),
          category: item.category || "Papelería",
          type: item.type || "Producto",
          stock: Math.max(0, Number(item.stock) || 0),
          minStock: Math.max(0, Number(item.minStock) || 5),
          unit: item.unit || "uds",
          costPrice: Math.max(0, Number(item.costPrice) || 0),
          salePrice: Math.max(0, Number(item.salePrice) || 0),
          supplier: String(item.supplier || "").trim(),
          notes: String(item.notes || "").trim(),
          updatedAt: now,
        };
        db.inventory.unshift(newItem);
      }

      const { db: saved } = await writeDatabase(db, {
        reason: `Actualización inventario (${item.name || item.id})`,
        actor,
      });
      return Response.json(sanitizeDbForClient(saved, session));
    }

    if (action === "adjust_stock") {
      const target = db.inventory.find((i) => i.id === body.id);
      if (!target) {
        return Response.json({ ok: false, error: "Artículo no encontrado." }, { status: 404 });
      }
      const delta = Number(body.delta) || 0;
      target.stock = Math.max(0, Number(target.stock || 0) + delta);
      target.updatedAt = now;

      const { db: saved } = await writeDatabase(db, {
        reason: `Ajuste stock ${target.name} (${delta >= 0 ? `+${delta}` : delta})`,
        actor,
      });
      return Response.json(sanitizeDbForClient(saved, session));
    }

    if (action === "delete_inventory") {
      db.inventory = db.inventory.filter((i) => i.id !== body.id);
      const { db: saved } = await writeDatabase(db, {
        createBackup: true,
        reason: `Eliminación producto ${body.id}`,
        actor,
      });
      return Response.json(sanitizeDbForClient(saved, session));
    }

    if (action === "upsert_customer") {
      const c = body.customer || {};
      const idx = db.customers.findIndex((x) => x.id === c.id);
      if (idx >= 0) {
        db.customers[idx] = { ...db.customers[idx], ...c };
      } else {
        db.customers.unshift({
          id: c.id || makeId("CLI", db.customers),
          name: String(c.name || "Cliente").trim(),
          phone: String(c.phone || "").trim(),
          email: String(c.email || "").trim(),
          source: c.source || "manual",
          lastChannel: c.source || "manual",
          ordersCount: Number(c.ordersCount) || 0,
          totalSpent: Number(c.totalSpent) || 0,
          lastOrderAt: c.lastOrderAt || now,
          notes: String(c.notes || "").trim(),
          createdAt: now,
        });
      }
      const { db: saved } = await writeDatabase(db, { reason: "Actualización de cliente CRM", actor });
      return Response.json(sanitizeDbForClient(saved, session));
    }

    if (action === "delete_customer") {
      db.customers = db.customers.filter((c) => c.id !== body.id);
      const { db: saved } = await writeDatabase(db, {
        createBackup: true,
        reason: `Eliminación cliente ${body.id}`,
        actor,
      });
      return Response.json(sanitizeDbForClient(saved, session));
    }

    if (action === "upsert_machine") {
      const m = body.machine || {};
      const idx = db.machines.findIndex((x) => x.id === m.id);
      if (idx >= 0) {
        db.machines[idx] = {
          ...db.machines[idx],
          ...m,
          meterCount: Math.max(0, Number(m.meterCount ?? db.machines[idx].meterCount ?? 0)),
          maintenanceCost: Math.max(
            0,
            Number(m.maintenanceCost ?? db.machines[idx].maintenanceCost ?? 0)
          ),
          updatedAt: now,
        };
      } else {
        db.machines.unshift({
          id: m.id || makeId("MAQ", db.machines),
          name: String(m.name || "Equipo Nuevo").trim(),
          model: String(m.model || "").trim(),
          type: m.type || "Impresora",
          status: m.status || "Operativa",
          meterCount: Math.max(0, Number(m.meterCount) || 0),
          supplyLevel: String(m.supplyLevel || "").trim(),
          lastMaintenance: m.lastMaintenance || now.slice(0, 10),
          nextMaintenance: m.nextMaintenance || "",
          maintenanceCost: Math.max(0, Number(m.maintenanceCost) || 0),
          notes: String(m.notes || "").trim(),
          updatedAt: now,
        });
      }
      const { db: saved } = await writeDatabase(db, {
        reason: `Actualización máquina ${m.name || m.id}`,
        actor,
      });
      return Response.json(sanitizeDbForClient(saved, session));
    }

    if (action === "delete_machine") {
      db.machines = db.machines.filter((m) => m.id !== body.id);
      const { db: saved } = await writeDatabase(db, {
        createBackup: true,
        reason: `Eliminación máquina ${body.id}`,
        actor,
      });
      return Response.json(sanitizeDbForClient(saved, session));
    }

    if (action === "create_backup") {
      const { db: saved } = await writeDatabase(db, {
        createBackup: true,
        reason: body.reason || "Respaldo manual desde Panel",
        actor,
      });
      return Response.json(sanitizeDbForClient(saved, session));
    }

    if (action === "restore_backup") {
      let snapshotData = null;
      if (body.backupId) {
        const found = (db.backups || []).find((b) => b.id === body.backupId);
        if (!found?.snapshotData) {
          return Response.json({ ok: false, error: "Respaldo no encontrado." }, { status: 404 });
        }
        snapshotData = found.snapshotData;
      } else if (body.snapshotData && typeof body.snapshotData === "object") {
        snapshotData = body.snapshotData;
      } else {
        return Response.json({ ok: false, error: "Datos de respaldo inválidos." }, { status: 400 });
      }

      // Guardar respaldo previo antes de restaurar
      await writeDatabase(db, {
        createBackup: true,
        reason: "Respaldo previo a restauración",
        actor,
      });

      const updatedDb = await readDatabase();
      if (Array.isArray(snapshotData.inventory)) updatedDb.inventory = structuredClone(snapshotData.inventory);
      if (Array.isArray(snapshotData.orders)) updatedDb.orders = structuredClone(snapshotData.orders);
      if (Array.isArray(snapshotData.customers)) updatedDb.customers = structuredClone(snapshotData.customers);
      if (Array.isArray(snapshotData.machines)) updatedDb.machines = structuredClone(snapshotData.machines);

      const { db: saved } = await writeDatabase(updatedDb, {
        createBackup: true,
        reason: body.backupId ? `Restaurado desde ${body.backupId}` : "Importación de respaldo JSON",
        actor,
      });

      return Response.json(sanitizeDbForClient(saved, session));
    }

    if (action === "import_crm_rows") {
      const target = body.target || "orders";
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const extraCustomers = Array.isArray(body.customersRows) ? body.customersRows : [];
      if (rows.length === 0 && extraCustomers.length === 0) {
        return Response.json({ ok: false, error: "El archivo no contiene filas válidas." }, { status: 400 });
      }

      if (extraCustomers.length > 0 || target === "customers") {
        const custList = target === "customers" ? rows : extraCustomers;
        custList.forEach((row) => {
          const name = String(
            row.Nombre || row["Nombre ficticio"] || row["Nombre del cliente"] || row.name || ""
          ).trim();
          if (!name) return;
          const id = String(row["ID cliente"] || row.ID || row.id || "").trim() || makeId("CLI", db.customers);
          const phone = String(row["Teléfono"] || row["Teléfono ficticio"] || row.Telefono || row.phone || "").trim();
          const email = String(row.Correo || row["Correo ficticio"] || row.email || "").trim();
          const existing = db.customers.find(
            (c) => c.id === id || (phone && c.phone === phone) || (email && c.email === email)
          );
          if (existing) {
            existing.name = name;
            if (phone) existing.phone = phone;
            if (email) existing.email = email;
            if (row["Notas de atención"] || row.Notas) {
              existing.notes = String(row["Notas de atención"] || row.Notas || "").trim();
            }
          } else {
            db.customers.unshift({
              id,
              name,
              phone,
              email,
              source: row["Canal preferido"] || row.Canal || "excel_import",
              lastChannel: row["Canal preferido"] || row.Canal || "excel_import",
              ordersCount: Number(row["Compras registradas"] ?? row.Pedidos ?? 0) || 0,
              totalSpent: Number(row["Total Comprado"] ?? 0) || 0,
              lastOrderAt: row["Última compra"] || row["Fecha de registro"] || now,
              notes: String(row["Notas de atención"] || row.Notas || row.notes || "").trim(),
              createdAt: row["Fecha de registro"] || now,
            });
          }
        });
      }

      if (target === "inventory") {
        rows.forEach((row) => {
          const name = String(row.Nombre || row.name || row.Producto || "").trim();
          if (!name) return;
          const existing = db.inventory.find(
            (i) =>
              (row.ID && i.id === row.ID) ||
              (row.SKU && i.sku === row.SKU) ||
              i.name.toLowerCase() === name.toLowerCase()
          );
          if (existing) {
            existing.stock = Number(row.Stock ?? row.stock ?? existing.stock) || 0;
            existing.salePrice = Number(row["Precio Venta"] ?? row.salePrice ?? existing.salePrice) || 0;
            existing.costPrice = Number(row["Precio Costo"] ?? row.costPrice ?? existing.costPrice) || 0;
            existing.updatedAt = now;
          } else {
            db.inventory.unshift({
              id: makeId("INV", db.inventory),
              sku: String(row.SKU || row.sku || `IMP-${Math.random().toString(36).slice(2, 6).toUpperCase()}`),
              name,
              category: row.Categoría || row.Categoria || row.category || "Papelería",
              type: row.Tipo || row.type || "Producto",
              stock: Number(row.Stock ?? row.stock ?? 0) || 0,
              minStock: Number(row["Stock Mínimo"] ?? row.minStock ?? 5) || 5,
              unit: row.Unidad || row.unit || "uds",
              costPrice: Number(row["Precio Costo"] ?? row.costPrice ?? 0) || 0,
              salePrice: Number(row["Precio Venta"] ?? row.salePrice ?? 0) || 0,
              supplier: row.Proveedor || row.supplier || "",
              notes: row.Notas || row.notes || "",
              updatedAt: now,
            });
          }
        });
      } else if (target !== "customers") {
        rows.forEach((row) => {
          const customerName = String(
            row.Cliente || row["Nombre del cliente"] || row.Nombre || row.customerName || ""
          ).trim();
          const serviceName = String(
            row.Servicio || row["Producto / servicio"] || row.serviceName || ""
          ).trim();
          if (!customerName && !serviceName) return;

          const id =
            String(row.ID || row["ID pedido"] || row.id || "").trim() ||
            `PED-${now.slice(0, 10).replace(/-/g, "")}-${String(db.orders.length + 1).padStart(3, "0")}`;

          if (db.orders.some((o) => o.id === id)) return;

          const matchedCust = row["ID cliente"]
            ? db.customers.find((c) => c.id === row["ID cliente"])
            : null;

          const newOrder = {
            id,
            createdAt: row.Fecha || row["Fecha del pedido"] || row.createdAt || now,
            updatedAt: now,
            source: row.Canal || row.source || "excel_import",
            customerName: customerName || "Cliente Importado",
            phone: String(
              row.Teléfono || row.Telefono || row.phone || matchedCust?.phone || ""
            ).trim(),
            whatsappFrom: "",
            email: String(row.Correo || row.email || matchedCust?.email || "").trim(),
            serviceName: serviceName || "Pedido Excel",
            details: String(row.Detalles || row.details || "").trim(),
            quantity: Number(row.Cantidad ?? row.quantity ?? 1) || 1,
            unitPrice: Number(row["Precio Unitario"] ?? row.unitPrice ?? 0) || 0,
            total: Number(row.Total ?? row["Monto (₡)"] ?? row.total ?? 0) || 0,
            paymentMethod: row["Método Pago"] || row["Metodo Pago"] || row.paymentMethod || "Pendiente",
            status: row.Estado || row.status || "Pendiente",
            inventoryItemId: "",
            notes: String(row.Notas || row.Alerta || row.notes || "").trim(),
          };
          db.orders.unshift(newOrder);
          upsertCustomerFromOrder(db, newOrder);
        });
      }

      const { db: saved } = await writeDatabase(db, {
        createBackup: true,
        reason: `Importación Excel (${target}: ${rows.length} pedidos / ${extraCustomers.length} clientes)`,
        actor,
      });
      return Response.json(sanitizeDbForClient(saved, session));
    }

    return Response.json({ ok: false, error: "Acción no reconocida." }, { status: 400 });
  } catch (err) {
    console.error("Error en POST /api/db:", err);
    return Response.json(
      { ok: false, error: "Error procesando operación de base de datos." },
      { status: 500 }
    );
  }
}
