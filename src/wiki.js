// Zero — LLM Wiki. Long-term, durable memory with capture + scoring + retrieval.
//
// Lifecycle:
//   1. After each conversation turn, ingest() scans for capture-worthy text.
//      Explicit signals ("remember", "note that", "save this", "I prefer", "my name is")
//      promote candidates directly to accepted entries. Softer signals queue
//      them for user review in the Wiki panel.
//   2. retrieve(query) returns the top-k accepted entries lexically relevant
//      to the request, used by the Context Engine as Layer 4.
//   3. All scoring is local + deterministic. A model-backed re-ranker can
//      replace `score()` and `extractCandidates()` later — interface is stable.
//
// Storage:
//   - `wiki` IDB collection: accepted entries
//     { id, text, kind, tags, score, hits, ts, lastUsed, source }
//   - kv["wiki:candidates"]: array of pending candidates
//     { text, kind, ts, source, reason }

import { collection, kv } from "./storage.js";

const wiki = collection("wiki");
const CAND_KEY = "wiki:candidates";

let cache = []; // accepted entries in memory
let candidates = [];
const listeners = new Set();

export async function load() {
    cache = (await wiki.all()) || [];
    candidates = (await kv.get(CAND_KEY)) || [];
}

export function entries() {
    return cache.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
export function pending() {
    return candidates.slice();
}

export function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
function emit() { for (const fn of listeners) fn(); }

// ─── ingest ────────────────────────────────────────────
// Called after every completed assistant turn.
export async function ingest({ userText, assistantText }) {
    const found = extractCandidates(userText, assistantText);
    if (!found.length) return;

    const accepted = [];
    const queued = [];
    for (const c of found) {
        if (await isDuplicate(c.text)) continue;
        if (c.confidence >= 0.75) accepted.push(c);
        else queued.push(c);
    }
    for (const c of accepted) await acceptInternal(c);
    if (queued.length) {
        candidates = [...candidates, ...queued].slice(-50);
        await kv.set(CAND_KEY, candidates);
    }
    if (accepted.length || queued.length) emit();
}

// ─── extract ───────────────────────────────────────────
// Heuristic, deterministic, cheap. Triggers a capture when:
//   - explicit verbs: remember/note/save/log/record
//   - first-person stable facts: "my name is", "I prefer", "I am a", "I use", "we use"
//   - decisions framed by assistant ("Decided: …", "Plan: …") — soft.
function extractCandidates(userText = "", assistantText = "") {
    const out = [];
    const push = (text, kind, confidence, source, reason) => {
        const t = text.trim().replace(/\s+/g, " ");
        if (t.length < 6 || t.length > 240) return;
        out.push({ text: t, kind, confidence, ts: Date.now(), source, reason });
    };

    // explicit user commands
    const explicit = userText.match(
        /(?:remember|note|save|log|record)(?:\s+that)?[:,]?\s+(.{6,200})/i,
    );
    if (explicit) push(explicit[1], "fact", 0.95, "user", "explicit:remember");

    // first-person stable facts
    const patterns = [
        [/\bmy name is\s+([A-Z][\w .'-]{1,40})/i, "identity", 0.9],
        [/\bI(?:'m| am)\s+(?:a|an)\s+([\w][\w \-/]{2,60})/i, "identity", 0.7],
        [/\bI prefer\s+(.{4,120})/i, "preference", 0.8],
        [/\bI (?:like|love|hate|avoid)\s+(.{4,120})/i, "preference", 0.7],
        [/\bwe use\s+(.{4,120})/i, "stack", 0.75],
        [/\b(?:our|the) (?:stack|project) (?:is|uses)\s+(.{4,120})/i, "stack", 0.8],
        [/\bdeadline (?:is|on)\s+(.{3,80})/i, "constraint", 0.85],
    ];
    for (const [re, kind, conf] of patterns) {
        const m = userText.match(re);
        if (m) push(m[0], kind, conf, "user", `pattern:${kind}`);
    }

    // assistant-stated decisions (soft — always reviewed)
    for (const m of assistantText.matchAll(/(?:^|\n)\s*(?:Decision|Decided|Plan)[:\-]\s*(.{6,200})/gi)) {
        push(m[1], "decision", 0.5, "assistant", "decision-line");
    }

    return out;
}

async function isDuplicate(text) {
    const norm = normalize(text);
    return cache.some((e) => normalize(e.text) === norm);
}
function normalize(s) {
    return s.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
}

// ─── scoring ───────────────────────────────────────────
function score(entry, all = cache) {
    // novelty: penalized by lexical overlap with other entries
    const tks = new Set(tokens(entry.text));
    let overlap = 0;
    for (const e of all) {
        if (e.id === entry.id) continue;
        const o = tokens(e.text).filter((t) => tks.has(t)).length;
        overlap += o;
    }
    const novelty = 1 / (1 + overlap / 8);
    const specificity = Math.min(1, tks.size / 12);
    const usefulness = Math.min(1, (entry.hits || 0) / 5);
    const ageDays = (Date.now() - (entry.ts || 0)) / 86400000;
    const freshness = 1 / (1 + ageDays / 30);
    return +(novelty * 0.35 + specificity * 0.3 + usefulness * 0.2 + freshness * 0.15).toFixed(3);
}
function tokens(s) {
    return (s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
}

// ─── accept / reject / manual ─────────────────────────
async function acceptInternal(c) {
    const entry = {
        text: c.text,
        kind: c.kind || "fact",
        tags: c.tags || [],
        hits: 0,
        ts: Date.now(),
        lastUsed: 0,
        source: c.source || "manual",
        score: 0,
    };
    entry.score = score(entry);
    const id = await wiki.add(entry);
    entry.id = id;
    cache.push(entry);
}

export async function acceptCandidate(index) {
    const c = candidates[index];
    if (!c) return;
    candidates.splice(index, 1);
    await kv.set(CAND_KEY, candidates);
    await acceptInternal(c);
    emit();
}

export async function rejectCandidate(index) {
    candidates.splice(index, 1);
    await kv.set(CAND_KEY, candidates);
    emit();
}

export async function addManual(text, kind = "fact") {
    if (!text?.trim()) return;
    if (await isDuplicate(text)) return;
    await acceptInternal({ text: text.trim(), kind, source: "manual" });
    emit();
}

export async function remove(id) {
    await wiki.del(id);
    cache = cache.filter((e) => e.id !== id);
    emit();
}

// ─── retrieval ─────────────────────────────────────────
export function retrieve(query, k = 5) {
    if (!cache.length || !query) return [];
    const q = new Set(tokens(query));
    if (!q.size) return [];
    const scored = [];
    for (const e of cache) {
        const matches = tokens(e.text).filter((t) => q.has(t)).length;
        if (!matches) continue;
        const rel = matches / Math.max(4, tokens(e.text).length);
        scored.push({ entry: e, rel: rel + (e.score || 0) * 0.2 });
    }
    scored.sort((a, b) => b.rel - a.rel);
    return scored.slice(0, k).map((s) => s.entry);
}

// Call after a turn used these entries — boosts hits/freshness.
export async function markUsed(ids) {
    if (!ids?.length) return;
    for (const id of ids) {
        const e = cache.find((x) => x.id === id);
        if (!e) continue;
        e.hits = (e.hits || 0) + 1;
        e.lastUsed = Date.now();
        e.score = score(e);
        await wiki.put(e);
    }
}

export function asPrompt(items) {
    if (!items?.length) return "";
    return items.map((e) => `- (${e.kind}) ${e.text}`).join("\n");
}
