// Zero — Memory view. Tabbed: Working Memory + LLM Wiki.
import * as wm from "./working-memory.js";
import { mountWikiView } from "./wiki-view.js";

export function mountMemoryView(root) {
    root.innerHTML = "";
    root.classList.add("memory-root");

    const tabs = document.createElement("div");
    tabs.className = "mem-tabs";
    const tWorking = tab("Working", true);
    const tWiki = tab("Wiki");
    tabs.append(tWorking, tWiki);

    const pane = document.createElement("div");
    pane.className = "mem-pane";

    root.append(tabs, pane);

    const show = (which) => {
        tWorking.classList.toggle("active", which === "working");
        tWiki.classList.toggle("active", which === "wiki");
        if (which === "working") mountWorking(pane);
        else mountWikiView(pane);
    };
    tWorking.addEventListener("click", () => show("working"));
    tWiki.addEventListener("click", () => show("wiki"));
    show("working");
}

function tab(label, active = false) {
    const b = document.createElement("button");
    b.className = "mem-tab" + (active ? " active" : "");
    b.textContent = label;
    return b;
}

function mountWorking(root) {
    root.innerHTML = "";
    root.classList.add("memory-view");
    const cur = wm.get();

    root.append(
        section("Goal", textarea("goal", cur.goal, "What is Zero working toward?")),
        section("Project", input("project", cur.project, "Project name")),
        section("Active task", input("task", cur.task, "What is happening right now?")),
        section("Constraints", listEditor("constraints", cur.constraints, "Add constraint")),
        section("Relevant files", listEditor("files", cur.files, "Add file or label")),
        section("Recent decisions", decisionList(cur.decisions)),
        actions(root),
    );

    wm.subscribe((next) => {
        const dl = root.querySelector('[data-field="decisions"]');
        if (dl) {
            const replacement = decisionList(next.decisions);
            dl.replaceWith(replacement);
        }
    });
}

function section(label, child) {
    const wrap = document.createElement("div");
    wrap.className = "wm-section";
    const l = document.createElement("label");
    l.textContent = label;
    wrap.append(l, child);
    return wrap;
}

function input(field, value, placeholder) {
    const el = document.createElement("input");
    el.type = "text";
    el.value = value || "";
    el.placeholder = placeholder;
    el.addEventListener("change", () => wm.update({ [field]: el.value.trim() }));
    return el;
}

function textarea(field, value, placeholder) {
    const el = document.createElement("textarea");
    el.value = value || "";
    el.placeholder = placeholder;
    el.rows = 2;
    el.addEventListener("change", () => wm.update({ [field]: el.value.trim() }));
    return el;
}

function listEditor(field, items, placeholder) {
    const wrap = document.createElement("div");
    wrap.className = "wm-list";
    const render = () => {
        wrap.innerHTML = "";
        const current = wm.get()[field] || [];
        for (let i = 0; i < current.length; i++) {
            const row = document.createElement("div");
            row.className = "wm-item";
            const txt = document.createElement("span");
            txt.textContent = current[i];
            const rm = document.createElement("button");
            rm.textContent = "×";
            rm.addEventListener("click", async () => {
                const next = current.slice();
                next.splice(i, 1);
                await wm.update({ [field]: next });
                render();
            });
            row.append(txt, rm);
            wrap.append(row);
        }
        const addRow = document.createElement("form");
        addRow.className = "wm-add";
        const inp = document.createElement("input");
        inp.placeholder = placeholder;
        const btn = document.createElement("button");
        btn.textContent = "+";
        addRow.append(inp, btn);
        addRow.addEventListener("submit", async (e) => {
            e.preventDefault();
            const v = inp.value.trim();
            if (!v) return;
            const next = [...(wm.get()[field] || []), v];
            await wm.update({ [field]: next });
            render();
        });
        wrap.append(addRow);
    };
    render();
    return wrap;
}

function decisionList(decisions) {
    const wrap = document.createElement("div");
    wrap.className = "wm-decisions";
    wrap.dataset.field = "decisions";
    if (!decisions?.length) {
        const p = document.createElement("p");
        p.className = "wm-empty";
        p.textContent = "No decisions recorded yet.";
        wrap.append(p);
        return wrap;
    }
    for (const d of decisions.slice().reverse()) {
        const row = document.createElement("div");
        row.className = "wm-decision";
        const t = document.createElement("time");
        t.textContent = new Date(d.ts).toLocaleString();
        const b = document.createElement("span");
        b.textContent = d.text;
        row.append(t, b);
        wrap.append(row);
    }
    return wrap;
}

function actions(root) {
    const wrap = document.createElement("div");
    wrap.className = "wm-actions";
    const clear = document.createElement("button");
    clear.className = "ghost";
    clear.textContent = "Clear working memory";
    clear.addEventListener("click", async () => {
        if (!confirm("Clear all working memory?")) return;
        await wm.clear();
        mountWorking(root);
    });
    wrap.append(clear);
    return wrap;
}
