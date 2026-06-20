// Zero — Wiki view. Review candidates, browse + edit accepted long-term memory.
import * as wiki from "./wiki.js";

export function mountWikiView(root) {
    root.innerHTML = "";
    root.classList.add("wiki-view");

    const candWrap = document.createElement("section");
    candWrap.className = "wiki-section";
    const entryWrap = document.createElement("section");
    entryWrap.className = "wiki-section";
    const addWrap = document.createElement("section");
    addWrap.className = "wiki-section";

    root.append(candWrap, entryWrap, addWrap);

    const render = () => {
        renderCandidates(candWrap);
        renderEntries(entryWrap);
        renderAdd(addWrap);
    };
    render();
    const unsub = wiki.subscribe(render);
    // (no teardown hook — view is unmounted by hiding; fine for now)
    return unsub;
}

function header(text, badge) {
    const h = document.createElement("header");
    h.className = "wiki-h";
    const t = document.createElement("span");
    t.textContent = text;
    h.append(t);
    if (badge != null) {
        const b = document.createElement("span");
        b.className = "wiki-badge";
        b.textContent = badge;
        h.append(b);
    }
    return h;
}

function renderCandidates(root) {
    root.innerHTML = "";
    const cands = wiki.pending();
    root.append(header("Pending review", cands.length));
    if (!cands.length) {
        const p = document.createElement("p");
        p.className = "wm-empty";
        p.textContent = "No candidates queued.";
        root.append(p);
        return;
    }
    for (let i = 0; i < cands.length; i++) {
        const c = cands[i];
        const row = document.createElement("div");
        row.className = "wiki-cand";
        const meta = document.createElement("div");
        meta.className = "wiki-meta";
        meta.textContent = `${c.kind} · ${c.source} · ${c.reason}`;
        const txt = document.createElement("div");
        txt.className = "wiki-text";
        txt.textContent = c.text;
        const actions = document.createElement("div");
        actions.className = "wiki-actions";
        const accept = document.createElement("button");
        accept.className = "ghost";
        accept.textContent = "accept";
        accept.addEventListener("click", () => wiki.acceptCandidate(i));
        const reject = document.createElement("button");
        reject.className = "ghost";
        reject.textContent = "reject";
        reject.addEventListener("click", () => wiki.rejectCandidate(i));
        actions.append(accept, reject);
        row.append(meta, txt, actions);
        root.append(row);
    }
}

function renderEntries(root) {
    root.innerHTML = "";
    const items = wiki.entries();
    root.append(header("Long-term entries", items.length));
    if (!items.length) {
        const p = document.createElement("p");
        p.className = "wm-empty";
        p.textContent = "Nothing stored yet. Tell Zero to remember something.";
        root.append(p);
        return;
    }
    for (const e of items) {
        const row = document.createElement("div");
        row.className = "wiki-entry";
        const meta = document.createElement("div");
        meta.className = "wiki-meta";
        meta.textContent = `${e.kind} · score ${e.score?.toFixed?.(2) ?? "—"} · hits ${e.hits || 0}`;
        const txt = document.createElement("div");
        txt.className = "wiki-text";
        txt.textContent = e.text;
        const rm = document.createElement("button");
        rm.className = "wiki-rm";
        rm.textContent = "×";
        rm.title = "Forget";
        rm.addEventListener("click", () => {
            if (confirm("Forget this entry?")) wiki.remove(e.id);
        });
        row.append(meta, txt, rm);
        root.append(row);
    }
}

function renderAdd(root) {
    root.innerHTML = "";
    root.append(header("Add manually"));
    const form = document.createElement("form");
    form.className = "wiki-add";
    const inp = document.createElement("input");
    inp.placeholder = "A durable fact, preference, or constraint";
    const kind = document.createElement("select");
    for (const k of ["fact", "preference", "identity", "stack", "constraint", "decision"]) {
        const o = document.createElement("option");
        o.value = k;
        o.textContent = k;
        kind.append(o);
    }
    const btn = document.createElement("button");
    btn.className = "ghost";
    btn.textContent = "store";
    form.append(inp, kind, btn);
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        await wiki.addManual(inp.value, kind.value);
        inp.value = "";
    });
    root.append(form);
}
