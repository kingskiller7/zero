// Zero — boot + orchestration.
import { kv, collection, init as initDB } from "./storage.js";
import { makeProvider, DEFAULT_MODELS } from "./provider.js";
import { viz } from "./viz.js";
import * as wm from "./working-memory.js";
import { buildContext } from "./context.js";
import { mountMemoryView } from "./memory-view.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const messages = collection("messages");

const state = {
  provider: null, // adapter
  config: null, // { provider, apiKey, model }
  history: [], // [{role, content}]
  abort: null
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
    ["init", "llm wiki", () => sleep(120)],
    ["load", "configuration", loadConfig]
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
  $(
    "#viz-model"
  ).textContent = `${state.config.provider} · ${state.config.model}`;
  $("#d-provider").textContent = state.config.provider;
  $("#d-model").textContent = state.config.model;
  visualization.set("idle");
  wireChat();
  wireNav();
  wireDevPanel();
  mountMemoryView(document.getElementById("view-memory"));
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
    for (const m of state.history)
      addMessageDOM(m.role === "assistant" ? "zero" : m.role, m.content);
  }
}

function wireNav() {
  $$(".rail-nav button").forEach((b) => {
    b.addEventListener("click", () => {
      $$(".rail-nav button").forEach((x) =>
        x.classList.toggle("active", x === b)
      );
      const view = b.dataset.view;
      for (const v of ["chat", "memory", "tools", "terminal"]) {
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

  const bodyEl = addMessageDOM("zero", "");
  bodyEl.classList.add("cursor");

  visualization.set("thinking");
  const t0 = performance.now();
  $("#d-tools").textContent = "0";
  $("#d-cap").textContent = "available";

  const { messages: payload, layers, stats: cstats } = buildContext({
    system: SYSTEM_PROMPT,
    history: state.history,
    userRequest: text
  });
  $("#d-ctx").textContent = `${cstats.chars} ch`;
  $("#d-tokens").textContent = `~${cstats.tokens}`;
  $("#d-layers").textContent = layers.join(", ");

  state.abort = new AbortController();
  let acc = "";
  try {
    let first = true;
    for await (const chunk of state.provider.stream(payload, {
      signal: state.abort.signal
    })) {
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

boot();