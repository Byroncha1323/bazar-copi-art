import {
  authenticateCredentials,
  requireAdmin,
  updateAdminCredentials,
} from "./_lib/auth.js";

function buildSessionCookie(token, maxAgeSeconds = 86400) {
  const secure = process.env.VERCEL ? "; Secure" : "";
  return `bazar_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export async function GET(request) {
  const session = await requireAdmin(request);
  if (!session.ok) {
    return Response.json({ authenticated: false }, { status: 200 });
  }
  return Response.json({
    authenticated: true,
    username: session.username,
    usingDefaultPassword: session.usingDefaultPassword,
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { username, password } = body || {};

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

    const body = await request.json();
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
