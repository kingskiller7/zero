// Zero — boot + orchestration.
import { kv, collection, init as initDB } from "./storage.js";
import { makeProvider, DEFAULT_MODELS } from "./provider.js";
import { viz } from "./viz.js";
import * as wm from "./working-memory.js";
import * as wiki from "./wiki.js";
import { buildContext } from "./context.js";
import { mountMemoryView } from "./memory-view.js";
import { detectIntent, runTool } from "./tools.js";
import { mountToolsView } from "./tools-view.js";
import * as vfs from "./vfs.js";
import { mountTerminalView } from "./terminal-view.js";
import * as cap from "./capability.js";
import { mountCapabilityView } from "./capability-view.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const messages = collection("messages");

const state = {
  provider: null, // adapter
  config: null, // { provider, apiKey, model }
  history: [], // [{role, content}]
  abort: null,
};

const visualization = viz($("#viz"), $("#viz-state"));

const SYSTEM_PROMPT = `You are Zero — a calm, competent, local-first AI workspace assistant.
You are truthful, concise, and practical. You challenge incorrect assumptions politely.
You distinguish between what is available, implementable, and impossible. Missing features
are not the same as impossible features. Explain uncertainty rather than refuse.`;

// ─── boot ──────────────────────────────────────────────
async function boot() {
  const log = $("#boot-log");
  const stages = [
    ["init", "storage", () => initDB()],
    ["init", "capability engine", () => sleep(120)],
    ["init", "context engine", () => sleep(80)],
    ["init", "working memory", () => wm.load()],
    ["init", "virtual fs", () => vfs.load()],
    ["init", "llm wiki", () => wiki.load()],
    ["load", "configuration", loadConfig],
  ];
  for (const [verb, name, fn] of stages) {
    log.append(line(`${verb} ${name} … `));
    try {
      await fn();
      append(log, "ok\n", "ok");
    } catch (e) {
      append(log, `fail: ${e.message}\n`);
      return;
    }
  }
  await sleep(220);
  if (state.config) await enterWorkspace();
  else enterOnboarding();
}

function line(text) {
  const n = document.createElement("span");
  n.textContent = text;
  return n;
}
function append(parent, text, cls) {
  const n = document.createElement("span");
  n.textContent = text;
  if (cls) n.className = cls;
  parent.append(n);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadConfig() {
  const cfg = await kv.get("config");
  if (cfg) {
    state.config = cfg;
    state.provider = makeProvider(cfg);
  }
}

function show(id) {
  for (const s of ["boot", "onboarding", "workspace"]) {
    document.getElementById(s).hidden = s !== id;
  }
  $("#app").dataset.state = id;
}

// ─── onboarding ────────────────────────────────────────
function enterOnboarding() {
  show("onboarding");
  let selected = "gemini";
  const providers = $$(".provider");
  const modelInput = $("#model");

  providers.forEach((b) => {
    b.addEventListener("click", () => {
      selected = b.dataset.provider;
      providers.forEach((x) => x.setAttribute("aria-checked", x === b));
      modelInput.value = DEFAULT_MODELS[selected];
    });
  });

  $("#key-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const apiKey = $("#api-key").value.trim();
    const model = modelInput.value.trim() || DEFAULT_MODELS[selected];
    const statusEl = $("#key-status");
    const submitBtn = e.target.querySelector("button[type=submit]");

    statusEl.textContent = "verifying…";
    statusEl.classList.remove("err");
    submitBtn.disabled = true;

    try {
      const p = makeProvider({ provider: selected, apiKey, model });
      await p.verify();
      state.config = { provider: selected, apiKey, model };
      state.provider = p;
      await kv.set("config", state.config);
      statusEl.textContent = "ok";
      await sleep(360);
      enterWorkspace();
    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.classList.add("err");
      submitBtn.disabled = false;
    }
  });
}

