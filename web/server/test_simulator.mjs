import assert from "node:assert";
import { CatalogService } from "./catalog.mjs";
import { StreamSimulator } from "./simulator.mjs";

console.log("🧪 Testing CatalogService and StreamSimulator in offline mode...");

const catalog = new CatalogService();
await catalog.init();

console.log(`✅ Loaded ${catalog.docs.length} documentation chapters (including Chapter 00)`);
assert(catalog.docs.length >= 17, "Expected at least 17 documentation items");

const docGuide = await catalog.getDocContent("00-guide");
assert(docGuide, "Studio Guide must be found");
assert(docGuide.title.includes("Studio Guide"), "Studio Guide title must match");
console.log(`✅ Studio Guide verified: "${docGuide.title}"`);

const doc00 = await catalog.getDocContent("00");
assert(doc00, "Chapter 00 Glossary must be found");
assert(doc00.title.includes("Glossary"), "Chapter 00 must be Glossary");
console.log(`✅ Chapter 00 Glossary verified: "${doc00.title}"`);

const doc01 = await catalog.getDocContent("01");
assert(doc01, "Chapter 01 must be found");
console.log(`✅ Chapter 01 verified: "${doc01.title}"`);

console.log(`✅ Loaded ${catalog.fixtures.length} output fixtures`);
assert(catalog.fixtures.length >= 17, "Expected at least 17 output fixtures");

const fix01 = await catalog.getFixtureData("01-basic-stream-assist");
assert(fix01 && fix01.data, "01-basic fixture data must be loaded");
assert(Array.isArray(fix01.data), "01-basic must be an array of chunks");
assert(fix01.data.length === 5, `Expected 5 chunks in 01-basic, got ${fix01.data.length}`);
console.log(`✅ Fixture 01-basic verified: ${fix01.data.length} chunks parsed`);

console.log(`✅ Loaded ${catalog.presets.length} curl presets`);
assert(catalog.presets.length >= 25, "Expected at least 25 curl presets");

console.log(`✅ Loaded ${catalog.gotchas.length} caveats & gotchas`);
assert(catalog.gotchas.length >= 30, "Expected at least 30 gotchas parsed");

// Test StreamSimulator
const simulator = new StreamSimulator(catalog);
const checks = simulator.getSimulatedSmokeChecks();
assert(checks.length === 12, "Expected 12 smoke checks");
console.log(`✅ 12 smoke checks verified`);

const metrics = simulator.getSimulatedSoakMetrics();
assert(metrics.campaign && metrics.criticalSuccessRate > 99, "Soak metrics verified");
console.log(`✅ 24h soak metrics verified: ${metrics.criticalSuccessRate}% critical success rate`);

// Test streaming simulation in-memory
const mockChunks = [];
const mockRes = {
  headers: {},
  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
  },
  write(data) {
    if (data.startsWith("event: chunk")) {
      const match = data.match(/data: (.+)\n/);
      if (match) mockChunks.push(JSON.parse(match[1]));
    }
  },
  end() {
    this.ended = true;
  }
};

await simulator.streamFixture("01-basic-stream-assist", mockRes, { delayMs: 0 });
assert(mockChunks.length === 5, `Expected 5 chunks streamed, got ${mockChunks.length}`);
console.log(`✅ Mock SSE streaming simulation verified: 5 chunks yielded with correct wire format`);

console.log("\n🎉 ALL BACKEND SIMULATOR TESTS PASSED!\n");
