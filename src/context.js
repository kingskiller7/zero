// Zero — Context Engine. Progressive, layered context assembly.
//
// Layer 1: System prompt + user request (always)
// Layer 2: Recent conversation (always, capped)
// Layer 3: Working memory (if non-empty + relevant)
// Layer 4: Relevant long-term memory (Wiki) — step 3
// Layer 5: Relevant files — step 4
//
// We never inject everything. Each layer is gated by relevance/size.

import * as wm from "./working-memory.js";

const RECENT_TURNS = 12; // 6 user/assistant pairs
const SUMMARY_THRESHOLD = 30; // start summarizing when history exceeds this

export function buildContext({ system, history, userRequest }) {
  const layers = [];
  const messages = [];

  // L1
  messages.push({ role: "system", content: system });
  layers.push("L1");

  // L3 — working memory, included as part of the system block when present + relevant
  const wmText = wm.asPrompt();
  const wmRelevant = wmText && isRelevant(userRequest, wmText);
  if (wmRelevant) {
    messages.push({
      role: "system",
      content: `## Working Memory\n${wmText}`
    });
    layers.push("L3");
  }

  // L2 — recent conversation, with rolling summary of older turns
  let trimmed = history;
  if (history.length > SUMMARY_THRESHOLD) {
    const older = history.slice(0, -RECENT_TURNS);
    const summary = summarize(older);
    messages.push({
      role: "system",
      content: `## Earlier conversation (summary)\n${summary}`
    });
    trimmed = history.slice(-RECENT_TURNS);
    layers.push("L2*"); // summarized
  } else {
    trimmed = history.slice(-RECENT_TURNS);
    layers.push("L2");
  }
  messages.push(...trimmed);

  return { messages, layers, stats: stats(messages) };
}

function isRelevant(query, text) {
  // Cheap lexical relevance: any shared word ≥4 chars triggers inclusion.
  // The working-memory block is small, so the bar is intentionally low.
  if (!query) return true;
  const q = new Set(tokens(query));
  for (const t of tokens(text)) if (q.has(t)) return true;
  // Always include if working memory has a goal — it's the persistent driver.
  return /Goal:/.test(text);
}

function tokens(s) {
  return s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
}

function summarize(turns) {
  // Lightweight, deterministic structural summary. A model-based compactor can
  // replace this later — interface stays identical.
  const lines = turns.map((m) => {
    const head = m.content.slice(0, 140).replace(/\s+/g, " ");
    return `- ${m.role}: ${head}${m.content.length > 140 ? "…" : ""}`;
  });
  return lines.join("\n");
}

function stats(messages) {
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  return { chars, tokens: Math.ceil(chars / 4), count: messages.length };
}