// ─── workspace ─────────────────────────────────────────
async function enterWorkspace() {
  show("workspace");
  $("#viz-model").textContent = `${state.config.provider} · ${state.config.model}`;
  $("#d-provider").textContent = state.config.provider;
  $("#d-model").textContent = state.config.model;
  visualization.set("idle");
  wireChat();
  wireNav();
  wireDevPanel();
  mountMemoryView(document.getElementById("view-memory"));
  mountToolsView(document.getElementById("view-tools"));
  mountTerminalView(document.getElementById("view-terminal"));
  mountCapabilityView(document.getElementById("view-capability"));
  cap.subscribe(updateCapStat);
  updateCapStat();
  updateWikiStat();
  wiki.subscribe(updateWikiStat);
  await loadHistory();
}

async function loadHistory() {
  const stored = await messages.all();
  state.history = stored.map(({ role, content }) => ({ role, content }));
  const container = $("#messages");
  container.innerHTML = "";
  if (state.history.length === 0) {
    addMessageDOM("system", "Zero online. How can I help?");
  } else {
    for (const m of state.history) addMessageDOM(m.role === "assistant" ? "zero" : m.role, m.content);
  }
}

function wireNav() {
  $$(".rail-nav button").forEach((b) => {
    b.addEventListener("click", () => {
      $$(".rail-nav button").forEach((x) => x.classList.toggle("active", x === b));
      const view = b.dataset.view;
      for (const v of ["chat", "memory", "tools", "terminal", "capability"]) {
        $(`#view-${v}`).hidden = v !== view;
      }
    });
  });
  $("#new-chat").addEventListener("click", async () => {
    if (!confirm("Clear current conversation?")) return;
    await messages.clear();
    state.history = [];
    $("#messages").innerHTML = "";
    addMessageDOM("system", "New conversation.");
  });
  $("#settings-btn").addEventListener("click", async () => {
    if (!confirm("Reset provider and API key?")) return;
    await kv.del("config");
    location.reload();
  });
}

function wireDevPanel() {
  const panel = $("#dev-panel");
  const toggle = () => (panel.hidden = !panel.hidden);
  $("#dev-toggle").addEventListener("click", toggle);
  $("#dev-close").addEventListener("click", () => (panel.hidden = true));
  document.addEventListener("keydown", (e) => {
    if (e.key === "." && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      toggle();
    }
  });
}

// ─── chat ──────────────────────────────────────────────
function wireChat() {
  const form = $("#composer");
  const input = $("#input");

  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 200) + "px";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    input.style.height = "auto";
    await sendMessage(text);
  });
}

