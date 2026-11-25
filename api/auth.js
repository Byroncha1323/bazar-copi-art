import {
  authenticateCredentials,
  requireAdmin,
  updateAdminCredentials,
} from "./_lib/auth.js";
import {
  checkRateLimit,
  getClientIp,
  getTurnstileSiteKey,
  verifyTurnstileToken,
} from "./_lib/security.js";

function buildSessionCookie(token, maxAgeSeconds = 86400) {
  const secure = process.env.VERCEL ? "; Secure" : "";
  return `bazar_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export async function GET(request) {
  const session = await requireAdmin(request);
  const turnstileSiteKey = getTurnstileSiteKey();
  if (!session.ok) {
    return Response.json({ authenticated: false, turnstileSiteKey }, { status: 200 });
  }
  return Response.json({
    authenticated: true,
    username: session.username,
    usingDefaultPassword: session.usingDefaultPassword,
    turnstileSiteKey,
  });
}

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const rate = checkRateLimit("auth_login", ip, 10, 5 * 60_000);
    if (!rate.allowed) {
      return Response.json(
        {
          ok: false,
          error: `Demasiados intentos. Espera ${rate.retryAfterSec} segundos antes de volver a intentar.`,
        },
        { status: 429 }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ ok: false, error: "JSON inválido." }, { status: 400 });
    }
    const { username, password, cfTurnstileToken } = body || {};

    const turnstile = await verifyTurnstileToken(cfTurnstileToken, request);
    if (!turnstile.ok) {
      return Response.json({ ok: false, error: turnstile.error }, { status: 403 });
    }

    if (!username || !password) {
      return Response.json(
        { ok: false, error: "Ingresa tu usuario y contraseña." },
        { status: 400 }
      );
    }

    const result = await authenticateCredentials(username, password);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.reason }, { status: 401 });
    }

    return Response.json(
      {
        ok: true,
        token: result.token,
        username: result.username,
        usingDefaultPassword: result.usingDefaultPassword,
      },
      {
        status: 200,
        headers: {
          "Set-Cookie": buildSessionCookie(result.token),
        },
      }
    );
  } catch (err) {
    console.error("Error en POST /api/auth:", err);
    return Response.json(
      { ok: false, error: "Error procesando inicio de sesión." },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  try {
    const session = await requireAdmin(request);
    if (!session.ok) {
      return Response.json({ ok: false, error: "No autorizado." }, { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ ok: false, error: "JSON inválido." }, { status: 400 });
    }
    const result = await updateAdminCredentials(body || {});
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: 400 });
    }

    return Response.json(
      {
        ok: true,
        username: result.username,
        token: result.token,
        usingDefaultPassword: false,
      },
      {
        status: 200,
        headers: {
          "Set-Cookie": buildSessionCookie(result.token),
        },
      }
    );
  } catch (err) {
    console.error("Error en PUT /api/auth:", err);
    return Response.json(
      { ok: false, error: "Error actualizando credenciales." },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  return Response.json(
    { ok: true },
    {
      status: 200,
      headers: {
        "Set-Cookie": buildSessionCookie("", 0),
      },
    }
  );
}
