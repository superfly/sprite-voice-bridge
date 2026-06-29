// Voice bridge server.
//
// Serves the built Vite app (web/dist) and accepts a WebSocket at "/ws".
// Binary frames are raw s16le / 16000 Hz / mono PCM captured in the browser;
// we funnel them straight into the FIFO that PulseAudio's pipe-source reads,
// so arecord (what Claude Code's /voice runs) sees them as a live mic.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const BRIDGE_DIR = process.env.BRIDGE_DIR || __dirname;
const PORT = process.env.PORT || 8080;
const FIFO = process.env.MIC_FIFO || path.join(BRIDGE_DIR, "mic.fifo");
const DIST = path.join(BRIDGE_DIR, "web", "dist");

// ~1.5 s of 16 kHz mono s16le; a single frame is a few KB, so cap both the
// queued backlog and any single frame at this size.
const MAX_BACKLOG_BYTES = 48000;
const MAX_FRAME_BYTES = 65536;

// Optional cross-site-WebSocket-hijack protection: a comma-separated allowlist
// of permitted Origins. Off by default (the Sprite proxy / `sprite proxy`
// tunnel already gate access); set ALLOWED_WS_ORIGINS to enforce.
const ALLOWED_WS_ORIGINS = (process.env.ALLOWED_WS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// --- persistent FIFO writer ------------------------------------------------
// Opening a FIFO for write blocks until a reader (pulse) is present, so we
// open lazily/asynchronously and reopen on error.
let fifo = null;
let opening = false;

function openFifo() {
  if (fifo || opening) return;
  opening = true;
  const s = fs.createWriteStream(FIFO, { flags: "a" });
  s.on("open", () => {
    fifo = s;
    opening = false;
    console.log("[bridge] FIFO open for write:", FIFO);
  });
  s.on("error", (err) => {
    console.error("[bridge] FIFO error, will reopen:", err.message);
    fifo = null;
    opening = false;
    try { s.destroy(); } catch {}
    setTimeout(openFifo, 500);
  });
}
openFifo();

function writePcm(buf) {
  if (buf.length === 0 || buf.length & 1) return;        // s16le → must be even
  if (buf.length > MAX_BACKLOG_BYTES) return;            // single oversized frame
  if (!fifo) { openFifo(); return; }
  if (fifo.writableLength + buf.length > MAX_BACKLOG_BYTES) return; // backpressure
  fifo.write(buf);
}

// --- static file serving (web/dist) ----------------------------------------
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, { "x-content-type-options": "nosniff", ...headers });
  res.end(body);
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  let rel = path.normalize(urlPath);
  if (rel === "/" || rel === "") rel = "/index.html";
  const filePath = path.join(DIST, rel);
  // Confine to DIST: allow DIST itself or paths under DIST + separator only.
  if (filePath !== DIST && !filePath.startsWith(DIST + path.sep)) {
    return send(res, 403, "forbidden");
  }

  fs.readFile(filePath, (err, body) => {
    if (err) {
      // SPA fallback: unknown non-asset route → index.html
      if (!path.extname(rel)) {
        return fs.readFile(path.join(DIST, "index.html"), (e2, html) =>
          e2
            ? send(res, 404, "not found")
            : send(res, 200, html, { "content-type": TYPES[".html"], "cache-control": "no-cache" }),
        );
      }
      return send(res, 404, "not found");
    }
    const type = TYPES[path.extname(filePath)] || "application/octet-stream";
    const cache = rel.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache";
    send(res, 200, body, { "content-type": type, "cache-control": cache });
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, "method not allowed", { allow: "GET, HEAD" });
  }
  if (req.url === "/healthz") return send(res, 200, "ok");
  serveStatic(req, res);
});

// --- websocket -------------------------------------------------------------
function verifyClient(info) {
  if (ALLOWED_WS_ORIGINS.length === 0) return true; // not enforced
  const origin = info.req.headers.origin;
  if (!origin) return true; // non-browser clients (curl, tests)
  return ALLOWED_WS_ORIGINS.includes(origin);
}

const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: MAX_FRAME_BYTES,
  verifyClient,
});

// Single active producer: if two tabs record at once, only the first to send
// audio writes to the FIFO — otherwise their s16le frames interleave into garble.
let producer = null;

wss.on("connection", (ws, req) => {
  console.log("[bridge] client connected:", req.socket.remoteAddress);
  openFifo();
  ws.on("message", (data, isBinary) => {
    if (!isBinary) return;
    if (producer && producer !== ws) return; // another tab owns the mic
    producer = ws;
    writePcm(Buffer.isBuffer(data) ? data : Buffer.from(data));
  });
  const release = () => { if (producer === ws) producer = null; };
  ws.on("close", () => { release(); console.log("[bridge] client disconnected"); });
  ws.on("error", (e) => { release(); console.error("[bridge] ws error:", e.message); });
});

server.listen(PORT, () => {
  console.log(`[bridge] listening on :${PORT} (serving ${DIST})`);
  if (ALLOWED_WS_ORIGINS.length) {
    console.log("[bridge] WS Origin allowlist:", ALLOWED_WS_ORIGINS.join(", "));
  }
});
