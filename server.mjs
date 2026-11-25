import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { GET as authGet, POST as authPost, PUT as authPut, DELETE as authDelete } from "./api/auth.js";
import { GET as dbGet, POST as dbPost } from "./api/db.js";
import { GET as waGet, POST as waPost } from "./api/whatsapp.js";

const PORT = Number(process.env.PORT) || 3000;
const ROOT = process.cwd();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const API_MAP = {
  "/api/auth": { GET: authGet, POST: authPost, PUT: authPut, DELETE: authDelete },
  "/api/db": { GET: dbGet, POST: dbPost },
  "/api/whatsapp": { GET: waGet, POST: waPost },
};

async function toWebRequest(req) {
  const url = `http://${req.headers.host || "localhost:" + PORT}${req.url}`;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  return new Request(url, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = reqUrl.pathname;

    if (API_MAP[pathname]) {
      const handler = API_MAP[pathname][req.method];
      if (!handler) {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
        return;
      }
      const webReq = await toWebRequest(req);
      const webRes = await handler(webReq);
      const outHeaders = {};
      webRes.headers.forEach((v, k) => {
        outHeaders[k] = v;
      });
      res.writeHead(webRes.status, outHeaders);
      const buf = Buffer.from(await webRes.arrayBuffer());
      res.end(buf);
      return;
    }

    let safePath = pathname === "/" ? "/index.html" : pathname;
    if (safePath === "/admin") safePath = "/admin.html";
    const resolved = path.resolve(ROOT, "." + safePath);
    if (!resolved.startsWith(ROOT)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const fileData = await fs.readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(fileData);
  } catch (err) {
    if (err.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    console.error(err);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Server Error");
  }
});

server.listen(PORT, () => {
  console.log(`Bazar Copi Art servidor local activo en http://localhost:${PORT}`);
});
