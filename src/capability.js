// Zero — Capability Engine.
//
// Turns a natural-language request into a Plan of sandboxed Actions
// against the VFS. Plans are executed only after explicit user approval.
//
// Action shapes:
//   { op: 'mkdir',  path, recursive? }
//   { op: 'write',  path, content }            // overwrite
//   { op: 'append', path, content }
//   { op: 'rm',     path, recursive? }
//   { op: 'mv',     from, to }
//   { op: 'cp',     from, to }
//
// A Plan is { id, intent, actions: Action[], rationale, createdAt, status }.

import * as vfs from "./vfs.js";

const subs = new Set();
let pending = null; // current pending Plan
const history = []; // executed plans

export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
function notify() { for (const fn of subs) try { fn(); } catch { } }

export function getPending() { return pending; }
export function getHistory() { return [...history]; }

// ─── propose ──────────────────────────────────────────
// Build a Plan from a natural-language request using simple imperative
// patterns. This is deterministic and offline — no model needed for the
// common cases. Extend by adding more matchers.
//
// Examples:
//   "create folder notes"
//   "write notes/todo.txt with: buy milk"
//   "delete notes/todo.txt"
//   "rename notes to journal"

export function propose(text) {
    const actions = [];
    const lines = text.split(/[\n;]+/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
        const a = parseLine(line);
        if (a) actions.push(...a);
    }
    if (!actions.length) return null;
    const plan = {
        id: "p" + Date.now().toString(36),
        intent: text.trim(),
        actions,
        rationale: explain(actions),
        createdAt: Date.now(),
        status: "pending",
    };
    pending = plan;
    notify();
    return plan;
}

// programmatic entry — used by the LLM bridge or self-edit later
export function proposePlan({ intent, actions, rationale }) {
    if (!actions?.length) return null;
    pending = {
        id: "p" + Date.now().toString(36),
        intent: intent ?? "(programmatic)",
        actions,
        rationale: rationale ?? explain(actions),
        createdAt: Date.now(),
        status: "pending",
    };
    notify();
    return pending;
}