async function sendMessage(text) {
  addMessageDOM("user", text);
  state.history.push({ role: "user", content: text });
  await messages.add({ role: "user", content: text });

  // ─── /plan shortcut → propose a sandboxed plan, then stop.
  if (/^\/plan\s+/i.test(text)) {
    const body = text.replace(/^\/plan\s+/i, "");
    try {
      const plan = cap.propose(body);
      if (!plan) addMessageDOM("system", "No actionable steps parsed. Open the Capability tab.");
      else addMessageDOM("system", `Plan proposed (${plan.actions.length} action${plan.actions.length === 1 ? "" : "s"}). Review & approve in the Capability tab.`);
    } catch (e) { addMessageDOM("system", `[error] ${e.message}`); }
    return;
  }


  // ─── intent routing: run a tool BEFORE the model when the request matches.
  let toolNote = ""; // appended to context as a system "Tool result" block
  const intent = detectIntent(text);
  if (intent?.tool === "__list") {
    const lines = (await import("./tools.js")).listTools()
      .map((t) => `- /${t.name}: ${t.description} (${t.usage})`).join("\n");
    addMessageDOM("system", `Tools available:\n${lines}`);
    return;
  }
  if (intent) {
    visualization.set("thinking");
    addToolDOM(intent.tool, intent.arg);
    try {
      const result = await runTool(intent.tool, intent.arg);
      toolNote = `## Tool result (${intent.tool})\nInput: ${intent.arg || "—"}\nOutput: ${JSON.stringify(result, null, 2)}`;
      addToolResultDOM(result);
      $("#d-tools").textContent = "1";
      // explicit slash-commands stop here unless the user phrased a question.
      if (intent.explicit && !/\?/.test(text)) {
        visualization.set("idle");
        return;
      }
    } catch (err) {
      addToolResultDOM({ error: err.message });
      $("#d-tools").textContent = "1";
      visualization.set("idle");
      return;
    }
  }

  const bodyEl = addMessageDOM("zero", "");
  bodyEl.classList.add("cursor");

  visualization.set("thinking");
  const t0 = performance.now();
  if (!intent) $("#d-tools").textContent = "0";
  $("#d-cap").textContent = "available";

  const { messages: payload, layers, usedWikiIds, stats: cstats } = buildContext({
    system: SYSTEM_PROMPT,
    history: state.history,
    userRequest: text,
  });
  if (toolNote) {
    // inject right before the latest user turn
    payload.splice(payload.length - 1, 0, { role: "system", content: toolNote });
    layers.push("L5·tool");
  }
  $("#d-ctx").textContent = `${cstats.chars} ch`;
  $("#d-tokens").textContent = `~${cstats.tokens}`;
  $("#d-layers").textContent = layers.join(", ");

  state.abort = new AbortController();
  let acc = "";
  try {
    let first = true;
    for await (const chunk of state.provider.stream(payload, { signal: state.abort.signal })) {
      if (first) {
        visualization.set("streaming");
        first = false;
      }
      acc += chunk;
      bodyEl.textContent = acc;
      $("#messages").scrollTop = $("#messages").scrollHeight;
    }
    bodyEl.classList.remove("cursor");
    state.history.push({ role: "assistant", content: acc });
    await messages.add({ role: "assistant", content: acc });
    visualization.set("idle");
    // post-turn: reinforce used wiki entries, then scan for new captures
    wiki.markUsed(usedWikiIds).catch(() => { });
    wiki.ingest({ userText: text, assistantText: acc }).catch(() => { });
  } catch (err) {
    bodyEl.classList.remove("cursor");
    bodyEl.textContent = acc + `\n\n[error] ${err.message}`;
    visualization.set("error");
    setTimeout(() => visualization.set("idle"), 1600);
  } finally {
    $("#d-latency").textContent = `${Math.round(performance.now() - t0)}ms`;
    state.abort = null;
  }
}

function addMessageDOM(role, content) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;
  const r = document.createElement("div");
  r.className = "role";
  r.textContent = role === "zero" ? "zero" : role;
  const b = document.createElement("div");
  b.className = "body";
  b.textContent = content;
  wrap.append(r, b);
  $("#messages").append(wrap);
  $("#messages").scrollTop = $("#messages").scrollHeight;
  return b;
}

function addToolDOM(name, arg) {
  const wrap = document.createElement("div");
  wrap.className = "tool-msg";
  const head = document.createElement("div");
  head.className = "tool-head";
  head.textContent = `tool · ${name}`;
  const a = document.createElement("code");
  a.className = "tool-arg";
  a.textContent = arg || "—";
  wrap.append(head, a);
  $("#messages").append(wrap);
  $("#messages").scrollTop = $("#messages").scrollHeight;
}

function addToolResultDOM(result) {
  const wrap = document.createElement("div");
  wrap.className = "tool-msg result";
  const head = document.createElement("div");
  head.className = "tool-head";
  head.textContent = result?.error ? "result · error" : "result";
  const pre = document.createElement("pre");
  pre.className = "tool-out";
  pre.textContent = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  wrap.append(head, pre);
  $("#messages").append(wrap);
  $("#messages").scrollTop = $("#messages").scrollHeight;
}

function updateWikiStat() {
  const el = document.getElementById("d-wiki");
  if (!el) return;
  const pending = wiki.pending().length;
  el.textContent = `${wiki.entries().length}${pending ? ` (+${pending})` : ""}`;
}

function updateCapStat() {
  const el = document.getElementById("d-cap");
  if (!el) return;
  const p = cap.getPending();
  el.textContent = p ? `pending: ${p.actions.length}` : "available";
}

boot();
