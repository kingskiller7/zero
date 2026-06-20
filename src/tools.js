// Zero — Tool layer. Deterministic, pre-LLM execution.
//
// Tools run BEFORE the model call. Their output is injected as a system
// "Tool result" message so the LLM composes a natural reply using verified
// data instead of guessing. This keeps math/time/network answers correct
// and minimizes tokens (no function-calling round-trip).
//
// Intent detection is cheap and explicit:
//   - Slash commands: /calc, /http, /fetch, /time, /tools
//   - Natural patterns: bare arithmetic, "calculate …", "fetch <url>"
//
// Every tool is sandboxed: no eval of free-form code, no filesystem,
// network goes through fetch (subject to browser CORS).

export const tools = {
    calc: {
        name: "calc",
        description: "Evaluate a numeric expression (+ - * / % ** parentheses).",
        usage: "/calc 2+2*3",
        async run(expr) {
            const cleaned = String(expr).trim();
            if (!/^[\d\s+\-*/%().^e]+$/i.test(cleaned)) {
                throw new Error("only numbers and + - * / % ** ( ) are allowed");
            }
            const safe = cleaned.replace(/\^/g, "**");
            // eslint-disable-next-line no-new-func
            const value = Function(`"use strict"; return (${safe});`)();
            if (typeof value !== "number" || !Number.isFinite(value)) {
                throw new Error("expression did not evaluate to a finite number");
            }
            return { value, expression: cleaned };
        },
    },

    time: {
        name: "time",
        description: "Current local + UTC time.",
        usage: "/time",
        async run() {
            const d = new Date();
            return {
                local: d.toString(),
                iso: d.toISOString(),
                epoch_ms: d.getTime(),
                tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
            };
        },
    },

    http: {
        name: "http",
        description: "GET a URL and return JSON or text (subject to CORS).",
        usage: "/http https://api.example.com/x",
        async run(url) {
            const u = normalizeUrl(url);
            const r = await fetch(u, { method: "GET" });
            const ct = r.headers.get("content-type") || "";
            const body = ct.includes("application/json")
                ? await r.json()
                : (await r.text()).slice(0, 4000);
            return { url: u, status: r.status, contentType: ct, body };
        },
    },

    fetch: {
        name: "fetch",
        description: "Fetch a web page and return title + readable text.",
        usage: "/fetch https://example.com",
        async run(url) {
            const u = normalizeUrl(url);
            const r = await fetch(u);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const html = await r.text();
            const doc = new DOMParser().parseFromString(html, "text/html");
            doc.querySelectorAll("script,style,noscript,svg").forEach((n) => n.remove());
            const title = doc.querySelector("title")?.textContent?.trim() || "";
            const text = (doc.body?.innerText || doc.body?.textContent || "")
                .replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
            return { url: u, title, text: text.slice(0, 4000) };
        },
    },
};

function normalizeUrl(s) {
    const t = String(s).trim();
    if (!/^https?:\/\//i.test(t)) return `https://${t}`;
    return t;
}

// ─── intent detection ──────────────────────────────────
// Returns { tool, arg, explicit } or null.
export function detectIntent(text) {
    const s = text.trim();

    // explicit slash command
    const slash = s.match(/^\/(\w+)(?:\s+([\s\S]+))?$/);
    if (slash) {
        const name = slash[1].toLowerCase();
        if (tools[name]) return { tool: name, arg: slash[2] ?? "", explicit: true };
        if (name === "tools") return { tool: "__list", arg: "", explicit: true };
    }

    // natural patterns
    const calc = s.match(/^(?:calc(?:ulate)?|what(?:'s| is)|=)\s+([\d\s+\-*/%().^e]+)\??$/i);
    if (calc && /[+\-*/%^]/.test(calc[1])) return { tool: "calc", arg: calc[1], explicit: false };

    // bare arithmetic like "2+2" or "(3*4)/2"
    if (/^[\d\s+\-*/%().^e]+$/.test(s) && /[+\-*/%^]/.test(s) && s.length <= 80) {
        return { tool: "calc", arg: s, explicit: false };
    }

    // "fetch <url>" / "get <url>"
    const fetchM = s.match(/^(?:fetch|read|open)\s+(https?:\/\/\S+)/i);
    if (fetchM) return { tool: "fetch", arg: fetchM[1], explicit: false };
    const httpM = s.match(/^(?:get|http)\s+(https?:\/\/\S+)/i);
    if (httpM) return { tool: "http", arg: httpM[1], explicit: false };

    // "what time is it"
    if (/\bwhat\s+time\s+is\s+it\b/i.test(s) || /\bcurrent\s+time\b/i.test(s)) {
        return { tool: "time", arg: "", explicit: false };
    }

    return null;
}

export async function runTool(name, arg) {
    const t = tools[name];
    if (!t) throw new Error(`unknown tool: ${name}`);
    return await t.run(arg);
}

export function listTools() {
    return Object.values(tools);
}
