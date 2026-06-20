// Zero — Working Memory. Structured short-horizon state that drives long-running tasks.
import { kv } from "./storage.js";

const KEY = "working-memory";

const empty = () => ({
  goal: "",
  project: "",
  task: "",
  constraints: [], // string[]
  files: [], // string[]  (path or label)
  decisions: [], // { ts, text }[]
});

let cache = null;
const listeners = new Set();

export async function load() {
  cache = (await kv.get(KEY)) || empty();
  return cache;
}

export function get() {
  return cache || empty();
}

export async function update(patch) {
  cache = { ...(cache || empty()), ...patch };
  await kv.set(KEY, cache);
  emit();
  return cache;
}

export async function addDecision(text) {
  const wm = await load();
  wm.decisions = [...wm.decisions.slice(-19), { ts: Date.now(), text }];
  await kv.set(KEY, wm);
  cache = wm;
  emit();
}

export async function clear() {
  cache = empty();
  await kv.set(KEY, cache);
  emit();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of listeners) fn(cache);
}

// Render as a compact text block for system context.
export function asPrompt(wm = get()) {
  const lines = [];
  if (wm.goal) lines.push(`Goal: ${wm.goal}`);
  if (wm.project) lines.push(`Project: ${wm.project}`);
  if (wm.task) lines.push(`Active task: ${wm.task}`);
  if (wm.constraints?.length) lines.push(`Constraints:\n- ${wm.constraints.join("\n- ")}`);
  if (wm.files?.length) lines.push(`Relevant files: ${wm.files.join(", ")}`);
  if (wm.decisions?.length) {
    const recent = wm.decisions.slice(-3).map((d) => `- ${d.text}`).join("\n");
    lines.push(`Recent decisions:\n${recent}`);
  }
  return lines.length ? lines.join("\n\n") : "";
}

export function isEmpty(wm = get()) {
  return (
    !wm.goal && !wm.project && !wm.task &&
    !wm.constraints?.length && !wm.files?.length && !wm.decisions?.length
  );
}