function parseLine(line) {
    // create folder X / mkdir X
    let m = line.match(/^(?:create|make|new)\s+(?:folder|dir|directory)\s+(.+)$/i)
        || line.match(/^mkdir\s+(?:-p\s+)?(.+)$/i);
    if (m) return [{ op: "mkdir", path: m[1].trim(), recursive: /\s-p\s|\b-p\b/.test(line) || true }];

    // write FILE with: CONTENT  |  write FILE "content"
    m = line.match(/^(?:write|create file)\s+(\S+)\s+(?:with:?\s*)?["']?(.*)["']?$/i);
    if (m && !/^delete|^remove|^rm|^move|^rename|^copy/i.test(line)) {
        const path = m[1];
        const content = stripQuotes(m[2] ?? "");
        return [{ op: "write", path, content }];
    }

    // append "content" to FILE / append FILE "content"
    m = line.match(/^append\s+(?:["'](.+?)["']\s+to\s+)?(\S+)(?:\s+["'](.+?)["'])?$/i);
    if (m) {
        const path = m[2];
        const content = (m[1] ?? m[3] ?? "") + "\n";
        return [{ op: "append", path, content }];
    }

    // delete / remove / rm
    m = line.match(/^(?:delete|remove|rm)\s+(?:-r\s+)?(.+)$/i);
    if (m) return [{ op: "rm", path: m[1].trim(), recursive: /-r/.test(line) }];

    // rename A to B  /  mv A B
    m = line.match(/^(?:rename|move|mv)\s+(\S+)\s+(?:to\s+)?(\S+)$/i);
    if (m) return [{ op: "mv", from: m[1], to: m[2] }];

    // copy A to B
    m = line.match(/^(?:copy|cp)\s+(\S+)\s+(?:to\s+)?(\S+)$/i);
    if (m) return [{ op: "cp", from: m[1], to: m[2] }];

    return null;
}

function stripQuotes(s) {
    s = s.trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        return s.slice(1, -1);
    }
    return s;
}

function explain(actions) {
    return actions.map(describe).join("\n");
}
export function describe(a) {
    switch (a.op) {
        case "mkdir": return `create directory ${a.path}`;
        case "write": return `write ${a.path} (${a.content.length} chars)`;
        case "append": return `append to ${a.path} (${a.content.length} chars)`;
        case "rm": return `remove ${a.path}${a.recursive ? " (recursive)" : ""}`;
        case "mv": return `move ${a.from} → ${a.to}`;
        case "cp": return `copy ${a.from} → ${a.to}`;
        default: return `unknown ${a.op}`;
    }
}

// ─── diff ─────────────────────────────────────────────
// Dry-run a plan against a snapshot of the VFS to compute the diff
// that *would* result. Returns { changes: [{kind, path, before?, after?}], errors }.

export function diff(plan) {
    const before = snapshotMap();
    const after = new Map(before);
    const errors = [];

    for (const a of plan.actions) {
        try {
            applyToMap(after, a);
        } catch (e) {
            errors.push({ action: describe(a), error: e.message });
        }
    }

    const changes = [];
    // additions + modifications
    for (const [path, rec] of after) {
        const prev = before.get(path);
        if (!prev) changes.push({ kind: "add", path, type: rec.type, after: rec.content });
        else if (prev.content !== rec.content || prev.type !== rec.type) {
            changes.push({ kind: "modify", path, type: rec.type, before: prev.content, after: rec.content });
        }
    }
    // deletions
    for (const [path, prev] of before) {
        if (!after.has(path)) changes.push({ kind: "delete", path, type: prev.type, before: prev.content });
    }

    changes.sort((a, b) => a.path.localeCompare(b.path));
    return { changes, errors };
}

function snapshotMap() {
    const map = new Map();
    for (const r of vfs.snapshot()) {
        const real = vfs.stat(r.path);
        map.set(r.path, { type: real.type, content: real.content ?? "" });
    }
    return map;
}

function resolveIn(map, p, cwd = "/") {
    if (!p) return cwd;
    const base = p.startsWith("/") ? "/" : cwd;
    const parts = (base + "/" + p).split("/").filter(Boolean);
    const stack = [];
    for (const part of parts) {
        if (part === ".") continue;
        if (part === "..") stack.pop();
        else stack.push(part);
    }
    return "/" + stack.join("/");
}
function parentOf(p) { if (p === "/") return null; const i = p.lastIndexOf("/"); return i <= 0 ? "/" : p.slice(0, i); }
function baseOf(p) { return p === "/" ? "/" : p.slice(p.lastIndexOf("/") + 1); }

function applyToMap(map, a) {
    const cwd = vfs.getCwd();
    switch (a.op) {
        case "mkdir": {
            const abs = resolveIn(map, a.path, cwd);
            if (map.has(abs)) { if (map.get(abs).type === "dir") return; throw new Error(`exists as file: ${abs}`); }
            const par = parentOf(abs);
            if (par && !map.has(par)) {
                if (a.recursive) {
                    // create intermediate dirs
                    const parts = abs.split("/").filter(Boolean);
                    let cur = "";
                    for (const p of parts) {
                        cur += "/" + p;
                        if (!map.has(cur)) map.set(cur, { type: "dir", content: "" });
                    }
                    return;
                }
                throw new Error(`parent missing: ${par}`);
            }
            map.set(abs, { type: "dir", content: "" });
            return;
        }
        case "write": {
            const abs = resolveIn(map, a.path, cwd);
            const par = parentOf(abs);
            if (par && !map.has(par)) throw new Error(`parent missing: ${par}`);
            if (map.has(abs) && map.get(abs).type === "dir") throw new Error(`is a directory: ${abs}`);
            map.set(abs, { type: "file", content: a.content ?? "" });
            return;
        }
        case "append": {
            const abs = resolveIn(map, a.path, cwd);
            const prev = map.get(abs);
            if (prev && prev.type === "dir") throw new Error(`is a directory: ${abs}`);
            const par = parentOf(abs);
            if (par && !map.has(par)) throw new Error(`parent missing: ${par}`);
            map.set(abs, { type: "file", content: (prev?.content ?? "") + (a.content ?? "") });
            return;
        }
        case "rm": {
            const abs = resolveIn(map, a.path, cwd);
            if (abs === "/") throw new Error("refusing to remove root");
            if (!map.has(abs)) throw new Error(`no such path: ${abs}`);
            const rec = map.get(abs);
            if (rec.type === "dir") {
                const prefix = abs + "/";
                const children = [...map.keys()].filter((k) => k !== abs && k.startsWith(prefix));
                if (children.length && !a.recursive) throw new Error(`directory not empty: ${abs}`);
                for (const id of [abs, ...children]) map.delete(id);
            } else map.delete(abs);
            return;
        }
        case "mv": {
            const from = resolveIn(map, a.from, cwd);
            let to = resolveIn(map, a.to, cwd);
            if (!map.has(from)) throw new Error(`no such path: ${from}`);
            const dst = map.get(to);
            if (dst && dst.type === "dir") to = (to === "/" ? "" : to) + "/" + baseOf(from);
            if (map.has(to)) throw new Error(`target exists: ${to}`);
            const fromPrefix = from === "/" ? "/" : from + "/";
            const ops = [];
            for (const [id, r] of map) {
                if (id === from) ops.push([id, to, r]);
                else if (id.startsWith(fromPrefix)) ops.push([id, to + id.slice(from.length), r]);
            }
            for (const [oldId] of ops) map.delete(oldId);
            for (const [, newId, r] of ops) map.set(newId, r);
            return;
        }
        case "cp": {
            const from = resolveIn(map, a.from, cwd);
            const rec = map.get(from);
            if (!rec) throw new Error(`no such path: ${from}`);
            if (rec.type !== "file") throw new Error(`cp supports files only: ${from}`);
            let to = resolveIn(map, a.to, cwd);
            const dst = map.get(to);
            if (dst && dst.type === "dir") to = (to === "/" ? "" : to) + "/" + baseOf(from);
            map.set(to, { type: "file", content: rec.content });
            return;
        }
        default:
            throw new Error(`unknown op: ${a.op}`);
    }
}

// ─── approve / reject ─────────────────────────────────
export async function approve(planId) {
    if (!pending || pending.id !== planId) throw new Error("no matching pending plan");
    const plan = pending;
    const errs = [];
    for (const a of plan.actions) {
        try { await applyAction(a); }
        catch (e) { errs.push({ action: describe(a), error: e.message }); }
    }
    plan.status = errs.length ? "partial" : "applied";
    plan.errors = errs;
    plan.appliedAt = Date.now();
    history.unshift(plan);
    pending = null;
    notify();
    return plan;
}

export function reject(planId) {
    if (!pending || pending.id !== planId) throw new Error("no matching pending plan");
    pending.status = "rejected";
    history.unshift(pending);
    pending = null;
    notify();
}

async function applyAction(a) {
    switch (a.op) {
        case "mkdir": return vfs.mkdir(a.path, { recursive: true });
        case "write": return vfs.writeFile(a.path, a.content ?? "");
        case "append": return vfs.appendFile(a.path, a.content ?? "");
        case "rm": return vfs.rm(a.path, { recursive: !!a.recursive });
        case "mv": return vfs.mv(a.from, a.to);
        case "cp": return vfs.cp(a.from, a.to);
        default: throw new Error(`unknown op: ${a.op}`);
    }
}

// ─── line diff (for UI) ───────────────────────────────
export function lineDiff(before = "", after = "") {
    const a = before.split("\n");
    const b = after.split("\n");
    // simple LCS-based diff
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
        for (let j = m - 1; j >= 0; j--)
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) { out.push({ kind: "eq", text: a[i] }); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ kind: "del", text: a[i++] }); }
        else { out.push({ kind: "add", text: b[j++] }); }
    }
    while (i < n) out.push({ kind: "del", text: a[i++] });
    while (j < m) out.push({ kind: "add", text: b[j++] });
    return out;
}
