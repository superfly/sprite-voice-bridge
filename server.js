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

// ~1.5 s of 16 kHz mono s16le. If the FIFO write buffer grows past this the
// source isn't draining in real time — drop fresh audio rather than buffer it
// in memory (which would add unbounded latency and break transcription).
const MAX_BACKLOG_BYTES = 48000;

function writePcm(buf) {
  if (!fifo) { openFifo(); return; }
  if (fifo.writableLength > MAX_BACKLOG_BYTES) return; // drop; PCM is disposable
  fifo.write(buf);
}

// --- static file serving (web/dist) ----------------------------------------
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, headers);
  res.end(body);
}

function serveStatic(req, res) {
  // Strip query, normalize, prevent path traversal.
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  let rel = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  if (rel === "/" || rel === "") rel = "/index.html";
  let filePath = path.join(DIST, rel);
  if (!filePath.startsWith(DIST)) return send(res, 403, "forbidden");

  fs.readFile(filePath, (err, body) => {
    if (err) {
      // SPA fallback: unknown non-asset route → index.html
      if (!path.extname(rel)) {
        return fs.readFile(path.join(DIST, "index.html"), (e2, html) =>
          e2 ? send(res, 404, "not found") : send(res, 200, html, { "content-type": TYPES[".html"] })
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
  if (req.url === "/healthz") return send(res, 200, "ok");
  serveStatic(req, res);
});

// --- websocket -------------------------------------------------------------
const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws, req) => {
  console.log("[bridge] client connected:", req.socket.remoteAddress);
  openFifo();
  ws.on("message", (data, isBinary) => {
    if (isBinary) writePcm(Buffer.isBuffer(data) ? data : Buffer.from(data));
  });
  ws.on("close", () => console.log("[bridge] client disconnected"));
  ws.on("error", (e) => console.error("[bridge] ws error:", e.message));
});

server.listen(PORT, () => console.log(`[bridge] listening on :${PORT} (serving ${DIST})`));
