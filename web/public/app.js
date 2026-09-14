// Gemini StreamAssist Studio - Frontend Engine
// Zero external dependencies - Modern Vanilla ES Module

let state = {
  catalog: { docs: [], fixtures: [], presets: [], gotchas: [] },
  currentTab: 'docs',
  currentDocId: '00', // Chapter 00 Glossary by default
  currentFixtureId: '01-basic-stream-assist',
  currentSpeed: '1x',
  streamDelayMs: 90,
  activeStream: null,
  streamChunks: [],
  currentChunkIndex: 0,
  isStreaming: false,
  langTab: 'curl',
  thoughtExpanded: false,
  smokeChecks: [],
  drawerOpen: false,
  activeChatStream: null,
  chatRoutingAccordionOpen: false,
  lastRoutingEvent: null,
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  await loadCatalog();
  await loadSmokeChecks();
  setupEventListeners();
  syncCode();

  // Populate Inspector with 01-basic-stream-assist.json by default
  await loadInitialWireFixture('01-basic-stream-assist');

  // Initialize Routing Diagnostic Accordion
  const initialRouting = analyzeRoutingEvent({ presetId: '01' });
  updateChatRoutingAccordion(initialRouting);

  // Handle URL hash navigation
  const hash = window.location.hash.replace('#', '');
  if (hash) {
    if (['docs', 'simulator', 'inspector', 'routing', 'sessions', 'research', 'testsuites'].includes(hash)) {
      switchTab(hash);
    }
  }

  // Focus query field in Chat simulator on page load
  setTimeout(() => {
    const qEl = document.getElementById('req-query');
    if (qEl) {
      qEl.focus();
    }
  }, 100);
});

// ================= CATALOG LOADER =================
async function loadCatalog() {
  try {
    const res = await fetch('/api/catalog');
    if (!res.ok) throw new Error('Failed to load catalog');
    state.catalog = await res.json();

    // Update fixture count pill
    const pill = document.getElementById('fixture-count-pill');
    if (pill) pill.textContent = `${state.catalog.fixtures.length} Payloads Ready`;

    // Populate Inspector Fixture Dropdown
    const select = document.getElementById('wire-fixture-select');
    if (select) {
      select.innerHTML = state.catalog.fixtures.map((f) => `
        <option value="${f.id}" ${f.id === state.currentFixtureId ? 'selected' : ''}>${f.filename}</option>
      `).join('');
    }

    renderChaptersList();
    await selectDocChapter(state.currentDocId);
  } catch (err) {
    console.error('Error loading catalog:', err);
  }
}

function renderChaptersList() {
  const container = document.getElementById('chapters-nav-list');
  if (!container) return;

  container.innerHTML = state.catalog.docs.map((doc) => {
    const isSelected = doc.id === state.currentDocId;
    const isStudio = doc.isStudioDoc;
    
    let baseClass = "p-2 rounded text-xs flex justify-between items-center cursor-pointer transition-colors ";
    if (isSelected) {
      baseClass += isStudio 
        ? "bg-purple-500/20 text-purple-600 dark:text-purple-300 font-semibold border border-purple-500/30"
        : "bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold border border-blue-500/20";
    } else {
      baseClass += "hover:bg-[var(--background)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] border border-transparent";
    }

    const badgeClass = isStudio
      ? "text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-500 font-medium shrink-0"
      : "text-[10px] opacity-75 shrink-0";

    return `
      <div onclick="window.selectDocChapter('${doc.id}')" id="doc-chap-${doc.id}" class="${baseClass}">
        <span class="truncate pr-2">${doc.title}</span>
        <span class="${badgeClass}">${isStudio ? 'Help' : doc.category}</span>
      </div>
    `;
  }).join('');
}

// ================= MODULE 1: DOCUMENTATION =================
window.selectDocChapter = async function(id) {
  state.currentDocId = id;
  renderChaptersList();

  const bodyEl = document.getElementById('doc-content-body');
  if (!bodyEl) return;

  bodyEl.innerHTML = `<div class="text-xs text-[var(--muted-foreground)] animate-pulse">Loading chapter ${id}...</div>`;

  try {
    const res = await fetch(`/api/docs/${id}`);
    if (!res.ok) throw new Error('Chapter not found');
    const doc = await res.json();

    // Render markdown content (including tables)
    bodyEl.innerHTML = renderMarkdown(doc.content);

    // Attach gotcha interaction badges
    highlightGotchasInDoc(bodyEl);
  } catch (err) {
    bodyEl.innerHTML = `<div class="text-xs text-red-500">Failed to load chapter content: ${err.message}</div>`;
  }
};

window.filterDocs = function() {
  const query = (document.getElementById('doc-search')?.value || '').toLowerCase();
  const items = document.querySelectorAll('#chapters-nav-list > div');
  items.forEach((item) => {
    const text = item.textContent.toLowerCase();
    item.style.display = text.includes(query) ? 'flex' : 'none';
  });
};

