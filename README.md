# Bazar Copi Art · Sitio Web, Asistente Inteligente y Panel Administrativo

Sitio web oficial, asistente virtual de atención/pedidos, webhook de WhatsApp Cloud API y panel de administración (**Ventas, Excel `.xlsx`, Inventario, Clientes y Máquinas**) para **Bazar Copi Art** (Costa Rica).

## Arquitectura y Funcionalidades
- **Web Pública ([index.html](index.html), [script.js](script.js), [styles.css](styles.css)):** Catálogo en colones (₡), horario en vivo, asistente conversacional coherente, pedido paso a paso con enlace directo prellenado a WhatsApp (`+506 6476-0290`) y registro automático en la base de datos.
- **Panel de Administración ([admin.html](admin.html), [admin.js](admin.js), [admin.css](admin.css), [xlsx-utils.js](xlsx-utils.js)):** Acceso con usuario y contraseña, interfaz sencilla sin tecnicismos, botones de 1 clic (*Listo para Retiro*, *Entregado*, *Cierre del Día*), exportación e importación real en Excel (`.xlsx` multi-hoja y `.csv`), inventario con alertas de stock, segmentación de clientes, control de máquinas/mantenimiento y copias de seguridad locales + en la nube.
- **Backend Serverless (`/api`):**
  - `/api/auth`: autenticación con contraseñas `scrypt` + tokens HMAC-SHA256, límite de intentos y soporte para **Cloudflare Turnstile**.
  - `/api/db`: base de datos unificada con soporte automático para **Cloudflare D1**, **Cloudflare KV**, **Upstash Redis / Vercel KV**, **Supabase**, archivo local o caché runtime.
  - `/api/whatsapp`: webhook oficial de Meta WhatsApp Cloud API + chat web con soporte para **Cloudflare Workers AI**, **Google Gemini**, **OpenAI** y **Motor Contextual Coherente** local sin costo.

## Variables de Entorno Opcionales en Vercel (100% Nivel Gratuito)

### Seguridad y Protección Anti-Bots (Cloudflare Turnstile)
- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`

### Base de Datos Permanente en Cloudflare (D1 o KV) o Upstash Redis
- **Cloudflare D1:** `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_D1_DATABASE_ID`
- **Cloudflare KV:** `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_KV_NAMESPACE_ID`
- **Upstash Redis / Vercel KV:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

### Inteligencia Artificial (WhatsApp y Chat Web)
- **Cloudflare Workers AI:** `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` *(opcional `CLOUDFLARE_AI_MODEL`)*
- **Google Gemini:** `GEMINI_API_KEY`
- **OpenAI:** `OPENAI_API_KEY`

### Administración y WhatsApp Cloud API
- `ADMIN_USER`, `ADMIN_PASSWORD`, `ADMIN_AUTH_SECRET`
- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `OWNER_WHATSAPP_NUMBER`
