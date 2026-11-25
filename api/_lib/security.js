const rateBuckets = globalThis.__bazarRateBuckets || new Map();
globalThis.__bazarRateBuckets = rateBuckets;

export function getClientIp(request) {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

export function checkRateLimit(scope, ip, maxRequests = 15, windowMs = 60_000) {
  const now = Date.now();
  const key = `${scope}:${ip}`;
  const entry = rateBuckets.get(key);

  if (!entry || now > entry.resetAt) {
    if (rateBuckets.size > 2000) {
      const oldest = rateBuckets.keys().next().value;
      rateBuckets.delete(oldest);
    }
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  entry.count += 1;
  if (entry.count > maxRequests) {
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  return { allowed: true, remaining: maxRequests - entry.count };
}

export function getTurnstileSiteKey() {
  if (process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY) {
    return process.env.TURNSTILE_SITE_KEY;
  }
  return "";
}

export async function verifyTurnstileToken(token, request) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !process.env.TURNSTILE_SITE_KEY) {
    return { ok: true, skipped: true };
  }

  const cleanToken = String(token || "").trim();
  if (!cleanToken) {
    return {
      ok: false,
      error: "Por favor completa la verificación de seguridad anti-bots.",
    };
  }

  try {
    const body = new URLSearchParams({
      secret,
      response: cleanToken,
      remoteip: getClientIp(request),
    });

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      console.error("Error consultando Cloudflare Turnstile:", res.status);
      return { ok: false, error: "No se pudo validar la verificación de seguridad." };
    }

    const data = await res.json();
    if (!data?.success) {
      return {
        ok: false,
        error: "La verificación de seguridad expiró o no es válida. Intenta de nuevo.",
      };
    }

    return { ok: true, skipped: false };
  } catch (err) {
    console.error("Excepción verificando Cloudflare Turnstile:", err);
    return { ok: false, error: "Error conectando con la verificación de seguridad." };
  }
}
