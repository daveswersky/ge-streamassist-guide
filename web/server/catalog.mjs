import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

export class CatalogService {
  constructor() {
    this.docs = [];
    this.fixtures = [];
    this.presets = [];
    this.gotchas = [];
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    await Promise.all([
      this.loadDocs(),
      this.loadFixtures(),
      this.loadPresets(),
      this.loadGotchas(),
    ]);
    this.initialized = true;
  }

  async loadDocs() {
    const docsDir = path.join(REPO_ROOT, "docs");
    const entries = await fs.readdir(docsDir);
    const mdFiles = entries.filter((f) => f.endsWith(".md") && f !== "README.md").sort();

    const loadedDocs = [];

    // Synthesize Chapter 00: Studio Guide
    loadedDocs.push({
      id: "00-guide",
      num: "guide",
      slug: "00-studio-guide",
      title: "00. Studio Guide & Functional Areas",
      subtitle: "Overview of local interactive developer studio",
      category: "Studio Help",
      isStudioDoc: true,
      content: `# 00. Gemini StreamAssist Studio Guide

The **Gemini StreamAssist Studio** is an interactive developer workbench and learning environment for building production-grade applications on the Google Gemini Enterprise \`streamAssist\` API.

---

## 7 Core Functional Areas

### 1. Dual-Mode Engine (Offline Simulator & Live Cloud Runner)
- **Offline Simulator Mode**: Completely zero-configuration. Streams pre-recorded wire fixtures from \`outputs/\` with simulated token intervals.
- **Live Cloud Runner Mode**: Directly targets Google Discovery Engine (\`v1alpha\` or \`v1\`) using local Application Default Credentials (\`gcloud auth print-access-token\`) and \`.env\` parameters.

### 2. Interactive Documentation & 34 Gotchas Catalog
- Complete repository documentation reader covering Chapters 00 through 15.
- Inline glossary cards for core API vocabulary (\`agentsSpec\`, \`assistToken\`, \`contentKind\`, \`Thought\`).
- Visual Gotchas badge highlighting 34 field-verified caveats with direct test triggers.

### 3. Visual Wire Stream Inspector & Assembly Debugger
- **Split-Screen Wire View**: Watch raw JSON array delimiter frames (\`[ {chunk} , {chunk} ]\`) arrive on the left, while assembled Markdown renders on the right.
- **Thought Stream Demuxer**: Isolates internal reasoning steps (\`content.thought: true\`) in collapsible accordions.
- **Gotcha #9 Mid-Stream Error Alert**: Detects and highlights mid-stream \`{"error": ...}\` responses with HTTP 200.

### 4. Chat Simulator & Polyglot Code Exporter
- Interactive query builder supporting session binding, agent pinning (\`agentsSpec\`), web grounding, and chit-chat skipping override (\`REQUEST_ASSIST\`).
- Real-time 4-way synchronized code generation: cURL, Python SDK (\`GEClient\`), Node.js (\`ge-streamassist.mjs\`), and raw REST JSON.

### 5. Agent Routing Diagnostic
- Visual inspector of \`answer.diagnosticInfo.plannerSteps\`.
- Real-time verdict banner confirming whether queries delegated to an agent function or fell back to the base orchestrator (Gotcha #2).

### 6. Sessions & Files Workspace
- Multi-turn timeline tracking user turns, \`queryId\`, and \`assistToken\`.
- Session file explorer demonstrating \`:listSessionFileMetadata\` (Gotcha #17).
- Interactive guided runner for Recipe A (Document Review Copilot).

### 7. Deep Research Two-Step Flow
- Visualizes Step 1 research plan generation & question approval (\`outputs/09-deep-research-plan.json\`).
- Visualizes Step 2 multi-turn execution monitoring filtered by \`contentKind\` (\`RESEARCH_QUESTION\`, \`RESEARCH_REPORT\`, and audio summary).

### 8. Test Suites (Smoke & Soak Dashboard)
- Interactive web harness for the 12 fast smoke checks in \`scripts/run-all.sh\`.
- 24-hour Cloud Run soak benchmark viewer tracking P50/P90 latencies and routing fidelity.`
    });

    for (const filename of mdFiles) {
      const match = filename.match(/^(\d+)-(.+)\.md$/);
      if (!match) continue;
      const [_, num, name] = match;
      const filePath = path.join(docsDir, filename);
      const raw = await fs.readFile(filePath, "utf-8");
      const titleLine = raw.split("\n").find((l) => l.startsWith("# "));
      const cleanTitle = titleLine ? titleLine.replace(/^#\s*/, "") : `${num}. ${name}`;

      loadedDocs.push({
        id: num,
        num,
        slug: filename.replace(/\.md$/, ""),
        filename,
        title: cleanTitle,
        subtitle: getSubtitle(num),
        category: getDocCategory(num),
        content: raw,
      });
    }

    this.docs = loadedDocs;
  }

  async loadFixtures() {
    const outputsDir = path.join(REPO_ROOT, "outputs");
    const entries = await fs.readdir(outputsDir);
    const files = entries.filter((f) => (f.endsWith(".json") || f.endsWith(".txt")) && f !== "README.md").sort();

    const fixtures = [];
    for (const f of files) {
      const filePath = path.join(outputsDir, f);
      const stat = await fs.stat(filePath);
      const isJson = f.endsWith(".json");
      fixtures.push({
        id: f.replace(/\.(json|txt)$/, ""),
        filename: f,
        isJson,
        sizeBytes: stat.size,
        description: getFixtureDescription(f),
      });
    }
    this.fixtures = fixtures;
  }

  async loadPresets() {
    const curlDir = path.join(REPO_ROOT, "snippets/curl");
    const entries = await fs.readdir(curlDir);
    const shFiles = entries.filter((f) => f.endsWith(".sh") && f !== "common.sh").sort();

    const presets = [];
    for (const sh of shFiles) {
      const match = sh.match(/^(\d+)-(.+)\.sh$/);
      if (!match) continue;
      const [_, num, name] = match;
      const filePath = path.join(curlDir, sh);
      const content = await fs.readFile(filePath, "utf-8");

      presets.push({
        id: num,
        num,
        filename: sh,
        name: formatPresetName(name),
        category: getPresetCategory(num),
        associatedFixture: getAssociatedFixture(num),
        curlScript: content,
      });
    }
    this.presets = presets;
  }

  async loadGotchas() {
    const gotchasDoc = path.join(REPO_ROOT, "docs/12-caveats-gotchas.md");
    try {
      const raw = await fs.readFile(gotchasDoc, "utf-8");
      const lines = raw.split("\n");
      const gotchas = [];
      let current = null;

      for (const line of lines) {
        const match = line.match(/^(\d+)\.\s*([✓ⓘ])\s*\*\*(.+?)\*\*\.?\s*(.*)$/);
        if (match) {
          if (current) gotchas.push(current);
          const [_, num, mark, title, text] = match;
          current = {
            id: parseInt(num, 10),
            verified: mark === "✓",
            title: title.trim(),
            summary: text.trim(),
            fullText: text.trim(),
          };
        } else if (current && line.trim().length > 0 && !line.startsWith("## ") && !line.startsWith("# ")) {
          current.fullText += " " + line.trim();
        }
      }
      if (current) gotchas.push(current);
      this.gotchas = gotchas;
    } catch {
      this.gotchas = [];
    }
  }

  async getDocContent(id) {
    await this.init();
    if (id === "guide" || id === "00-guide" || id === "00-studio-guide") {
      return this.docs.find((d) => d.isStudioDoc);
    }
    // Match exact non-studio doc by id, slug, or num
    const doc = this.docs.find((d) => !d.isStudioDoc && (d.id === id || d.slug === id || d.num === id));
    if (doc) return doc;

    // Fallback match with numeric equivalence (e.g. "0" matching "00")
    const numericId = parseInt(id, 10);
    if (!isNaN(numericId)) {
      return this.docs.find((d) => !d.isStudioDoc && parseInt(d.num, 10) === numericId);
    }
    return null;
  }

  async getFixtureData(id) {
    await this.init();
    const fix = this.fixtures.find((f) => f.id === id || f.filename === id);
    if (!fix) return null;
    const filePath = path.join(REPO_ROOT, "outputs", fix.filename);
    const raw = await fs.readFile(filePath, "utf-8");
    if (fix.isJson) {
      const parsed = lenientParseJsonArray(raw);
      if (parsed) {
        return { ...fix, data: parsed };
      }
      try {
        return { ...fix, data: JSON.parse(raw) };
      } catch {
        return { ...fix, data: raw };
      }
    }
    return { ...fix, data: raw };
  }

  async getPresetData(id) {
    await this.init();
    return this.presets.find((p) => p.id === id || p.num === id);
  }
}

function getSubtitle(num) {
  const map = {
    "00": "Terminology, object definitions & concepts",
    "01": "Dual surfaces, orchestrator architecture & support matrix",
    "02": "ADC, Service Accounts & Corporate TLS bypass",
    "03": "v1alpha endpoint path & full payload schema",
    "04": "Conversation history, multi-turn state & memory gotchas",
    "05": "ADK Agent Engine vs A2A vs Managed Agents",
    "06": "Enterprise search, web grounding & Vertex media tools",
    "07": "Two-step planning & execution protocol",
    "08": "PDF context ingestion & direct inline bytes",
    "09": "Chunked JSON array protocol & stream assembly",
    "10": "Agent Registry API & fleet configuration",
    "11": "Native direct line message:stream bypass",
    "12": "34 verified gotchas from production field trials",
    "13": "Full OpenAPI-style reference of endpoints",
    "14": "End-to-end patterns: Doc Review, Research, Multi-Agent",
    "15": "24-hour Cloud Run soak harness & SLO monitoring",
  };
  return map[num] || "Reference documentation";
}

function getDocCategory(num) {
  const n = parseInt(num, 10);
  if (n <= 1) return "Core Concepts";
  if (n <= 4) return "API & Auth";
  if (n <= 8) return "Agents & Tools";
  if (n <= 11) return "Streaming & Protocols";
  return "Production & Operations";
}

function getFixtureDescription(filename) {
  const map = {
    "01-basic-stream-assist.json": "Basic streamAssist response chunks (6 chunks)",
    "04-multi-turn-session.json": "Multi-turn session response recalling earlier turn facts",
    "06-list-agents.txt": "Discovered agent IDs and display names in app",
    "08-invoke-adk-agent.excerpt.json": "Agent Engine ADK agent invocation with plannerSteps",
    "08-invoke-a2a-agent.excerpt.json": "A2A agent invocation through orchestrator",
    "09-deep-research-plan.json": "Deep Research Step 1 plan generation with questions",
    "10-deep-research-execute.excerpt.json": "Deep Research Step 2 execution stream chunks",
    "11-web-grounding.excerpt.json": "Web-grounded query with reference citations",
    "13-image-generation.json": "Generated image file metadata in content.file",
    "14-video-generation.json": "Generated video file metadata in content.file",
    "15-add-context-file.json": "Context file upload response with resource name",
    "16-query-with-files.json": "Response to query grounded on uploaded context file",
    "18-non-streaming-assist.json": "Synchronous non-streaming assist response",
    "19-skipped-chitchat.json": "Chit-chat query skipped by classifier (Gotcha #4)",
    "20-language-user-metadata.json": "Response with languageCode and timeZone overrides",
    "24-a2a-message-stream.excerpt.json": "Native direct A2A streaming chunks",
    "26-diagnose-routing.txt": "Full diagnostic dump of plannerSteps and routing",
    "27-list-session-file-metadata.json": "Metadata list of uploaded files in session",
  };
  return map[filename] || filename;
}

function formatPresetName(name) {
  return name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getPresetCategory(num) {
  const n = parseInt(num, 10);
  if (n <= 2) return "Basics";
  if (n <= 5) return "Sessions";
  if (n <= 8) return "Agents";
  if (n <= 10) return "Deep Research";
  if (n <= 14) return "Tools & Media";
  if (n <= 17) return "Context Files";
  if (n <= 21) return "Advanced Spec";
  if (n <= 24) return "A2A Direct";
  return "Diagnostics";
}

function getAssociatedFixture(num) {
  const map = {
    "01": "01-basic-stream-assist",
    "04": "04-multi-turn-session",
    "06": "06-list-agents",
    "08": "08-invoke-adk-agent.excerpt",
    "09": "09-deep-research-plan",
    "10": "10-deep-research-execute.excerpt",
    "11": "11-web-grounding.excerpt",
    "13": "13-image-generation",
    "14": "14-video-generation",
    "15": "15-add-context-file",
    "16": "16-query-with-files",
    "18": "18-non-streaming-assist",
    "19": "19-skipped-chitchat",
    "20": "20-language-user-metadata",
    "24": "24-a2a-message-stream.excerpt",
    "26": "26-diagnose-routing",
    "27": "27-list-session-file-metadata",
  };
}

export function lenientParseJsonArray(raw) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    let lastClosing = raw.lastIndexOf("}");
    while (lastClosing > 0) {
      const candidate = raw.slice(0, lastClosing + 1) + "\n]";
      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {}
      lastClosing = raw.lastIndexOf("}", lastClosing - 1);
    }
    return null;
  }
}

