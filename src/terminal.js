// Zero — shell command dispatcher over the VFS.
import * as vfs from "./vfs.js";

const COMMANDS = {};

function reg(name, { usage, desc, run }) {
    COMMANDS[name] = { name, usage, desc, run };
}

// argv parser: handles quoted strings.
export function parse(line) {
    const out = [];
    let cur = "";
    let quote = null;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) {
            if (c === quote) { quote = null; continue; }
            cur += c;
        } else if (c === '"' || c === "'") {
            quote = c;
        } else if (/\s/.test(c)) {
            if (cur) { out.push(cur); cur = ""; }
        } else cur += c;
    }
    if (cur) out.push(cur);
    return out;
}

export async function run(line) {
    const argv = parse(line);
    if (!argv.length) return { out: "" };
    const [cmd, ...args] = argv;
    const c = COMMANDS[cmd];
    if (!c) throw new Error(`unknown command: ${cmd} (try: help)`);
    const out = await c.run(args);
    return { out: out ?? "" };
}

export function listCommands() {
    return Object.values(COMMANDS).map((c) => ({ name: c.name, usage: c.usage, desc: c.desc }));
}

// ─── built-ins ───────────────────────────────────────────

reg("help", {
    usage: "help [cmd]",
    desc: "list commands or describe one",
    run: ([name]) => {
        if (name) {
            const c = COMMANDS[name];
            if (!c) throw new Error(`unknown: ${name}`);
            return `${c.usage}\n  ${c.desc}`;
        }
        return Object.values(COMMANDS)
            .map((c) => `${c.name.padEnd(8)} ${c.desc}`)
            .join("\n");
    },
});

reg("pwd", { usage: "pwd", desc: "print working directory", run: () => vfs.getCwd() });

reg("cd", {
    usage: "cd <path>",
    desc: "change directory",
    run: ([p]) => { vfs.setCwd(p ?? "/"); return ""; },
});

reg("ls", {
    usage: "ls [path] [-l]",
    desc: "list directory entries",
    run: (args) => {
        const long = args.includes("-l");
        const path = args.find((a) => !a.startsWith("-"));
        const items = vfs.list(path);
        if (!items.length) return "";
        if (!long) {
            return items.map((r) => r.id.split("/").pop() + (r.type === "dir" ? "/" : "")).join("  ");
        }
        return items.map((r) => {
            const n = r.id.split("/").pop() + (r.type === "dir" ? "/" : "");
            const size = r.type === "file" ? String(r.content.length).padStart(6) : "     -";
            const dt = new Date(r.ts).toISOString().slice(0, 16).replace("T", " ");
            return `${r.type === "dir" ? "d" : "-"}  ${size}  ${dt}  ${n}`;
        }).join("\n");
    },
});

reg("tree", { usage: "tree [path]", desc: "recursive listing", run: ([p]) => vfs.tree_(p ?? vfs.getCwd()) });

reg("mkdir", {
    usage: "mkdir [-p] <path>",
    desc: "create directory",
    run: async (args) => {
        const recursive = args.includes("-p");
        const path = args.find((a) => !a.startsWith("-"));
        if (!path) throw new Error("usage: mkdir [-p] <path>");
        await vfs.mkdir(path, { recursive });
        return "";
    },
});

reg("touch", {
    usage: "touch <path>",
    desc: "create empty file or update timestamp",
    run: async ([p]) => { if (!p) throw new Error("usage: touch <path>"); await vfs.touch(p); return ""; },
});

reg("cat", {
    usage: "cat <file>",
    desc: "print file contents",
    run: ([p]) => { if (!p) throw new Error("usage: cat <file>"); return vfs.readFile(p); },
});

reg("write", {
    usage: 'write <file> "content"',
    desc: "overwrite file with content (use quotes)",
    run: async (args) => {
        const [p, ...rest] = args;
        if (!p) throw new Error('usage: write <file> "content"');
        await vfs.writeFile(p, rest.join(" "));
        return "";
    },
});

reg("append", {
    usage: 'append <file> "content"',
    desc: "append content to file",
    run: async (args) => {
        const [p, ...rest] = args;
        if (!p) throw new Error('usage: append <file> "content"');
        await vfs.appendFile(p, (rest.join(" ")) + "\n");
        return "";
    },
});

reg("echo", { usage: "echo <text>", desc: "print arguments", run: (args) => args.join(" ") });

reg("rm", {
    usage: "rm [-r] <path>",
    desc: "remove file or directory",
    run: async (args) => {
        const recursive = args.includes("-r") || args.includes("-rf");
        const path = args.find((a) => !a.startsWith("-"));
        if (!path) throw new Error("usage: rm [-r] <path>");
        await vfs.rm(path, { recursive });
        return "";
    },
});

reg("mv", {
    usage: "mv <src> <dst>",
    desc: "move/rename",
    run: async ([a, b]) => { if (!a || !b) throw new Error("usage: mv <src> <dst>"); await vfs.mv(a, b); return ""; },
});

reg("cp", {
    usage: "cp <src> <dst>",
    desc: "copy file",
    run: async ([a, b]) => { if (!a || !b) throw new Error("usage: cp <src> <dst>"); await vfs.cp(a, b); return ""; },
});

reg("find", {
    usage: "find <name> [from]",
    desc: "find paths whose name contains query",
    run: ([q, from]) => {
        if (!q) throw new Error("usage: find <name> [from]");
        const hits = vfs.find(q, { from: from ?? "/" });
        return hits.map((r) => r.id).join("\n") || "(no matches)";
    },
});

reg("grep", {
    usage: "grep <pattern> [path]",
    desc: "search for regex pattern in files",
    run: ([pat, p]) => {
        if (!pat) throw new Error("usage: grep <pattern> [path]");
        const hits = vfs.grep(pat, p ?? vfs.getCwd());
        return hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join("\n") || "(no matches)";
    },
});

reg("clear", { usage: "clear", desc: "clear terminal", run: () => "__CLEAR__" });

reg("stat", {
    usage: "stat <path>",
    desc: "show metadata",
    run: ([p]) => {
        if (!p) throw new Error("usage: stat <path>");
        const r = vfs.stat(p);
        if (!r) throw new Error(`no such path: ${p}`);
        return `path: ${r.id}\ntype: ${r.type}\nsize: ${r.content?.length ?? 0}\nmtime: ${new Date(r.ts).toISOString()}`;
    },
});