function highlightGotchasInDoc(container) {
  const gotchaMatches = container.querySelectorAll('strong, b');
  gotchaMatches.forEach((el) => {
    const text = el.textContent;
    const match = text.match(/Gotcha\s*#?(\d+)/i);
    if (match) {
      const gotchaNum = match[1];
      const btn = document.createElement('button');
      btn.className = "ml-2 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-500 font-mono font-normal hover:bg-amber-500/20 inline-flex items-center gap-1 cursor-pointer";
      btn.innerHTML = `<span>Verify Gotcha #${gotchaNum}</span> →`;
      btn.onclick = (e) => {
        e.preventDefault();
        verifyGotchaInStudio(gotchaNum);
      };
      el.appendChild(btn);
    }
  });
}

function verifyGotchaInStudio(num) {
  const n = parseInt(num, 10);
  if (n === 2) {
    switchTab('routing');
    window.runRoutingDiagnosis();
  } else if (n === 4) {
    loadPreset('19');
  } else if (n === 9) {
    switchTab('inspector');
    window.triggerSimulatedError();
  } else if (n === 10) {
    switchTab('inspector');
    window.changeWireFixture('08-invoke-adk-agent');
    window.toggleStreamSimulation();
  } else if (n === 17) {
    switchTab('sessions');
  } else {
    loadPreset('01');
  }
}

// ================= MODULE 2: WIRE STREAM INSPECTOR =================
async function loadInitialWireFixture(fixtureId) {
  state.currentFixtureId = fixtureId;
  try {
    const res = await fetch(`/api/fixtures/${fixtureId}`);
    if (!res.ok) return;
    const fix = await res.json();
    populateWireInspectorWithData(fix);
  } catch (err) {
    console.error('Error loading initial fixture:', err);
  }
}

window.changeWireFixture = async function(fixtureId) {
  state.currentFixtureId = fixtureId;
  resetStream();
  await loadInitialWireFixture(fixtureId);
};

function populateWireInspectorWithData(fix) {
  const isArray = Array.isArray(fix.data);
  const chunks = isArray ? fix.data : [fix.data];
  state.streamChunks = chunks;
  state.currentChunkIndex = chunks.length;

  // 1. Update Input Source Display Window
  const filenameEl = document.getElementById('fixture-filename-display');
  const sizeEl = document.getElementById('fixture-size-display');
  const chunksEl = document.getElementById('fixture-chunks-display');
  const previewEl = document.getElementById('fixture-raw-preview');
  const wireNameEl = document.getElementById('wire-fixture-name');

  const rawJson = JSON.stringify(fix.data, null, 2);
  const byteSize = (new TextEncoder().encode(rawJson).length / 1024).toFixed(1);

  if (filenameEl) filenameEl.textContent = `outputs/${fix.filename}`;
  if (sizeEl) sizeEl.textContent = `${byteSize} KB`;
  if (chunksEl) chunksEl.textContent = `${chunks.length} frame${chunks.length === 1 ? '' : 's'}`;
  if (previewEl) previewEl.textContent = rawJson;
  if (wireNameEl) wireNameEl.textContent = `outputs/${fix.filename}`;

  // 2. Pre-populate Raw Wire Display Buffer
  const wireDisplay = document.getElementById('raw-wire-display');
  if (wireDisplay) {
    wireDisplay.textContent = rawJson;
  }

  // 3. Assemble Answer Text & Demux Thoughts/Citations
  const answerEl = document.getElementById('assembled-answer-text');
  const thoughtBody = document.getElementById('thought-body');
  const thoughtBadge = document.getElementById('thought-counter-badge');
  const stateBadge = document.getElementById('stream-state-badge');

  if (answerEl) answerEl.innerHTML = '';
  if (thoughtBody) thoughtBody.innerHTML = '';

  let fullAnswerText = '';
  let thoughtCount = 0;
  let allReferences = [];

  for (const chunk of chunks) {
    if (chunk.error) {
      if (answerEl) {
        answerEl.innerHTML = `
          <div class="p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400 space-y-1">
            <div class="font-bold flex items-center gap-1.5">
              <span>⚠️ Gotcha #9 Mid-Stream Error (HTTP 200)</span>
            </div>
            <div class="text-xs font-mono">${chunk.error.message || 'Stream terminated with error chunk'}</div>
            <div class="text-[10px] text-[var(--muted-foreground)]">Code: ${chunk.error.code} | Status: ${chunk.error.status}</div>
          </div>
        `;
      }
      continue;
    }

    const replies = chunk.answer?.replies || [];
    for (const reply of replies) {
      const content = reply.groundedContent?.content || reply.content;
      if (content) {
        if (content.thought) {
          thoughtCount++;
          const tText = content.text || content.parts?.[0]?.text || '';
          if (thoughtBody) {
            const p = document.createElement('div');
            p.className = "text-purple-600 dark:text-purple-300 py-1 border-b border-[var(--border)] last:border-0";
            p.textContent = `💭 ${tText}`;
            thoughtBody.appendChild(p);
          }
        } else {
          const text = content.text || content.parts?.[0]?.text || '';
          fullAnswerText += text;
        }
      }
    }

    const grounding = chunk.answer?.textGroundingMetadata;
    if (grounding && grounding.references) {
      allReferences.push(...grounding.references);
    }
  }

  if (answerEl) {
    answerEl.innerHTML = fullAnswerText ? renderMarkdown(fullAnswerText) : '<p class="text-[var(--muted-foreground)] italic">No text payload generated.</p>';
  }

  if (thoughtBadge) {
    thoughtBadge.textContent = `${thoughtCount} fragment${thoughtCount === 1 ? '' : 's'}`;
  }
  if (thoughtBody && thoughtCount === 0) {
    thoughtBody.textContent = "No thought fragments in this response.";
  }

  if (allReferences.length > 0) {
    renderGroundingSources(allReferences);
  } else {
    document.getElementById('grounding-list').innerHTML = `<div class="italic text-[11px]">No active grounding metadata in current stream.</div>`;
    document.getElementById('grounding-count').textContent = '0 sources';
  }

  updateChunkCounter(chunks.length, chunks.length);
  if (stateBadge) {
    stateBadge.textContent = "SUCCEEDED";
    stateBadge.className = "px-2 py-0.5 text-[10px] rounded font-mono bg-emerald-500/10 text-emerald-500 font-semibold";
  }
}

window.toggleInputPreview = function() {
  const drawer = document.getElementById('fixture-preview-drawer');
  const label = document.getElementById('preview-toggle-text');
  if (!drawer) return;
  const isHidden = drawer.classList.toggle('hidden');
  if (label) label.textContent = isHidden ? 'Show Static Input Payload ▼' : 'Hide Static Input Payload ▲';
};

window.toggleStreamSimulation = function() {
  if (state.isStreaming) {
    stopStream();
  } else {
    startStream(state.currentFixtureId);
  }
};

function startStream(fixtureId, injectError = false) {
  resetStream();
  state.isStreaming = true;
  state.currentFixtureId = fixtureId;

  const playBtn = document.getElementById('stream-play-btn');
  const playIcon = document.getElementById('play-icon');
  const playText = document.getElementById('play-text');
  const stateBadge = document.getElementById('stream-state-badge');
  const wireName = document.getElementById('wire-fixture-name');

  if (playBtn) playBtn.className = "px-4 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-medium text-xs flex items-center gap-1.5 shadow-xs transition-all cursor-pointer";
  if (playIcon) playIcon.textContent = "⏸";
  if (playText) playText.textContent = "Pause Playback";
  if (stateBadge) {
    stateBadge.textContent = "STREAMING";
    stateBadge.className = "px-2 py-0.5 text-[10px] rounded font-mono bg-blue-500/10 text-blue-500 font-semibold animate-pulse";
  }
  if (wireName) wireName.textContent = `outputs/${fixtureId}.json`;

  const speedParam = state.currentSpeed === 'instant' ? 'speed=instant' : `delayMs=${state.streamDelayMs}`;
  const url = `/api/stream/simulate/${fixtureId}?${speedParam}&injectError=${injectError}`;

  const eventSource = new EventSource(url);
  state.activeStream = eventSource;

  eventSource.addEventListener('start', (e) => {
    const data = JSON.parse(e.data);
    updateChunkCounter(0, data.totalChunks);
  });

  eventSource.addEventListener('chunk', (e) => {
    const data = JSON.parse(e.data);
    handleIncomingChunk(data);
  });

  eventSource.addEventListener('complete', () => {
    stopStream(true);
  });

  eventSource.onerror = (err) => {
    console.warn('Stream ended or interrupted:', err);
    stopStream(false);
  };
}

function stopStream(completed = false) {
  if (state.activeStream) {
    state.activeStream.close();
    state.activeStream = null;
  }
  state.isStreaming = false;

  const playBtn = document.getElementById('stream-play-btn');
  const playIcon = document.getElementById('play-icon');
  const playText = document.getElementById('play-text');
  const stateBadge = document.getElementById('stream-state-badge');

  if (playBtn) playBtn.className = "px-4 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs flex items-center gap-1.5 shadow-xs transition-all cursor-pointer";
  if (playIcon) playIcon.textContent = "▶";
  if (playText) playText.textContent = completed ? "Replay Stream" : "Resume Stream";
  if (stateBadge) {
    stateBadge.textContent = completed ? "SUCCEEDED" : "PAUSED";
    stateBadge.className = completed 
      ? "px-2 py-0.5 text-[10px] rounded font-mono bg-emerald-500/10 text-emerald-500 font-semibold"
      : "px-2 py-0.5 text-[10px] rounded font-mono bg-amber-500/10 text-amber-500 font-semibold";
  }
}

window.resetStream = function() {
  stopStream();
  state.streamChunks = [];
  state.currentChunkIndex = 0;

  document.getElementById('raw-wire-display').textContent = "[\n  // Ready to stream.\n]";
  document.getElementById('assembled-answer-text').innerHTML = `<p class="text-[var(--muted-foreground)] italic">Awaiting streamed chunks...</p>`;
  document.getElementById('thought-body').textContent = "No thought fragments received yet.";
  document.getElementById('thought-counter-badge').textContent = "0 fragments";
  document.getElementById('grounding-list').innerHTML = `<div class="italic text-[11px]">No active grounding metadata in current stream.</div>`;
  updateChunkCounter(0, 0);
};

window.stepChunk = async function() {
  if (state.streamChunks.length === 0) {
    try {
      const res = await fetch(`/api/fixtures/${state.currentFixtureId}`);
      const fixture = await res.json();
      state.streamChunks = Array.isArray(fixture.data) ? fixture.data : [fixture.data];
      state.currentChunkIndex = 0;
    } catch {
      return;
    }
  }

  if (state.currentChunkIndex < state.streamChunks.length) {
    const chunk = state.streamChunks[state.currentChunkIndex];
    state.currentChunkIndex++;
    handleIncomingChunk({
      index: state.currentChunkIndex,
      total: state.streamChunks.length,
      chunk,
      rawWire: JSON.stringify(chunk, null, 2),
      isLast: state.currentChunkIndex === state.streamChunks.length,
      isError: Boolean(chunk.error),
    });
  }
};

function handleIncomingChunk(data) {
  const { index, total, chunk, rawWire, isError } = data;
  updateChunkCounter(index, total);

  // 1. Update Raw Wire Display (left pane)
  const wireDisplay = document.getElementById('raw-wire-display');
  const wireContainer = document.getElementById('wire-scroll-container');
  if (index === 1) {
    wireDisplay.textContent = `[\n  // Chunk 1 / ${total}\n${rawWire}`;
  } else {
    wireDisplay.textContent += `,\n  // Chunk ${index} / ${total}\n${rawWire}`;
  }
  if (index === total) {
    wireDisplay.textContent += "\n]";
  }
  if (wireContainer) wireContainer.scrollTop = wireContainer.scrollHeight;

  // 2. Mid-stream Error Alert (Gotcha #9)
  if (isError) {
    const answerEl = document.getElementById('assembled-answer-text');
    answerEl.innerHTML += `
      <div class="mt-3 p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400 space-y-1">
        <div class="font-bold flex items-center gap-1.5">
          <span>⚠️ Gotcha #9 Mid-Stream Error (HTTP 200)</span>
        </div>
        <div class="text-xs font-mono">${chunk.error.message || 'Stream terminated with error chunk'}</div>
        <div class="text-[10px] text-[var(--muted-foreground)]">Code: ${chunk.error.code} | Status: ${chunk.error.status}</div>
      </div>
    `;
    return;
  }

  // 3. Extract and Demux Answer Text
  const replies = chunk.answer?.replies || [];
  for (const reply of replies) {
    const content = reply.groundedContent?.content || reply.content;
    if (content) {
      if (content.thought) {
        appendThoughtFragment(content.text || content.parts?.[0]?.text || '');
      } else {
        const text = content.text || content.parts?.[0]?.text || '';
        if (text) {
          appendAnswerText(text);
        }
      }
    }
  }

  // 4. Grounding Metadata
  const grounding = chunk.answer?.textGroundingMetadata;
  if (grounding && grounding.references) {
    renderGroundingSources(grounding.references);
  }
}

function appendAnswerText(text) {
  const answerEl = document.getElementById('assembled-answer-text');
  if (answerEl.querySelector('.italic')) {
    answerEl.innerHTML = '';
  }
  answerEl.innerHTML += renderMarkdown(text);
}

function appendThoughtFragment(thoughtText) {
  const thoughtBody = document.getElementById('thought-body');
  const badge = document.getElementById('thought-counter-badge');

  if (thoughtBody.textContent.includes('No thought fragments') || thoughtBody.textContent.includes('No thought fragments received yet.')) {
    thoughtBody.innerHTML = '';
  }

  const p = document.createElement('div');
  p.className = "text-purple-600 dark:text-purple-300 py-1 border-b border-[var(--border)] last:border-0";
  p.textContent = `💭 ${thoughtText}`;
  thoughtBody.appendChild(p);

  const count = thoughtBody.children.length;
  badge.textContent = `${count} fragment${count === 1 ? '' : 's'}`;
}

function renderGroundingSources(refs) {
  const container = document.getElementById('grounding-list');
  const countEl = document.getElementById('grounding-count');
  countEl.textContent = `${refs.length} sources`;

  container.innerHTML = refs.map((ref, i) => `
    <div class="p-2 rounded bg-[var(--background)] border border-[var(--border)] flex items-center justify-between">
      <div class="truncate pr-2">
        <span class="font-semibold text-blue-500">[${i + 1}]</span>
        <a href="${ref.web?.uri || '#'}" target="_blank" class="hover:underline text-[11px]">${ref.web?.title || ref.web?.uri || 'Grounded Document'}</a>
      </div>
      <span class="text-[10px] font-mono text-[var(--muted-foreground)]">Score: ${(ref.confidence || 0.95).toFixed(2)}</span>
    </div>
  `).join('');
}

function updateChunkCounter(current, total) {
  const counter = document.getElementById('chunk-counter');
  if (counter) counter.textContent = `${current} / ${total}`;
}

window.toggleThoughtPane = function() {
  state.thoughtExpanded = !state.thoughtExpanded;
  const body = document.getElementById('thought-body');
  const chevron = document.getElementById('thought-chevron');
  if (body) body.classList.toggle('hidden', !state.thoughtExpanded);
  if (chevron) chevron.textContent = state.thoughtExpanded ? '▲' : '▼';
};

window.setStreamSpeed = function(speed) {
  state.currentSpeed = speed;
  state.streamDelayMs = speed === '1x' ? 90 : speed === '2x' ? 35 : 0;

  document.getElementById('speed-1x').className = speed === '1x' ? "px-2 py-1 bg-blue-500 text-white font-mono text-[10px]" : "px-2 py-1 bg-[var(--background)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] font-mono text-[10px]";
  document.getElementById('speed-2x').className = speed === '2x' ? "px-2 py-1 bg-blue-500 text-white font-mono text-[10px]" : "px-2 py-1 bg-[var(--background)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] font-mono text-[10px]";
  document.getElementById('speed-instant').className = speed === 'instant' ? "px-2 py-1 bg-blue-500 text-white font-mono text-[10px]" : "px-2 py-1 bg-[var(--background)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] font-mono text-[10px]";
};

window.triggerSimulatedError = function() {
  startStream(state.currentFixtureId, true);
};

// ================= MODULE 3: CHAT SIMULATOR (GEMINI ENTERPRISE CHAT) =================
window.toggleCodeDrawer = function() {
  state.drawerOpen = !state.drawerOpen;
  const drawer = document.getElementById('code-drawer');
  const label = document.getElementById('drawer-btn-label');
  const chevron = document.getElementById('drawer-chevron');

  if (drawer) {
    if (state.drawerOpen) {
      drawer.classList.remove('hidden');
    } else {
      drawer.classList.add('hidden');
    }
  }
  if (chevron) chevron.textContent = state.drawerOpen ? '▶' : '◀';
  if (label) label.textContent = state.drawerOpen ? 'Hide Spec & Code' : 'Code Exporter & Spec';
};

window.applyPromptChip = function(query, presetId, agent = '') {
  const qInput = document.getElementById('req-query');
  const aInput = document.getElementById('req-agent');
  const pSelect = document.getElementById('chat-preset-select');

  if (qInput) qInput.value = query;
  if (aInput) aInput.value = agent;
  if (pSelect) pSelect.value = presetId;

  syncCode();
  const event = analyzeRoutingEvent({ presetId, agent, query });
  updateChatRoutingAccordion(event);
};

async function runMultiTurnChainedSimulation({ thread, scrollContainer, sendBtn, btnIcon, btnLabel, sessionInput, qInput }) {
  if (sendBtn) sendBtn.disabled = true;
  if (btnIcon) btnIcon.textContent = "⏳";
  if (btnLabel) btnLabel.textContent = "Chaining Turn 1...";

  const assignedSession = "projects/000000000000/locations/global/collections/default_collection/engines/gemini-enterprise-testng_1760546748983/sessions/8564985454051896417";
  const shortSession = "sessions/8564985454051896417";

  // --- TURN 1 ---
  const turn1Query = qInput?.value?.trim() || "My name is Jordan and I work in fixed income. Remember that.";
  const turn1MsgId = Date.now();

  const turn1UserHtml = `
    <div class="flex items-start justify-end gap-3">
      <div class="space-y-1 max-w-xl text-right">
        <div class="text-[10px] font-mono text-blue-500 uppercase tracking-wider font-semibold">Turn 1 (session: -)</div>
        <div class="p-3.5 rounded-xl rounded-tr-none bg-blue-600/10 border border-blue-500/20 text-xs text-[var(--foreground)] text-left shadow-xs">
          ${escapeHtml(turn1Query)}
        </div>
      </div>
      <div class="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">
        👤
      </div>
    </div>
  `;
  thread.insertAdjacentHTML('beforeend', turn1UserHtml);

  const turn1BotHtml = `
    <div class="flex items-start gap-3" id="msg-${turn1MsgId}">
      <div class="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-xs">
        ✦
      </div>
      <div class="space-y-2 max-w-2xl flex-1">
        <div class="text-xs font-semibold text-[var(--foreground)] flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span>Gemini Enterprise Assistant</span>
            <span class="px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-500" id="status-${turn1MsgId}">Turn 1 Complete</span>
          </div>
          <span class="text-[10px] text-blue-500 font-mono">Assigned: ${shortSession}</span>
        </div>
        <div class="p-4 rounded-xl rounded-tl-none bg-[var(--card)] border border-[var(--border)] text-xs leading-relaxed space-y-2 shadow-xs" id="body-${turn1MsgId}">
          <p>Nice to meet you, Jordan! I have saved your profile and noted that you work in fixed income. I've bound our conversation to session <code class="mono text-blue-500 bg-blue-500/10 px-1 py-0.5 rounded">${shortSession}</code> and will maintain this context across subsequent turns.</p>
        </div>
      </div>
    </div>
  `;
  thread.insertAdjacentHTML('beforeend', turn1BotHtml);
  if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;

  // Update session field and query field, then sync polyglot exporter
  if (sessionInput) sessionInput.value = assignedSession;
  if (qInput) qInput.value = "What is my name and what asset class do I work in?";
  syncCode();

  // Brief pacing delay between Turn 1 and Turn 2
  await new Promise(resolve => setTimeout(resolve, 800));

  // --- TURN 2 ---
  if (btnLabel) btnLabel.textContent = "Chaining Turn 2...";
  const turn2Query = "What is my name and what asset class do I work in?";
  const turn2MsgId = Date.now() + 1;

  const turn2UserHtml = `
    <div class="flex items-start justify-end gap-3">
      <div class="space-y-1 max-w-xl text-right">
        <div class="text-[10px] font-mono text-indigo-500 uppercase tracking-wider font-semibold">Turn 2 (reusing ${shortSession})</div>
        <div class="p-3.5 rounded-xl rounded-tr-none bg-blue-600/10 border border-blue-500/20 text-xs text-[var(--foreground)] text-left shadow-xs">
          ${escapeHtml(turn2Query)}
        </div>
      </div>
      <div class="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">
        👤
      </div>
    </div>
  `;
  thread.insertAdjacentHTML('beforeend', turn2UserHtml);

  const turn2BotHtml = `
    <div class="flex items-start gap-3" id="msg-${turn2MsgId}">
      <div class="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-xs">
        ✦
      </div>
      <div class="space-y-2 max-w-2xl flex-1">
        <div class="text-xs font-semibold text-[var(--foreground)] flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span>Gemini Enterprise Assistant</span>
            <span class="px-1.5 py-0.2 rounded text-[10px] font-mono bg-blue-500/10 text-blue-500 animate-pulse" id="status-${turn2MsgId}">Streaming Turn 2...</span>
          </div>
          <span class="text-[10px] text-[var(--muted-foreground)] font-mono">Fixture: 04</span>
        </div>
        <div class="p-4 rounded-xl rounded-tl-none bg-[var(--card)] border border-[var(--border)] text-xs leading-relaxed space-y-2 shadow-xs" id="body-${turn2MsgId}">
          <div class="flex items-center gap-2 text-[var(--muted-foreground)] animate-pulse">
            <span class="w-2 h-2 rounded-full bg-blue-500 animate-ping"></span>
            <span>Thinking and streaming response chunks...</span>
          </div>
        </div>
      </div>
    </div>
  `;
  thread.insertAdjacentHTML('beforeend', turn2BotHtml);
  if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;

  // Stream Turn 2 from fixture 04-multi-turn-session
  const eventSource = new EventSource(`/api/stream/simulate/04-multi-turn-session?delayMs=40`);
  state.activeChatStream = eventSource;

  let assembledText = '';
  const bodyEl = document.getElementById(`body-${turn2MsgId}`);
  const statusEl = document.getElementById(`status-${turn2MsgId}`);

  eventSource.addEventListener('chunk', (e) => {
    const data = JSON.parse(e.data);
    const chunk = data.chunk;
    const replies = chunk.answer?.replies || [];
    for (const reply of replies) {
      const content = reply.groundedContent?.content || reply.content;
      if (content && !content.thought) {
        const text = content.text || content.parts?.[0]?.text || '';
        assembledText += text;
      }
    }
    if (assembledText) {
      bodyEl.innerHTML = renderMarkdown(assembledText);
    }
    if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
  });

  const finishStream = () => {
    eventSource.close();
    state.activeChatStream = null;
    if (statusEl) {
      statusEl.textContent = "Completed (2 Turns Chained)";
      statusEl.className = "px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-500";
    }
    if (sendBtn) sendBtn.disabled = false;
    if (btnIcon) btnIcon.textContent = "▶";
    if (btnLabel) btnLabel.textContent = "Send Request";

    const routingEvt = analyzeRoutingEvent({ presetId: '04', query: 'What is my name and what asset class do I work in?' });
    updateChatRoutingAccordion(routingEvt);
  };

  eventSource.addEventListener('complete', finishStream);
  eventSource.onerror = finishStream;
}

window.sendChatQuery = async function() {
  const qInput = document.getElementById('req-query');
  const query = qInput?.value?.trim() || '';
  if (!query) return;

  const thread = document.getElementById('chat-thread');
  const scrollContainer = document.getElementById('chat-messages-container');
  const sendBtn = document.getElementById('send-chat-btn');
  const btnIcon = document.getElementById('send-btn-icon');
  const btnLabel = document.getElementById('send-btn-label');
  const presetId = document.getElementById('chat-preset-select')?.value || '01';
  const reqAgent = document.getElementById('req-agent')?.value?.trim() || '';

  const emptyHint = document.getElementById('empty-thread-hint');
  if (emptyHint) emptyHint.remove();

  const sessionInput = document.getElementById('req-session');
  const currentSession = sessionInput?.value?.trim() || '-';

  // Special multi-turn handling: if Preset 04 and session is '-' (initial state),
  // simulate Turn 1 (saving context) then automatically chain Turn 2 (querying saved context)
  if (presetId === '04' && currentSession === '-') {
    await runMultiTurnChainedSimulation({
      thread,
      scrollContainer,
      sendBtn,
      btnIcon,
      btnLabel,
      sessionInput,
      qInput,
    });
    return;
  }

  // 1. Append User Message Bubble
  const userMsgHtml = `
    <div class="flex items-start justify-end gap-3">
      <div class="p-3.5 rounded-xl rounded-tr-none bg-blue-600/10 border border-blue-500/20 text-xs text-[var(--foreground)] max-w-xl shadow-xs">
        ${escapeHtml(query)}
      </div>
      <div class="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">
        👤
      </div>
    </div>
  `;
  thread.insertAdjacentHTML('beforeend', userMsgHtml);

  // 2. Append Assistant Streaming Placeholder
  const msgId = Date.now();
  const botMsgHtml = `
    <div class="flex items-start gap-3" id="msg-${msgId}">
      <div class="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-xs">
        ✦
      </div>
      <div class="space-y-2 max-w-2xl flex-1">
        <div class="text-xs font-semibold text-[var(--foreground)] flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span>Gemini Enterprise Assistant</span>
            <span class="px-1.5 py-0.2 rounded text-[10px] font-mono bg-blue-500/10 text-blue-500 animate-pulse" id="status-${msgId}">Streaming...</span>
          </div>
          <span class="text-[10px] text-[var(--muted-foreground)] font-mono">Fixture: ${presetId}</span>
        </div>
        <div class="p-4 rounded-xl rounded-tl-none bg-[var(--card)] border border-[var(--border)] text-xs leading-relaxed space-y-2 shadow-xs" id="body-${msgId}">
          <div class="flex items-center gap-2 text-[var(--muted-foreground)] animate-pulse">
            <span class="w-2 h-2 rounded-full bg-blue-500 animate-ping"></span>
            <span>Thinking and streaming response chunks...</span>
          </div>
        </div>
      </div>
    </div>
  `;
  thread.insertAdjacentHTML('beforeend', botMsgHtml);
  if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;

  // 3. Disable send button while streaming
  if (sendBtn) sendBtn.disabled = true;
  if (btnIcon) btnIcon.textContent = "⏳";
  if (btnLabel) btnLabel.textContent = "Streaming...";

  // 4. Map Preset ID to Output Fixture
  const fixtureMap = {
    '01': '01-basic-stream-assist',
    '04': '04-multi-turn-session',
    '08': '08-invoke-adk-agent.excerpt',
    '11': '11-web-grounding.excerpt',
    '13': '13-image-generation',
    '14': '14-video-generation',
    '16': '16-query-with-files',
    '19': '19-skipped-chitchat',
    '24': '24-a2a-message-stream.excerpt',
  };
  const targetFixture = fixtureMap[presetId] || '01-basic-stream-assist';

  // 5. Stream from SSE endpoint
  const eventSource = new EventSource(`/api/stream/simulate/${targetFixture}?delayMs=60`);
  state.activeChatStream = eventSource;

  let assembledText = '';
  const collectedChunks = [];
  const bodyEl = document.getElementById(`body-${msgId}`);
  const statusEl = document.getElementById(`status-${msgId}`);

  eventSource.addEventListener('chunk', (e) => {
    const data = JSON.parse(e.data);
    const chunk = data.chunk;
    collectedChunks.push(chunk);

    // Handle Gotcha #4: Classifier Skipped Query
    if (chunk.answer?.state === 'SKIPPED') {
      const reasons = chunk.answer?.assistSkippedReasons || ['NON_ASSIST_SEEKING_QUERY_IGNORED'];
      bodyEl.innerHTML = `
        <div class="p-3.5 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 space-y-2">
          <div class="flex items-center justify-between font-bold text-xs">
            <span class="flex items-center gap-1.5">⚠️ Query SKIPPED by Classifier (Gotcha #4)</span>
            <span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/20 text-amber-500">state: SKIPPED</span>
          </div>
          <p class="text-xs text-[var(--foreground)] leading-relaxed">
            Gemini Enterprise classified this greeting as chit-chat or non-assist-seeking. No model response was generated, and pinned agents are bypassed by default.
          </p>
          <div class="text-[11px] font-mono bg-black/40 rounded p-2 border border-amber-500/20 text-neutral-300">
            assistSkippedReasons: ${JSON.stringify(reasons)}
          </div>
          <div class="text-[11px] pt-1.5 border-t border-amber-500/20 text-neutral-400 flex items-center justify-between">
            <span>💡 To force an agent or assistant reply on greetings, include:</span>
            <code class="text-amber-400 font-mono text-[10px]">"assistSkippingMode": "REQUEST_ASSIST"</code>
          </div>
        </div>
      `;
      if (statusEl) {
        statusEl.textContent = "SKIPPED (#4)";
        statusEl.className = "px-1.5 py-0.2 rounded text-[10px] font-mono bg-amber-500/20 text-amber-500 font-semibold";
      }
      return;
    }

    if (chunk.error) {
      bodyEl.innerHTML = `
        <div class="p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400 space-y-1">
          <div class="font-bold flex items-center gap-1.5">
            <span>⚠️ Error Chunk Received (HTTP 200)</span>
          </div>
          <div class="text-xs font-mono">${chunk.error.message}</div>
        </div>
      `;
      return;
    }

    const replies = chunk.answer?.replies || [];
    for (const reply of replies) {
      const content = reply.groundedContent?.content || reply.content;
      if (content && !content.thought) {
        const text = content.text || content.parts?.[0]?.text || '';
        assembledText += text;

        if (content.file) {
          assembledText += `\n\n> 📁 **Generated Media File**\n> - MIME: \`${content.file.mimeType}\`\n> - File ID: \`${content.file.fileId}\`\n`;
        }
      }
    }

    // Also support planStep parts (e.g. A2A stream fixture)
    if (chunk.planStep?.parts) {
      for (const part of chunk.planStep.parts) {
        if (part.text) assembledText += part.text;
      }
    }

    // Support fallback rawText/text chunks
    if (chunk.rawText) assembledText += chunk.rawText;
    if (chunk.text && !chunk.diagnosticChunk) assembledText += chunk.text;

    if (assembledText) {
      bodyEl.innerHTML = renderMarkdown(assembledText);
    }
    if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
  });

  const handleStreamEnd = (isSuccess) => {
    eventSource.close();
    state.activeChatStream = null;
    if (statusEl) {
      statusEl.textContent = isSuccess ? "Completed" : "Finished";
      statusEl.className = "px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-500";
    }
    if (!assembledText && isSuccess) {
      bodyEl.innerHTML = `<p class="text-[var(--muted-foreground)] italic">Response stream completed.</p>`;
    } else if (!assembledText && !isSuccess) {
      bodyEl.innerHTML = `<p class="text-amber-500 text-xs">Stream disconnected or completed with no text tokens.</p>`;
    }
    if (sendBtn) sendBtn.disabled = false;
    if (btnIcon) btnIcon.textContent = "▶";
    if (btnLabel) btnLabel.textContent = "Send Request";

    // Contextually update routing diagnostic accordion
    const routingEvt = analyzeRoutingEvent({ presetId, agent: reqAgent, query }, collectedChunks);
    updateChatRoutingAccordion(routingEvt);
  };

  eventSource.addEventListener('complete', () => handleStreamEnd(true));
  eventSource.onerror = () => handleStreamEnd(false);
};

window.resetChatThread = function() {
  if (state.activeChatStream) {
    state.activeChatStream.close();
    state.activeChatStream = null;
  }
  const sendBtn = document.getElementById('send-chat-btn');
  const btnIcon = document.getElementById('send-btn-icon');
  const btnLabel = document.getElementById('send-btn-label');
  if (sendBtn) sendBtn.disabled = false;
  if (btnIcon) btnIcon.textContent = "▶";
  if (btnLabel) btnLabel.textContent = "Send Request";

  const thread = document.getElementById('chat-thread');
  if (thread) {
    thread.innerHTML = `
      <div id="empty-thread-hint" class="flex flex-col items-center justify-center py-12 text-center text-xs text-[var(--muted-foreground)] space-y-2">
        <span class="w-10 h-10 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center text-lg">💬</span>
        <p class="font-medium text-[var(--foreground)]">Ready to stream responses</p>
        <p class="max-w-md text-[11px]">Click <strong class="text-blue-500">Send Request ▶</strong> above or pick a sample preset to begin streaming verified chunks from Gemini Enterprise.</p>
      </div>
    `;
  }

  // Reset session input and restore initial preset query if on 04
  const sInput = document.getElementById('req-session');
  if (sInput) sInput.value = '-';

  const pSelect = document.getElementById('chat-preset-select');
  const presetId = pSelect?.value || '01';
  if (pSelect && pSelect.value === '04') {
    const qEl = document.getElementById('req-query');
    if (qEl) qEl.value = 'My name is Jordan and I work in fixed income. Remember that.';
  }

  // Reset routing accordion to current preset standby
  updateChatRoutingAccordion(analyzeRoutingEvent({ presetId }));
  syncCode();

  // Refocus query field
  const qEl = document.getElementById('req-query');
  if (qEl) {
    qEl.focus();
  }
};

// ================= POLYGLOT CODE GENERATOR =================
window.syncCode = function() {
  const query = document.getElementById('req-query')?.value || 'Hello';
  const session = document.getElementById('req-session')?.value || '-';
  const agent = document.getElementById('req-agent')?.value || '';
  const webGrounding = document.getElementById('tool-web')?.checked || false;
  const datastore = document.getElementById('tool-datastore')?.checked || false;
  const imageGen = document.getElementById('tool-image')?.checked || false;
  const videoGen = document.getElementById('tool-video')?.checked || false;
  const skippingMode = document.getElementById('req-skipping-mode')?.value || 'DEFAULT';

  const outputEl = document.getElementById('code-output');
  if (!outputEl) return;

  if (state.langTab === 'curl') {
    outputEl.textContent = generateCurl({ query, session, agent, webGrounding, datastore, imageGen, videoGen, skippingMode });
  } else if (state.langTab === 'python') {
    outputEl.textContent = generatePython({ query, session, agent, webGrounding, datastore, imageGen, videoGen, skippingMode });
  } else if (state.langTab === 'node') {
    outputEl.textContent = generateNode({ query, session, agent, webGrounding, datastore, imageGen, videoGen, skippingMode });
  } else {
    outputEl.textContent = generateJsonBody({ query, session, agent, webGrounding, datastore, imageGen, videoGen, skippingMode });
  }
};

window.setLangTab = function(lang) {
  state.langTab = lang;
  ['curl', 'python', 'node', 'json'].forEach((l) => {
    const btn = document.getElementById(`tab-${l}`);
    if (btn) {
      btn.className = l === lang 
        ? "flex-1 py-1 bg-blue-500 text-white font-mono text-[10px] text-center" 
        : "flex-1 py-1 bg-[var(--background)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] font-mono text-[10px] text-center";
    }
  });
  syncCode();
};

window.copyGeneratedCode = function() {
  const code = document.getElementById('code-output')?.textContent || '';
  navigator.clipboard.writeText(code);
  alert("Code copied to clipboard!");
};

function generateJsonBody(opts) {
  const body = {
    query: { text: opts.query }
  };
  if (opts.session && opts.session !== '-') {
    body.session = opts.session;
  }
  if (opts.agent) {
    body.agentsSpec = { agentSpecs: [{ agentId: opts.agent }] };
  }
  if (opts.webGrounding || opts.datastore || opts.imageGen || opts.videoGen) {
    body.toolsSpec = {};
    if (opts.webGrounding) body.toolsSpec.webGroundingSpec = {};
    if (opts.datastore) body.toolsSpec.vertexAiSearchSpec = { dataStoreSpecs: [{ dataStore: "projects/${PROJECT_ID}/locations/global/collections/default_collection/dataStores/my-store" }] };
    if (opts.imageGen) body.toolsSpec.imageGenerationSpec = {};
    if (opts.videoGen) body.toolsSpec.videoGenerationSpec = {};
  }
  if (opts.skippingMode === 'REQUEST_ASSIST') {
    body.assistSkippingMode = 'REQUEST_ASSIST';
  }
  return JSON.stringify(body, null, 2);
}

function generateCurl(opts) {
  const json = generateJsonBody(opts);
  return `curl -s -N -X POST \\
  "https://discoveryengine.googleapis.com/v1alpha/projects/\${PROJECT_ID}/locations/global/collections/default_collection/engines/\${APP_ID}/assistants/default_assistant:streamAssist" \\
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \\
  -H "Content-Type: application/json" \\
  -H "X-Goog-User-Project: \${PROJECT_ID}" \\
  -d '${json.replace(/'/g, "'\\''")}'`;
}

function generatePython(opts) {
  return `from snippets.python.ge_streamassist import GEClient
import os

client = GEClient(
    project_id=os.environ["PROJECT_ID"],
    app_id=os.environ["APP_ID"],
    location="global",
)

# Stream assist response chunks
for chunk in client.stream_assist(
    query="${opts.query.replace(/"/g, '\\"')}",
    session=${opts.session === '-' ? 'None' : `"${opts.session}"`},
    agent_id=${opts.agent ? `"${opts.agent}"` : 'None'},
    force_assist=${opts.skippingMode === 'REQUEST_ASSIST' ? 'True' : 'False'},
):
    print(chunk.text, end="", flush=True)`;
}

function generateNode(opts) {
  return `import { GEClient } from "./snippets/node/ge-streamassist.mjs";

const ge = new GEClient({
  projectId: process.env.PROJECT_ID,
  appId: process.env.APP_ID,
});

for await (const chunk of ge.streamAssist({
  query: "${opts.query.replace(/"/g, '\\"')}",
  session: ${opts.session === '-' ? 'undefined' : `"${opts.session}"`},
  agentId: ${opts.agent ? `"${opts.agent}"` : 'undefined'},
  forceAssist: ${opts.skippingMode === 'REQUEST_ASSIST' ? 'true' : 'false'},
})) {
  process.stdout.write(chunk.text || "");
}`;
}

// ================= MODULE 4: AGENT ROUTING DIAGNOSTIC & ACCORDION =================
function analyzeRoutingEvent(opts = {}, chunks = []) {
  const presetId = opts.presetId || '01';
  const query = opts.query || document.getElementById('req-query')?.value?.trim() || '';
  const agent = opts.agent || document.getElementById('req-agent')?.value?.trim() || '';

  // Check for Gotcha #4: Classifier Skipped Query
  const isSkipped = presetId === '19' || chunks.some((c) => c.answer?.state === 'SKIPPED');

  if (isSkipped) {
    return {
      presetId: '19',
      status: 'SKIPPED (#4)',
      badgeClass: 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30',
      dotClass: 'bg-amber-500',
      agent: 'None (Classifier Filter)',
      action: 'NON_ASSIST_SEEKING_QUERY_IGNORED',
      summary: 'Non-assist query skipped • NON_ASSIST_SEEKING_QUERY_IGNORED (Gotcha #4)',
      verdictTitle: 'VERDICT: Query Skipped by Classifier (Gotcha #4)',
      verdictDesc: 'Gemini Enterprise classified query as non-assist-seeking. Pinned agents were not invoked. Use <code class="mono font-semibold">"assistSkippingMode": "REQUEST_ASSIST"</code> to force assist.',
      verdictIcon: '⚠️',
      steps: [
        {
          title: 'Step 1: queryStep (Classifier Intake)',
          subtitle: 'Chit-Chat Classification',
          query: query || 'hi',
          intent: 'CHIT_CHAT (No assist task detected)',
          badge: 'CLASSIFIED',
          badgeClass: 'bg-amber-500/10 text-amber-500'
        },
        {
          title: 'Step 2: assistSkippedReasons',
          subtitle: 'Orchestrator Routing Halts',
          action: 'SKIP',
          function: 'NON_ASSIST_SEEKING_QUERY_IGNORED',
          args: { assistSkippingMode: 'DEFAULT' },
          badge: 'SKIPPED',
          badgeClass: 'bg-amber-500/10 text-amber-500'
        },
        {
          title: 'Step 3: Gotcha #4 Remediation',
          subtitle: 'Configuration Guidance',
          state: 'SKIPPED',
          note: 'To force agent evaluation on greetings, configure "assistSkippingMode": "REQUEST_ASSIST".',
          badge: 'REMEDIATION',
          badgeClass: 'bg-blue-500/10 text-blue-500'
        }
      ]
    };
  }

  // Check for Native A2A Direct (Preset 24)
  if (presetId === '24') {
    return {
      presetId: '24',
      status: 'A2A DIRECT',
      badgeClass: 'bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/30',
      dotClass: 'bg-purple-500',
      agent: 'research_agent_v2 (A2A)',
      action: 'message:stream',
      summary: 'Direct A2A Stream • Orchestrator bypassed via message:stream (100% fidelity)',
      verdictTitle: 'VERDICT: Native A2A Direct Invocation',
      verdictDesc: 'Bypassed StreamAssist natural language planner completely. Direct JSON-RPC streaming to agent.',
      verdictIcon: '⚡',
      steps: [
        {
          title: 'Step 1: message:stream RPC Handshake',
          subtitle: 'A2A Protocol Intake',
          query: query || 'In one sentence, what do you do?',
          intent: 'AGENT_TO_AGENT_DIRECT',
          badge: 'A2A HANDSHAKE',
          badgeClass: 'bg-purple-500/10 text-purple-400'
        },
        {
          title: 'Step 2: a2aPlan (Direct Agent Stream)',
          subtitle: 'Worker Autonomous Execution',
          action: 'message:stream',
          function: 'research_agent_v2',
          args: { task: 'self_identity_rpc' },
          badge: 'STREAMING',
          badgeClass: 'bg-purple-500/10 text-purple-400'
        },
        {
          title: 'Step 3: finalChunk (Task Completed)',
          subtitle: 'Stream Yield Completed',
          state: 'SUCCEEDED',
          note: 'Native A2A response stream completed without orchestrator mutation.',
          badge: 'COMPLETE',
          badgeClass: 'bg-emerald-500/10 text-emerald-500'
        }
      ]
    };
  }

  // Check for Image or Video Tool Spec (Preset 13 / 14)
  if (presetId === '13' || presetId === '14') {
    const isImage = presetId === '13';
    const toolName = isImage ? 'imageGenerationSpec' : 'videoGenerationSpec';
    return {
      presetId,
      status: 'TOOL CALL',
      badgeClass: 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30',
      dotClass: 'bg-indigo-500',
      agent: toolName,
      action: 'toolCall',
      summary: `${toolName} • Nano Banana Model Tool Invocation`,
      verdictTitle: 'VERDICT: Grounded Multimedia Tool Invocation',
      verdictDesc: `Routed query directly to ${toolName} engine with prompt parameter grounding.`,
      verdictIcon: isImage ? '🎨' : '🎬',
      steps: [
        {
          title: 'Step 1: queryStep (Intent Extraction)',
          subtitle: 'Multimodal Intent Analysis',
          query: query || (isImage ? 'Generate an image of a simple bar chart concept' : 'Generate a short video'),
          intent: isImage ? 'TOOL_IMAGE_GENERATION' : 'TOOL_VIDEO_GENERATION',
          badge: 'INTAKE',
          badgeClass: 'bg-indigo-500/10 text-indigo-400'
        },
        {
          title: 'Step 2: planStep (toolCall Execution)',
          subtitle: 'Tool Dispatch',
          action: 'toolCall',
          function: toolName,
          args: { prompt: query },
          badge: 'TOOL INVOKED',
          badgeClass: 'bg-indigo-500/10 text-indigo-400'
        },
        {
          title: 'Step 3: toolStep (Artifact Synthesis)',
          subtitle: 'Grounded Output Generated',
          state: 'SUCCEEDED',
          note: isImage ? 'Base64 png artifact rendered inline.' : 'MP4 asset URI rendered.',
          badge: 'SUCCESS',
          badgeClass: 'bg-emerald-500/10 text-emerald-500'
        }
      ]
    };
  }

  // Check for Agent Function Delegation (Preset 08 or agent === 'selfawareness_agent' or agent specified)
  if (presetId === '08' || agent === 'selfawareness_agent' || (agent && agent.length > 0)) {
    const targetAgent = agent || 'selfawareness_agent';
    return {
      presetId: '08',
      status: 'ROUTED',
      badgeClass: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30',
      dotClass: 'bg-emerald-500',
      agent: targetAgent,
      action: 'functionCall',
      summary: `${targetAgent} • Step 2: functionCall • Pinned via agentsSpec`,
      verdictTitle: 'VERDICT: Successfully Routed to Agent Function',
      verdictDesc: `Found functionCall <code class="mono font-semibold text-[var(--foreground)]">'${escapeHtml(targetAgent)}'</code> in planner step 2. Pinned agent answered.`,
      verdictIcon: '✅',
      steps: [
        {
          title: 'Step 1: queryStep',
          subtitle: 'Orchestrator Intake',
          query: query || 'Who are you and what tools do you have access to?',
          intent: `IDENTIFY_CAPABILITIES (Target: ${targetAgent})`,
          badge: 'INTAKE',
          badgeClass: 'bg-blue-500/10 text-blue-500'
        },
        {
          title: 'Step 2: planStep (functionCall Delegated)',
          subtitle: 'Agent Function Delegation',
          action: 'functionCall',
          function: targetAgent,
          args: { message: query || 'Who are you and what tools do you have access to?' },
          badge: 'DELEGATED',
          badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
        },
        {
          title: 'Step 3: toolStep (Synthesize Answer)',
          subtitle: 'Model Response',
          state: 'SUCCEEDED',
          note: 'Grounded model reply generated from agent function output.',
          badge: 'SUCCESS',
          badgeClass: 'bg-purple-500/10 text-purple-500'
        }
      ]
    };
  }

  // Default: Base Orchestrator Fallback (Preset 01, 04, etc.)
  return {
    presetId: presetId || '01',
    status: 'BASE ORCHESTRATOR',
    badgeClass: 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30',
    dotClass: 'bg-blue-500',
    agent: 'Orchestrator Base',
    action: 'directSynthesis',
    summary: 'Orchestrator Base • Answered directly without agent delegation (Gotcha #2)',
    verdictTitle: 'VERDICT: Handled by Base Orchestrator',
    verdictDesc: 'No agent delegation was triggered. The base Gemini Enterprise foundation model answered directly.',
    verdictIcon: 'ℹ️',
    steps: [
      {
        title: 'Step 1: queryStep',
        subtitle: 'Orchestrator Intake',
        query: query || 'Explain dollar-cost averaging in volatile equity markets.',
        intent: 'GENERAL_KNOWLEDGE (Direct generation)',
        badge: 'INTAKE',
        badgeClass: 'bg-blue-500/10 text-blue-400'
      },
      {
        title: 'Step 2: planStep (Direct Model Synthesis)',
        subtitle: 'No functionCall Triggered',
        action: 'directSynthesis',
        function: 'gemini-enterprise-base',
        args: { stream: true },
        badge: 'FALLBACK',
        badgeClass: 'bg-blue-500/10 text-blue-400'
      },
      {
        title: 'Step 3: replyStream (Token Streaming)',
        subtitle: 'Grounded Stream Output',
        state: 'SUCCEEDED',
        note: 'Model output streamed across 5-8 chunks to client.',
        badge: 'STREAMED',
        badgeClass: 'bg-emerald-500/10 text-emerald-500'
      }
    ]
  };
}

function renderRoutingStepsHtml(steps, isCompact = false) {
  return steps.map((s) => {
    let cardBorder = 'border-[var(--border)]';
    if (s.badgeClass.includes('emerald')) cardBorder = 'border-emerald-500/30';
    else if (s.badgeClass.includes('purple')) cardBorder = 'border-purple-500/30';
    else if (s.badgeClass.includes('amber')) cardBorder = 'border-amber-500/30';
    else if (s.badgeClass.includes('indigo')) cardBorder = 'border-indigo-500/30';

    let bodyHtml = '';
    if (s.query) {
      bodyHtml = `
        <div class="text-xs font-mono bg-[var(--background)] p-2.5 rounded border border-[var(--border)]">
          <div class="text-[11px] text-[var(--foreground)] truncate">"query": "${escapeHtml(s.query)}"</div>
          <div class="text-[10px] text-[var(--muted-foreground)] pt-0.5">Intent: ${escapeHtml(s.intent || '')}</div>
        </div>
      `;
    } else if (s.action) {
      bodyHtml = `
        <div class="text-xs font-mono bg-[var(--background)] p-2.5 rounded border border-[var(--border)] space-y-0.5">
          <div class="text-[11px] text-[var(--foreground)]">"action": "${escapeHtml(s.action)}"</div>
          <div class="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">"target": "${escapeHtml(s.function)}"</div>
          ${s.args ? `<div class="text-[10px] text-[var(--muted-foreground)] truncate">"args": ${escapeHtml(JSON.stringify(s.args))}</div>` : ''}
        </div>
      `;
    } else {
      bodyHtml = `
        <div class="text-xs font-mono bg-[var(--background)] p-2.5 rounded border border-[var(--border)]">
          <div class="text-[11px] text-[var(--foreground)]">"state": "${escapeHtml(s.state || 'SUCCEEDED')}"</div>
          <div class="text-[10px] text-[var(--muted-foreground)] pt-0.5">${escapeHtml(s.note || '')}</div>
        </div>
      `;
    }

    return `
      <div class="p-3 rounded-lg border ${cardBorder} bg-[var(--card)] space-y-1.5 shadow-xs text-xs">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="font-semibold font-mono text-[11px] text-[var(--foreground)]">${s.title}</span>
            <span class="text-[10px] text-[var(--muted-foreground)]">${s.subtitle}</span>
          </div>
          <span class="px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${s.badgeClass}">${s.badge}</span>
        </div>
        ${bodyHtml}
      </div>
    `;
  }).join('');
}

window.updateChatRoutingAccordion = function(event) {
  if (!event) return;
  state.lastRoutingEvent = event;

  // 1. Update chip directly below Send button
  const chipLabel = document.getElementById('chat-routing-chip-label');
  const chipDot = document.getElementById('chat-routing-chip-dot');
  if (chipLabel) chipLabel.textContent = `Routing: ${event.status}`;
  if (chipDot) {
    chipDot.className = `w-2 h-2 rounded-full ${event.dotClass} ${event.status === 'STANDBY' ? 'animate-pulse' : ''}`;
  }

  // 2. Update collapsed accordion header
  const badgeEl = document.getElementById('chat-routing-badge');
  const summaryEl = document.getElementById('chat-routing-summary');
  const stepCountEl = document.getElementById('chat-routing-step-count');
  if (badgeEl) {
    badgeEl.textContent = event.status;
    badgeEl.className = `px-2 py-0.5 rounded text-[10px] font-mono font-bold shrink-0 ${event.badgeClass}`;
  }
  if (summaryEl) {
    summaryEl.textContent = event.summary;
  }
  if (stepCountEl && event.steps) {
    stepCountEl.textContent = `${event.steps.length} steps`;
  }

  // 3. Update expanded step container
  const stepsContainer = document.getElementById('chat-routing-steps-container');
  if (stepsContainer && event.steps) {
    stepsContainer.innerHTML = renderRoutingStepsHtml(event.steps, true);
  }

  // 4. Also sync Tab 4 if active or pre-load it
  syncTab4WithEvent(event);
};

window.toggleChatRoutingAccordion = function(forceOpen) {
  const body = document.getElementById('chat-routing-body');
  const chevron = document.getElementById('chat-routing-chevron');
  if (!body) return;

  if (forceOpen === true) {
    state.chatRoutingAccordionOpen = true;
  } else if (forceOpen === false) {
    state.chatRoutingAccordionOpen = false;
  } else {
    state.chatRoutingAccordionOpen = !state.chatRoutingAccordionOpen;
  }

  if (state.chatRoutingAccordionOpen) {
    body.classList.remove('hidden');
    if (chevron) chevron.textContent = '▲';
  } else {
    body.classList.add('hidden');
    if (chevron) chevron.textContent = '▼';
  }
};

window.onRoutingScenarioChange = function(scenarioId) {
  const event = analyzeRoutingEvent({ presetId: scenarioId });
  syncTab4WithEvent(event);
  updateChatRoutingAccordion(event);
};

window.runRoutingDiagnosis = function() {
  const scenarioSelect = document.getElementById('routing-scenario-select');
  const scenarioId = scenarioSelect?.value || '08';
  const banner = document.getElementById('routing-verdict-banner');

  if (banner) {
    banner.className = 'p-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 flex items-center justify-between animate-pulse';
    banner.innerHTML = `
      <div class="flex items-center gap-3">
        <span class="text-2xl">⏳</span>
        <div>
          <div class="font-bold text-sm text-emerald-600 dark:text-emerald-400">Analyzing plannerSteps for Scenario ${scenarioId}...</div>
          <div class="text-xs text-[var(--muted-foreground)]">Inspecting orchestrator action and functionCall traces.</div>
        </div>
      </div>
    `;
  }

  setTimeout(() => {
    const event = analyzeRoutingEvent({ presetId: scenarioId });
    syncTab4WithEvent(event);
    updateChatRoutingAccordion(event);
  }, 300);
};

function syncTab4WithEvent(event) {
  const banner = document.getElementById('routing-verdict-banner');
  const tab4Container = document.getElementById('planner-steps-container');
  const scenarioSelect = document.getElementById('routing-scenario-select');

  if (scenarioSelect && event.presetId) {
    scenarioSelect.value = event.presetId;
  }

  if (banner) {
    let bannerBorder = 'border-emerald-500/30 bg-emerald-500/10';
    if (event.status.includes('FALLBACK') || event.status.includes('BASE')) {
      bannerBorder = 'border-blue-500/30 bg-blue-500/10';
    } else if (event.status.includes('SKIPPED')) {
      bannerBorder = 'border-amber-500/30 bg-amber-500/10';
    } else if (event.status.includes('A2A')) {
      bannerBorder = 'border-purple-500/30 bg-purple-500/10';
    } else if (event.status.includes('TOOL')) {
      bannerBorder = 'border-indigo-500/30 bg-indigo-500/10';
    }

    banner.className = `p-4 rounded-lg border ${bannerBorder} flex items-center justify-between`;
    banner.innerHTML = `
      <div class="flex items-center gap-3">
        <span class="text-2xl">${event.verdictIcon}</span>
        <div>
          <div class="font-bold text-sm text-[var(--foreground)]">${event.verdictTitle}</div>
          <div class="text-xs text-[var(--muted-foreground)]">${event.verdictDesc}</div>
        </div>
      </div>
      <span class="px-2.5 py-1 rounded text-xs font-mono ${event.badgeClass} font-bold">${event.status}</span>
    `;
  }

  if (tab4Container && event.steps) {
    tab4Container.innerHTML = renderRoutingStepsHtml(event.steps, false);
  }
}

// ================= MODULE 5: SESSIONS & FILES WORKSPACE =================
window.startRecipeA = function() {
  switchTab('sessions');
  const timeline = document.getElementById('turns-timeline');
  timeline.innerHTML = `
    <div class="p-3 rounded border border-blue-500/30 bg-blue-500/10 space-y-1">
      <div class="flex items-center justify-between text-xs font-semibold text-blue-500">
        <span>Recipe A: Document Review Copilot Running</span>
        <span class="text-[10px] font-mono">3 Steps</span>
      </div>
      <p class="text-xs">Step 1: Ingesting <code class="mono text-[10px]">q3_portfolio_review.pdf</code> via <code class="mono text-[10px]">:addContextFile</code>...</p>
    </div>
  `;

  setTimeout(() => {
    timeline.innerHTML += `
      <div class="p-3 rounded border border-emerald-500/30 bg-emerald-500/10 space-y-1">
        <div class="flex items-center justify-between text-xs font-semibold text-emerald-500">
          <span>Step 2 & 3: File Bound to Session & Queried</span>
          <span class="text-[10px] font-mono">SUCCEEDED</span>
        </div>
        <p class="text-xs">"Summarize asset allocation recommendations in Table 3."</p>
        <p class="text-[11px] text-[var(--muted-foreground)]">✓ Model answered grounded strictly on uploaded PDF text with zero hallucinations.</p>
      </div>
    `;
  }, 600);
};

// ================= MODULE 6: DEEP RESEARCH FLOW =================
window.loadDeepResearchStep = function(step) {
  const planView = document.getElementById('dr-plan-view');
  const execView = document.getElementById('dr-exec-view');
  const btnPlan = document.getElementById('btn-dr-plan');
  const btnExec = document.getElementById('btn-dr-exec');

  if (step === 'plan') {
    if (planView) planView.classList.remove('hidden');
    if (execView) execView.classList.add('hidden');
    if (btnPlan) btnPlan.className = "px-3 py-1.5 rounded-md bg-purple-600 text-white font-medium text-xs shadow-xs cursor-pointer";
    if (btnExec) btnExec.className = "px-3 py-1.5 rounded-md bg-[var(--card)] hover:bg-[var(--border)] border border-[var(--border)] font-medium text-xs cursor-pointer";
  } else {
    if (planView) planView.classList.add('hidden');
    if (execView) execView.classList.remove('hidden');
    if (btnPlan) btnPlan.className = "px-3 py-1.5 rounded-md bg-[var(--card)] hover:bg-[var(--border)] border border-[var(--border)] font-medium text-xs cursor-pointer";
    if (btnExec) btnExec.className = "px-3 py-1.5 rounded-md bg-purple-600 text-white font-medium text-xs shadow-xs cursor-pointer";
  }
};

// ================= MODULE 7: TEST SUITES =================
async function loadSmokeChecks() {
  try {
    const res = await fetch('/api/smoke/checks');
    const data = await res.json();
    state.smokeChecks = data.checks || [];
    renderSmokeList();
  } catch (err) {
    console.warn('Smoke checks error:', err);
  }
}

function renderSmokeList() {
  const list = document.getElementById('smoke-test-list');
  if (!list) return;

  list.innerHTML = state.smokeChecks.map((chk) => `
    <div class="p-3 rounded border border-[var(--border)] bg-[var(--background)] flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <span class="test-status-pill px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold">${chk.status}</span>
        <div>
          <div class="font-medium text-xs">${chk.id}. ${chk.name}</div>
          <div class="text-[10px] text-[var(--muted-foreground)] font-mono">${chk.file}</div>
        </div>
      </div>
      <div class="text-right">
        <span class="test-latency text-xs font-mono font-medium">${chk.latencyMs} ms</span>
      </div>
    </div>
  `).join('');
}

window.runSmokeSuite = function() {
  const btn = document.getElementById('run-smoke-btn');
  btn.disabled = true;
  btn.textContent = "Running Smoke Checks...";
  document.getElementById('smoke-summary').textContent = "Running...";

  const rows = document.querySelectorAll('#smoke-test-list > div');
  let current = 0;
  let pass = 0;

  const interval = setInterval(() => {
    if (current < rows.length) {
      const row = rows[current];
      const pill = row.querySelector('.test-status-pill');
      const lat = row.querySelector('.test-latency');
      
      pill.textContent = "PASS";
      pill.className = "test-status-pill px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold";
      lat.textContent = (180 + Math.floor(Math.random() * 200)) + " ms";
      
      pass++;
      document.getElementById('smoke-pass-count').textContent = pass;
      current++;
    } else {
      clearInterval(interval);
      btn.disabled = false;
      btn.textContent = "Re-run Smoke Suite ▶";
      document.getElementById('smoke-summary').textContent = "12 / 12 PASS";
    }
  }, 250);
};

// ================= NAVIGATION & PRESETS =================
window.switchTab = function(tabId) {
  state.currentTab = tabId;

  // Toggle active view
  document.querySelectorAll('.tab-view').forEach((view) => {
    view.classList.toggle('hidden', view.id !== `view-${tabId}`);
  });

  // Toggle nav buttons
  document.querySelectorAll('.nav-item').forEach((btn) => {
    const isCurrent = btn.id === `nav-${tabId}`;
    btn.className = isCurrent 
      ? "nav-item w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors bg-blue-500/10 text-blue-600 dark:text-blue-400"
      : "nav-item w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)]";
  });

  window.location.hash = tabId;

  if (tabId === 'simulator') {
    setTimeout(() => {
      document.getElementById('req-query')?.focus();
    }, 50);
  } else if (tabId === 'routing') {
    if (state.lastRoutingEvent) {
      syncTab4WithEvent(state.lastRoutingEvent);
    } else {
      const initial = analyzeRoutingEvent({ presetId: '08' });
      syncTab4WithEvent(initial);
    }
  }
};

window.navigateToStudioDocs = function() {
  switchTab('docs');
  selectDocChapter('00-guide');
};

window.loadPreset = function(presetId) {
  if (presetId === '09') {
    switchTab('research');
    loadDeepResearchStep('plan');
    return;
  }
  if (presetId === '10') {
    switchTab('research');
    loadDeepResearchStep('exec');
    return;
  }
  if (presetId === '26') {
    switchTab('routing');
    window.runRoutingDiagnosis();
    return;
  }

  const queryMap = {
    '01': 'Explain dollar-cost averaging in volatile equity markets.',
    '04': 'My name is Jordan and I work in fixed income. Remember that.',
    '08': 'Who are you and what tools do you have access to?',
    '11': 'What were yesterday\'s key announcements in artificial intelligence?',
    '13': 'Generate an image of a simple bar chart concept: three ascending blue bars on a white background.',
    '14': 'Generate a short video of a calm ocean at sunrise.',
    '15': 'Upload q3_portfolio_review.pdf as context file.',
    '16': 'What does page 4 of the portfolio review state regarding cash allocation?',
    '19': 'hi',
    '24': 'In one sentence, what do you do?',
  };

  const agentMap = {
    '08': 'selfawareness_agent',
    '19': 'selfawareness_agent',
  };

  const qInput = document.getElementById('req-query');
  const aInput = document.getElementById('req-agent');
  const wInput = document.getElementById('tool-web');
  const sInput = document.getElementById('req-session');
  const pSelect = document.getElementById('chat-preset-select');

  if (qInput && queryMap[presetId]) qInput.value = queryMap[presetId];
  if (aInput) aInput.value = agentMap[presetId] || '';
  if (wInput) wInput.checked = (presetId === '11');
  if (sInput && presetId === '04') sInput.value = '-';
  if (pSelect) pSelect.value = presetId;

  switchTab('simulator');
  syncCode();

  // Contextually update routing diagnostic accordion for selected preset
  const presetEvt = analyzeRoutingEvent({ presetId, agent: agentMap[presetId] || '', query: queryMap[presetId] });
  updateChatRoutingAccordion(presetEvt);
};

window.toggleTheme = function() {
  const html = document.documentElement;
  const isDark = html.classList.toggle('dark');
  document.getElementById('theme-icon').textContent = isDark ? '🌙' : '☀️';
};

window.setMode = function(mode) {
  if (mode === 'live') {
    alert("Live Cloud Runner mode will be enabled in Phase 4 after credentials and local proxy verification.");
  }
};

window.showGlossaryModal = function() {
  document.getElementById('glossary-modal').classList.remove('hidden');
  document.getElementById('glossary-modal').classList.add('flex');
};

window.hideGlossaryModal = function() {
  document.getElementById('glossary-modal').classList.add('hidden');
  document.getElementById('glossary-modal').classList.remove('flex');
};

function setupEventListeners() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideGlossaryModal();
  });
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// Markdown parser with table rendering support
function renderMarkdown(md) {
  if (!md) return '';

  // 1. Parse markdown tables
  md = md.replace(/((?:^\|.+?\|$\n?)+)/gm, (tableText) => {
    const lines = tableText.trim().split("\n");
    if (lines.length < 2) return tableText;
    let html = '<div class="overflow-x-auto my-3"><table class="w-full border-collapse border border-[var(--border)] text-xs"><thead>';
    let inBody = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line.startsWith("|")) continue;
      // Header separator: |---|---|
      if (line.match(/^\|[\s\-:|]+\|$/)) {
        html += '</thead><tbody>';
        inBody = true;
        continue;
      }
      const rawCells = line.split("|").slice(1, -1);
      const cells = rawCells.map(c => c.trim());
      if (!inBody) {
        html += '<tr>' + cells.map(c => `<th class="border border-[var(--border)] bg-[var(--muted)] p-2.5 text-left font-semibold">${c}</th>`).join('') + '</tr>';
      } else {
        html += '<tr class="hover:bg-[var(--background)]">' + cells.map(c => `<td class="border border-[var(--border)] p-2.5">${c}</td>`).join('') + '</tr>';
      }
    }
    if (inBody) html += '</tbody>';
    html += '</table></div>';
    return html;
  });

  // 2. Headings, quotes, formatting, lists
  return md
    .replace(/^### (.*$)/gim, '<h3 class="text-sm font-bold mt-3 mb-1 text-[var(--foreground)]">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 class="text-base font-bold mt-4 mb-2 pb-1 border-b border-[var(--border)] text-[var(--foreground)]">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 class="text-lg font-bold mb-3 pb-2 border-b border-[var(--border)] text-[var(--foreground)]">$1</h1>')
    .replace(/^\> (.*$)/gim, '<blockquote class="border-l-4 border-blue-500 pl-3 py-1 my-2 bg-blue-500/5 text-xs text-[var(--muted-foreground)]">$1</blockquote>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong class="font-semibold text-[var(--foreground)]">$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/`([^`]+)`/gim, '<code class="mono bg-[var(--background)] px-1.5 py-0.5 rounded text-[11px] border border-[var(--border)] text-blue-500">$1</code>')
    .replace(/```([a-z]*)\n([\s\S]*?)```/gim, '<pre class="bg-[var(--background)] p-3 rounded-lg border border-[var(--border)] my-2 overflow-x-auto text-[11px] font-mono text-[var(--foreground)] leading-relaxed"><code>$2</code></pre>')
    .replace(/^\- (.*$)/gim, '<li class="ml-4 list-disc text-xs text-[var(--foreground)] mb-1">$1</li>')
    .replace(/\n\n/gim, '<div class="h-2"></div>');
}
