// Zero — Context Engine. Progressive, layered context assembly.
//
// Layer 1: System prompt + user request (always)
// Layer 2: Recent conversation (always, capped)
// Layer 3: Working memory (if non-empty + relevant)
// Layer 4: LLM Wiki — top-k relevant long-term entries
// Layer 5: Relevant files — step 4
//
// We never inject everything. Each layer is gated by relevance/size.

import * as wm from "./working-memory.js";
import * as wiki from "./wiki.js";

const RECENT_TURNS = 12;
const SUMMARY_THRESHOLD = 30;

export function buildContext({ system, history, userRequest }) {
  const layers = [];
  const messages = [];
  const usedWikiIds = [];

  // L1
  messages.push({ role: "system", content: system });
  layers.push("L1");

  // L3 — working memory
  const wmText = wm.asPrompt();
  if (wmText && isRelevant(userRequest, wmText)) {
    messages.push({ role: "system", content: `## Working Memory\n${wmText}` });
    layers.push("L3");
  }

  // L4 — LLM Wiki (top-k relevant)
  const hits = wiki.retrieve(userRequest, 5);
  if (hits.length) {
    messages.push({
      role: "system",
      content: `## Known facts (from prior conversations)\n${wiki.asPrompt(hits)}`,
    });
    layers.push(`L4×${hits.length}`);
    for (const h of hits) usedWikiIds.push(h.id);
  }

  // L2 — recent conversation
  let trimmed;
  if (history.length > SUMMARY_THRESHOLD) {
    const older = history.slice(0, -RECENT_TURNS);
    messages.push({
      role: "system",
      content: `## Earlier conversation (summary)\n${summarize(older)}`,
    });
    trimmed = history.slice(-RECENT_TURNS);
    layers.push("L2*");
  } else {
    trimmed = history.slice(-RECENT_TURNS);
    layers.push("L2");
  }
  messages.push(...trimmed);

  return { messages, layers, usedWikiIds, stats: stats(messages) };
}

function isRelevant(query, text) {
  if (!query) return true;
  const q = new Set(tokens(query));
  for (const t of tokens(text)) if (q.has(t)) return true;
  return /Goal:/.test(text);
}
function tokens(s) {
  return (s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
}
function summarize(turns) {
  return turns
    .map((m) => {
      const head = m.content.slice(0, 140).replace(/\s+/g, " ");
      return `- ${m.role}: ${head}${m.content.length > 140 ? "…" : ""}`;
    })
    .join("\n");
}
function stats(messages) {
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  return { chars, tokens: Math.ceil(chars / 4), count: messages.length };
}
