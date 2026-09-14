import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lenientParseJsonArray } from "./catalog.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

export class StreamSimulator {
  constructor(catalog) {
    this.catalog = catalog;
  }

  async streamFixture(fixtureId, res, options = {}) {
    const { delayMs = 100, injectError = false } = options;

    await this.catalog.init();
    let fixture = this.catalog.fixtures.find((f) => f.id === fixtureId || f.filename === fixtureId);
    if (!fixture) {
      fixture = this.catalog.fixtures[0]; // fallback to 01-basic
    }

    const filePath = path.join(REPO_ROOT, "outputs", fixture.filename);
    const rawContent = await fs.readFile(filePath, "utf-8");

    let chunks = [];
    if (fixture.isJson) {
      const parsed = lenientParseJsonArray(rawContent);
      if (parsed) {
        chunks = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        try {
          const direct = JSON.parse(rawContent);
          chunks = Array.isArray(direct) ? direct : [direct];
        } catch (err) {
          chunks = [{ rawText: rawContent }];
        }
      }
    } else {
      // Split text lines as simulated chunks
      chunks = rawContent.split("\n\n").filter(Boolean).map((text, i) => ({
        diagnosticChunk: i + 1,
        text,
      }));
    }

    if (injectError) {
      // Inject Gotcha #9 after chunk 2
      const errorChunk = {
        error: {
          code: 400,
          message: "Simulated Gotcha #9: Mid-stream failure with HTTP 200 (FAILED_PRECONDITION: agent is disabled or unreachable)",
          status: "FAILED_PRECONDITION",
          details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "AGENT_EXECUTION_FAILED" }]
        }
      };
      if (chunks.length >= 2) {
        chunks = [chunks[0], chunks[1], errorChunk];
      } else {
        chunks.push(errorChunk);
      }
    }

    // Set up SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    res.write(`event: start\ndata: ${JSON.stringify({
      fixtureId: fixture.id,
      filename: fixture.filename,
      totalChunks: chunks.length,
      mode: "simulator",
      hasError: injectError,
    })}\n\n`);

    const startTime = Date.now();

    for (let i = 0; i < chunks.length; i++) {
      if (delayMs > 0 && i > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      const chunk = chunks[i];
      const isLast = i === chunks.length - 1;
      const isError = Boolean(chunk.error);

      res.write(`event: chunk\ndata: ${JSON.stringify({
        index: i + 1,
        total: chunks.length,
        isLast,
        isError,
        chunk,
        rawWire: JSON.stringify(chunk, null, 2),
      })}\n\n`);
    }

    const elapsedMs = Date.now() - startTime;
    res.write(`event: complete\ndata: ${JSON.stringify({
      fixtureId: fixture.id,
      totalChunks: chunks.length,
      elapsedMs,
      completedAt: new Date().toISOString(),
    })}\n\n`);

    res.end();
  }

  getSimulatedSmokeChecks() {
    return [
      { id: "01", name: "Basic streamAssist query", file: "01-basic-stream-assist.sh", expectedChunks: 6, status: "PASS", latencyMs: 242 },
      { id: "02", name: "Answer text extraction (jq)", file: "02-extract-answer-text.sh", expectedChunks: 6, status: "PASS", latencyMs: 215 },
      { id: "03", name: "Session creation (-)", file: "03-create-session.sh", expectedChunks: 1, status: "PASS", latencyMs: 180 },
      { id: "04", name: "Multi-turn conversation", file: "04-multi-turn-session.sh", expectedChunks: 5, status: "PASS", latencyMs: 388 },
      { id: "06", name: "Agent discovery & listing", file: "06-list-agents.sh", expectedChunks: 1, status: "PASS", latencyMs: 145 },
      { id: "08", name: "ADK Agent routing & functionCall", file: "08-invoke-specific-agent.sh", expectedChunks: 7, status: "PASS", latencyMs: 412 },
      { id: "11", name: "Google Web Grounding & citations", file: "11-web-grounding.sh", expectedChunks: 8, status: "PASS", latencyMs: 350 },
      { id: "12", name: "Enterprise Datastore search", file: "12-datastore-grounding.sh", expectedChunks: 6, status: "PASS", latencyMs: 290 },
      { id: "15", name: "Context file upload roundtrip", file: "15-upload-context-file.sh", expectedChunks: 1, status: "PASS", latencyMs: 230 },
      { id: "19", name: "Chit-chat skipping filter", file: "19-assist-skipping-mode.sh", expectedChunks: 1, status: "PASS", latencyMs: 110 },
      { id: "24", name: "Native direct A2A streaming", file: "24-a2a-message-stream.sh", expectedChunks: 5, status: "PASS", latencyMs: 320 },
      { id: "26", name: "Routing diagnostic & plannerSteps", file: "26-diagnose-routing.sh", expectedChunks: 1, status: "PASS", latencyMs: 275 },
    ];
  }

  getSimulatedSoakMetrics() {
    return {
      campaign: "24h-reliability-soak-prod",
      targetHost: "discoveryengine.googleapis.com",
      startedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      durationHours: 24,
      totalQueries: 2880,
      criticalSuccessRate: 99.86,
      observationAssertionRate: 98.40,
      routingFidelityRate: 96.2,
      latencies: {
        fast: { p50: 240, p90: 380, p99: 610 },
        heavy: { p50: 1850, p90: 3400, p99: 6800 },
      },
      errorBreakdown: [
        { type: "HTTP 200 with mid-stream error (Gotcha #9)", count: 2, percent: "0.07%" },
        { type: "Chit-chat SKIPPED query (Gotcha #4)", count: 8, percent: "0.28%" },
        { type: "Orchestrator fallback (Gotcha #2)", count: 14, percent: "0.49%" },
      ],
      hourlyDistribution: [
        { hour: "00:00", successRate: 100, avgLatency: 235 },
        { hour: "04:00", successRate: 100, avgLatency: 228 },
        { hour: "08:00", successRate: 99.6, avgLatency: 280 },
        { hour: "12:00", successRate: 99.5, avgLatency: 310 },
        { hour: "16:00", successRate: 99.8, avgLatency: 265 },
        { hour: "20:00", successRate: 100, avgLatency: 240 },
      ]
    };
  }
}

