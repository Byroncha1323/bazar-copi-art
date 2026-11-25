import crypto from "node:crypto";
import { readDatabase, writeDatabase } from "./db.js";

const DEFAULT_ADMIN_USER = "copiart";
const DEFAULT_ADMIN_PASS = "CopiArt2026!";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24; // 24 horas

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPasswordHash(password, storedHash) {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, expectedHex] = storedHash.split(":");
  const actualBuf = crypto.scryptSync(String(password), salt, 64);
  const expectedBuf = Buffer.from(expectedHex, "hex");
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

function getAuthSecret(db) {
  return (
    process.env.ADMIN_AUTH_SECRET ||
    db?.settings?.authSecret ||
    crypto
      .createHash("sha256")
      .update(`${process.env.VERCEL_PROJECT_ID || process.cwd()}:bazar-copi-art-secret`)
      .digest("hex")
  );
}

function base64UrlEncode(str) {
  return Buffer.from(str, "utf8").toString("base64url");
}

function base64UrlDecode(str) {
  return Buffer.from(str, "base64url").toString("utf8");
}

export function createSessionToken(username, db) {
  const now = Date.now();
  const payload = JSON.stringify({
    u: username,
    iat: now,
    exp: now + TOKEN_TTL_MS,
  });
  const encoded = base64UrlEncode(payload);
  const sig = crypto
    .createHmac("sha256", getAuthSecret(db))
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token, db) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) return null;

  const expectedSig = crypto
    .createHmac("sha256", getAuthSecret(db))
    .update(encoded)
    .digest("base64url");

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encoded));
    if (!payload?.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function authenticateCredentials(username, password) {
  const db = await readDatabase();
  const cleanUser = String(username || "").trim();
  const cleanPass = String(password || "");

  const expectedUser =
    process.env.ADMIN_USER || db.settings?.adminUsername || DEFAULT_ADMIN_USER;

  if (cleanUser.toLowerCase() !== expectedUser.toLowerCase()) {
    return { ok: false, reason: "Usuario o contraseña incorrectos." };
  }

  // Prioridad: 1) Hash guardado en BD por la jefa, 2) Variable de entorno ADMIN_PASSWORD, 3) Clave inicial
  let valid = false;
  if (db.settings?.adminPasswordHash) {
    valid = verifyPasswordHash(cleanPass, db.settings.adminPasswordHash);
  } else if (process.env.ADMIN_PASSWORD) {
    const a = Buffer.from(cleanPass);
    const b = Buffer.from(process.env.ADMIN_PASSWORD);
    valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  } else {
    const a = Buffer.from(cleanPass);
    const b = Buffer.from(DEFAULT_ADMIN_PASS);
    valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  if (!valid) {
    return { ok: false, reason: "Usuario o contraseña incorrectos." };
  }

  const token = createSessionToken(expectedUser, db);
  const usingDefaultPassword =
    !db.settings?.adminPasswordHash && !process.env.ADMIN_PASSWORD;

  return {
    ok: true,
    token,
    username: expectedUser,
    usingDefaultPassword,
  };
}

export async function requireAdmin(request) {
  const authHeader = request.headers.get("authorization") || "";
  const cookieHeader = request.headers.get("cookie") || "";

  let token = "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    token = authHeader.slice(7).trim();
  } else if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)bazar_token=([^;]+)/);
    if (match) token = decodeURIComponent(match[1]);
  }

  const db = await readDatabase();
  const payload = verifySessionToken(token, db);
  if (!payload) {
    return { ok: false, db };
  }
  const usingDefaultPassword =
    !db.settings?.adminPasswordHash && !process.env.ADMIN_PASSWORD;
  return {
    ok: true,
    username: payload.u,
    usingDefaultPassword,
    db,
  };
}

export async function updateAdminCredentials({ newUsername, currentPassword, newPassword }) {
  const db = await readDatabase();
  const currentUser =
    process.env.ADMIN_USER || db.settings?.adminUsername || DEFAULT_ADMIN_USER;

  const check = await authenticateCredentials(currentUser, currentPassword);
  if (!check.ok) {
    return { ok: false, error: "La contraseña actual no es correcta." };
  }

  if (newPassword && String(newPassword).length < 6) {
    return {
      ok: false,
      error: "La nueva contraseña debe tener al menos 6 caracteres.",
    };
  }

  if (newUsername && String(newUsername).trim().length >= 3) {
    db.settings.adminUsername = String(newUsername).trim();
  }
  if (newPassword) {
    db.settings.adminPasswordHash = hashPassword(newPassword);
  }

  await writeDatabase(db, {
    createBackup: true,
    reason: "Actualización de credenciales de administración",
    actor: db.settings.adminUsername || currentUser,
  });

  const activeUser = db.settings.adminUsername || currentUser;
  const token = createSessionToken(activeUser, db);

  return {
    ok: true,
    username: activeUser,
    token,
    usingDefaultPassword: false,
  };
}
