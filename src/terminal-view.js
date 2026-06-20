// Zero — terminal UI. Pure DOM, line-based.
import { run as runCmd, listCommands } from "./terminal.js";
import * as vfs from "./vfs.js";

const HISTORY_KEY = "zero.term.history";

export function mountTerminalView(root) {
    root.classList.add("terminal-view");
    root.innerHTML = `
    <div class="term-output" id="term-out"></div>
    <form class="term-input-row" id="term-form" autocomplete="off">
      <span class="term-prompt" id="term-prompt">/ $</span>
      <input id="term-input" class="term-input" spellcheck="false" autocomplete="off" />
    </form>
  `;
    const out = root.querySelector("#term-out");
    const input = root.querySelector("#term-input");
    const promptEl = root.querySelector("#term-prompt");
    const form = root.querySelector("#term-form");

    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    let hIdx = history.length;

    const refreshPrompt = () => { promptEl.textContent = `${vfs.getCwd()} $`; };
    refreshPrompt();
    vfs.subscribe(refreshPrompt);

    const print = (text, cls = "") => {
        const div = document.createElement("div");
        div.className = `term-line ${cls}`.trim();
        div.textContent = text;
        out.append(div);
        out.scrollTop = out.scrollHeight;
    };

    // banner
    print("Zero terminal · type 'help' for commands", "dim");
    const names = listCommands().map((c) => c.name).join(" ");
    print(names, "dim");

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const line = input.value;
        if (!line.trim()) return;
        print(`${vfs.getCwd()} $ ${line}`, "cmd");
        input.value = "";
        history.push(line);
        if (history.length > 200) history.shift();
        hIdx = history.length;
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
        try {
            const { out: result } = await runCmd(line);
            if (result === "__CLEAR__") out.innerHTML = "";
            else if (result) print(result);
        } catch (err) {
            print(err.message, "err");
        }
        refreshPrompt();
    });

    input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowUp") {
            if (hIdx > 0) { hIdx--; input.value = history[hIdx] ?? ""; e.preventDefault(); }
        } else if (e.key === "ArrowDown") {
            if (hIdx < history.length) { hIdx++; input.value = history[hIdx] ?? ""; e.preventDefault(); }
        } else if (e.key === "Tab") {
            e.preventDefault();
            const v = input.value;
            const parts = v.split(/\s+/);
            const last = parts[parts.length - 1] ?? "";
            // command completion
            if (parts.length === 1) {
                const matches = listCommands().map((c) => c.name).filter((n) => n.startsWith(last));
                if (matches.length === 1) { parts[0] = matches[0]; input.value = parts.join(" ") + " "; }
                else if (matches.length > 1) print(matches.join("  "), "dim");
            } else {
                // path completion
                try {
                    const dir = last.includes("/") ? last.slice(0, last.lastIndexOf("/")) || "/" : vfs.getCwd();
                    const tail = last.includes("/") ? last.slice(last.lastIndexOf("/") + 1) : last;
                    const items = vfs.list(dir).map((r) => r.id.split("/").pop());
                    const matches = items.filter((n) => n.startsWith(tail));
                    if (matches.length === 1) {
                        const prefix = last.includes("/") ? last.slice(0, last.lastIndexOf("/") + 1) : "";
                        parts[parts.length - 1] = prefix + matches[0];
                        input.value = parts.join(" ");
                    } else if (matches.length > 1) print(matches.join("  "), "dim");
                } catch { }
            }
        }
    });

    // focus on click
    root.addEventListener("click", (e) => {
        if (e.target.tagName !== "INPUT") input.focus();
    });

    // focus when view becomes visible
    const obs = new MutationObserver(() => { if (!root.hidden) input.focus(); });
    obs.observe(root, { attributes: true, attributeFilter: ["hidden"] });
    if (!root.hidden) input.focus();
}
