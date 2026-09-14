import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, parse as parseUrl } from "node:url";
import { CatalogService } from "./catalog.mjs";
import { StreamSimulator } from "./simulator.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, "../public");

const catalog = new CatalogService();
const simulator = new StreamSimulator(catalog);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
};

async function handleRequest(req, res) {
  const parsed = parseUrl(req.url, true);
  const pathname = parsed.pathname;
  const query = parsed.query;

  // Enable CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- API Endpoints ---
  if (pathname === "/health") {
    sendJson(res, { status: "ok", mode: "simulator", timestamp: new Date().toISOString() });
    return;
  }

  if (pathname === "/api/catalog") {
    await catalog.init();
    sendJson(res, {
      docs: catalog.docs.map((d) => ({
        id: d.id,
        num: d.num,
        slug: d.slug,
        title: d.title,
        subtitle: d.subtitle,
        category: d.category,
        isStudioDoc: Boolean(d.isStudioDoc),
      })),
      fixtures: catalog.fixtures,
      presets: catalog.presets,
      gotchas: catalog.gotchas,
    });
    return;
  }

  if (pathname.startsWith("/api/docs/")) {
    const docId = pathname.replace("/api/docs/", "");
    const doc = await catalog.getDocContent(docId);
    if (!doc) return sendError(res, 404, "Document not found");
    sendJson(res, doc);
    return;
  }

  if (pathname.startsWith("/api/fixtures/")) {
    const fixId = pathname.replace("/api/fixtures/", "");
    const fix = await catalog.getFixtureData(fixId);
    if (!fix) return sendError(res, 404, "Fixture not found");
    sendJson(res, fix);
    return;
  }

  if (pathname.startsWith("/api/presets/")) {
    const presetId = pathname.replace("/api/presets/", "");
    const preset = await catalog.getPresetData(presetId);
    if (!preset) return sendError(res, 404, "Preset not found");
    sendJson(res, preset);
    return;
  }

  // SSE Stream Simulation
  if (pathname.startsWith("/api/stream/simulate/")) {
    const fixtureId = pathname.replace("/api/stream/simulate/", "");
    const delayMs = query.speed === "instant" ? 0 : parseInt(query.delayMs || "90", 10);
    const injectError = query.injectError === "true";

    await simulator.streamFixture(fixtureId, res, { delayMs, injectError });
    return;
  }

  // Simulated Chat POST
  if (pathname === "/api/chat/simulate" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const queryText = (payload.query?.text || "").toLowerCase();

        // Intelligently map prompt to the most representative output fixture
        let targetFixture = "01-basic-stream-assist";
        if (queryText.includes("research") || queryText.includes("plan")) {
          targetFixture = "09-deep-research-plan";
        } else if (queryText.includes("image") || queryText.includes("generate")) {
          targetFixture = "13-image-generation";
        } else if (queryText.includes("a2a") || payload.isA2A) {
          targetFixture = "24-a2a-message-stream.excerpt";
        } else if (payload.agentId || payload.agentsSpec) {
          targetFixture = "08-invoke-adk-agent.excerpt";
        } else if (payload.fileIds && payload.fileIds.length > 0) {
          targetFixture = "16-query-with-files";
        } else if (payload.session) {
          targetFixture = "04-multi-turn-session";
        }

        const delayMs = parseInt(query.delayMs || "70", 10);
        await simulator.streamFixture(targetFixture, res, { delayMs });
      } catch (err) {
        sendError(res, 400, "Invalid JSON body: " + err.message);
      }
    });
    return;
  }

  if (pathname === "/api/smoke/checks") {
    sendJson(res, { checks: simulator.getSimulatedSmokeChecks() });
    return;
  }

  if (pathname === "/api/soak/metrics") {
    sendJson(res, simulator.getSimulatedSoakMetrics());
    return;
  }

  // --- Static Files ---
  let filePath = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const content = await fs.readFile(filePath);

    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch (err) {
    if (pathname === "/" || !path.extname(pathname)) {
      // Fallback to index.html for SPA client-side routing
      try {
        const indexHtml = await fs.readFile(path.join(PUBLIC_DIR, "index.html"));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(indexHtml);
        return;
      } catch {
        // public/index.html not created yet
      }
    }
    sendError(res, 404, `File not found: ${pathname}`);
  }
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function sendError(res, status, message) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: message, status }));
}

export function startServer(preferredPort = 3000, maxAttempts = 10) {
  let port = preferredPort;
  let attempts = 0;

  function tryListen() {
    const server = http.createServer(handleRequest);

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE" && attempts < maxAttempts) {
        console.warn(`[Studio] Port ${port} is in use, trying ${port + 1}...`);
        port++;
        attempts++;
        tryListen();
      } else {
        console.error("[Studio] Server error:", err);
      }
    });

    server.listen(port, () => {
      console.log(`\n======================================================`);
      console.log(`🚀 Gemini StreamAssist Studio is running!`);
      console.log(`📡 URL: http://localhost:${port}`);
      console.log(`⚡ Mode: Offline Simulator (17 Payloads Ready)`);
      console.log(`📖 Docs & Studio Guide: http://localhost:${port}/#docs`);
      console.log(`======================================================\n`);
    });

    return server;
  }

  return tryListen();
}

// Auto-start when executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = parseInt(process.env.PORT || "3000", 10);
  startServer(port);
}

