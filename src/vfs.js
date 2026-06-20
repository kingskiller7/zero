// Zero — Virtual File System. Sandboxed, IndexedDB-backed.
//
// Records: { id: absolutePath, type: 'dir'|'file', content: string, ts: number }
// Root '/' is implicit (always exists). Paths are POSIX-like.

import { collection } from "./storage.js";

const files = collection("files");
const tree = new Map(); // path → record (in-memory cache)
const subs = new Set();
let cwd = "/";

export async function load() {
    const all = await files.all();
    tree.clear();
    for (const rec of all) tree.set(rec.id, rec);
    // ensure root exists
    if (!tree.has("/")) await write("/", { type: "dir", content: "" });
}

export function subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
}
function notify() { for (const fn of subs) try { fn(); } catch { } }

export function getCwd() { return cwd; }
export function setCwd(p) {
    const abs = resolve(p);
    const rec = tree.get(abs);
    if (!rec) throw new Error(`no such directory: ${abs}`);
    if (rec.type !== "dir") throw new Error(`not a directory: ${abs}`);
    cwd = abs;
    return cwd;
}

export function resolve(p) {
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

function parent(p) {
    if (p === "/") return null;
    const i = p.lastIndexOf("/");
    return i <= 0 ? "/" : p.slice(0, i);
}
function basename(p) {
    if (p === "/") return "/";
    return p.slice(p.lastIndexOf("/") + 1);
}

async function write(path, { type, content = "" }) {
    const rec = { id: path, type, content, ts: Date.now() };
    tree.set(path, rec);
    await files.put(rec);
    notify();
    return rec;
}

export function stat(p) {
    return tree.get(resolve(p)) || null;
}

export function list(p = cwd) {
    const abs = resolve(p);
    const rec = tree.get(abs);
    if (!rec) throw new Error(`no such path: ${abs}`);
    if (rec.type !== "dir") return [rec];
    const prefix = abs === "/" ? "/" : abs + "/";
    const out = [];
    for (const r of tree.values()) {
        if (r.id === abs) continue;
        if (!r.id.startsWith(prefix)) continue;
        const rest = r.id.slice(prefix.length);
        if (rest.includes("/")) continue; // deeper
        out.push(r);
    }
    return out.sort((a, b) => (a.type === b.type ? a.id.localeCompare(b.id) : a.type === "dir" ? -1 : 1));
}

export async function mkdir(p, { recursive = false } = {}) {
    const abs = resolve(p);
    if (tree.has(abs)) {
        if (tree.get(abs).type === "dir") return;
        throw new Error(`exists and is a file: ${abs}`);
    }
    const par = parent(abs);
    if (par && !tree.has(par)) {
        if (recursive) await mkdir(par, { recursive: true });
        else throw new Error(`parent does not exist: ${par}`);
    }
    await write(abs, { type: "dir" });
}

export async function touch(p) {
    const abs = resolve(p);
    if (tree.has(abs)) {
        const r = tree.get(abs);
        r.ts = Date.now();
        await files.put(r);
        notify();
        return;
    }
    const par = parent(abs);
    if (par && !tree.has(par)) throw new Error(`parent does not exist: ${par}`);
    await write(abs, { type: "file", content: "" });
}

export async function writeFile(p, content) {
    const abs = resolve(p);
    const existing = tree.get(abs);
    if (existing && existing.type === "dir") throw new Error(`is a directory: ${abs}`);
    const par = parent(abs);
    if (par && !tree.has(par)) throw new Error(`parent does not exist: ${par}`);
    await write(abs, { type: "file", content });
}

export async function appendFile(p, content) {
    const abs = resolve(p);
    const existing = tree.get(abs);
    const prev = existing && existing.type === "file" ? existing.content : "";
    await writeFile(abs, prev + content);
}

export function readFile(p) {
    const abs = resolve(p);
    const r = tree.get(abs);
    if (!r) throw new Error(`no such file: ${abs}`);
    if (r.type !== "file") throw new Error(`is a directory: ${abs}`);
    return r.content;
}

export async function rm(p, { recursive = false } = {}) {
    const abs = resolve(p);
    if (abs === "/") throw new Error("refusing to remove root");
    const rec = tree.get(abs);
    if (!rec) throw new Error(`no such path: ${abs}`);
    if (rec.type === "dir") {
        const children = list(abs);
        if (children.length && !recursive) throw new Error(`directory not empty: ${abs}`);
        // remove subtree
        const prefix = abs + "/";
        for (const id of [...tree.keys()]) {
            if (id === abs || id.startsWith(prefix)) {
                tree.delete(id);
                await files.del(id);
            }
        }
    } else {
        tree.delete(abs);
        await files.del(abs);
    }
    if (cwd === abs || cwd.startsWith(abs + "/")) cwd = "/";
    notify();
}

export async function mv(src, dst) {
    const a = resolve(src), b = resolve(dst);
    const rec = tree.get(a);
    if (!rec) throw new Error(`no such path: ${a}`);
    if (a === "/") throw new Error("cannot move root");
    // if dst is an existing directory, place inside
    let target = b;
    const dstRec = tree.get(b);
    if (dstRec && dstRec.type === "dir") target = (b === "/" ? "" : b) + "/" + basename(a);
    if (tree.has(target)) throw new Error(`target exists: ${target}`);
    // move subtree
    const prefix = a === "/" ? "/" : a + "/";
    const moves = [];
    for (const [id, r] of tree.entries()) {
        if (id === a) moves.push([id, target, r]);
        else if (id.startsWith(prefix)) moves.push([id, target + id.slice(a.length), r]);
    }
    for (const [oldId] of moves) { tree.delete(oldId); await files.del(oldId); }
    for (const [, newId, r] of moves) {
        const nr = { ...r, id: newId, ts: Date.now() };
        tree.set(newId, nr); await files.put(nr);
    }
    notify();
}

export async function cp(src, dst) {
    const a = resolve(src);
    const rec = tree.get(a);
    if (!rec) throw new Error(`no such path: ${a}`);
    if (rec.type !== "file") throw new Error(`cp supports files only: ${a}`);
    let b = resolve(dst);
    const dstRec = tree.get(b);
    if (dstRec && dstRec.type === "dir") b = (b === "/" ? "" : b) + "/" + basename(a);
    await writeFile(b, rec.content);
}

export function find(query, { from = "/" } = {}) {
    const root = resolve(from);
    const out = [];
    const q = query.toLowerCase();
    for (const r of tree.values()) {
        if (r.id !== root && !r.id.startsWith(root === "/" ? "/" : root + "/")) continue;
        if (basename(r.id).toLowerCase().includes(q)) out.push(r);
    }
    return out;
}

export function grep(pattern, p = cwd, { recursive = true } = {}) {
    let re;
    try { re = new RegExp(pattern, "i"); } catch { throw new Error(`bad pattern: ${pattern}`); }
    const abs = resolve(p);
    const rec = tree.get(abs);
    if (!rec) throw new Error(`no such path: ${abs}`);
    const targets = rec.type === "file" ? [rec] : tree.values();
    const prefix = abs === "/" ? "/" : abs + "/";
    const out = [];
    for (const r of targets) {
        if (r.type !== "file") continue;
        if (rec.type === "dir") {
            if (r.id !== abs && !r.id.startsWith(prefix)) continue;
            if (!recursive && parent(r.id) !== abs) continue;
        }
        const lines = r.content.split("\n");
        lines.forEach((line, i) => {
            if (re.test(line)) out.push({ path: r.id, line: i + 1, text: line });
        });
    }
    return out;
}

export function tree_(p = "/") {
    const abs = resolve(p);
    const rec = tree.get(abs);
    if (!rec) throw new Error(`no such path: ${abs}`);
    const lines = [];
    const walk = (path, depth) => {
        const indent = "  ".repeat(depth);
        const name = path === "/" ? "/" : basename(path);
        const r = tree.get(path);
        lines.push(`${indent}${name}${r.type === "dir" ? "/" : ""}`);
        if (r.type === "dir") {
            for (const child of list(path)) walk(child.id, depth + 1);
        }
    };
    walk(abs, 0);
    return lines.join("\n");
}

export function snapshot() {
    return [...tree.values()].map((r) => ({ path: r.id, type: r.type, size: r.content?.length ?? 0 }));
}
