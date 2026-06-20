// Zero — Capability/Self-Edit UI. Renders pending plan, diff, and history.
import * as cap from "./capability.js";

export function mountCapabilityView(root) {
    root.classList.add("cap-view");
    root.innerHTML = `
    <header class="cap-head">
      <h2>Capability</h2>
      <p class="cap-sub">Propose a sandboxed action; review the diff; approve to apply.</p>
    </header>
    <form id="cap-form" class="cap-form" autocomplete="off">
      <textarea id="cap-input" rows="3" placeholder="e.g. create folder notes; write notes/todo.txt with: buy milk"></textarea>
      <div class="row">
        <button type="submit" class="primary">Propose plan</button>
        <span id="cap-status" class="status"></span>
      </div>
    </form>
    <div id="cap-pending" class="cap-pending"></div>
    <h3 class="cap-h3">History</h3>
    <div id="cap-history" class="cap-history"></div>
  `;

    const input = root.querySelector("#cap-input");
    const status = root.querySelector("#cap-status");
    const pendingEl = root.querySelector("#cap-pending");
    const historyEl = root.querySelector("#cap-history");

    root.querySelector("#cap-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        status.textContent = "";
        try {
            const plan = cap.propose(text);
            if (!plan) {
                status.textContent = "no actionable steps parsed";
                status.classList.add("err");
            } else {
                status.textContent = `${plan.actions.length} action(s)`;
                status.classList.remove("err");
                input.value = "";
            }
        } catch (err) {
            status.textContent = err.message;
            status.classList.add("err");
        }
    });

    const render = () => {
        renderPending(pendingEl, cap.getPending());
        renderHistory(historyEl, cap.getHistory());
    };
    render();
    cap.subscribe(render);
}

function renderPending(el, plan) {
    if (!plan) { el.innerHTML = `<div class="cap-empty">No pending plan.</div>`; return; }
    const { changes, errors } = cap.diff(plan);
    el.innerHTML = `
    <div class="cap-plan">
      <header>
        <span class="cap-tag">pending</span>
        <span class="cap-intent">${escape(plan.intent)}</span>
      </header>
      <div class="cap-actions">
        ${plan.actions.map((a) => `<div class="cap-action">· ${escape(cap.describe(a))}</div>`).join("")}
      </div>
      ${errors.length ? `<div class="cap-errs">${errors.map((e) => `<div>⚠ ${escape(e.action)} — ${escape(e.error)}</div>`).join("")}</div>` : ""}
      <div class="cap-diff">${renderDiff(changes)}</div>
      <div class="row">
        <button class="primary" data-act="approve">Approve & apply</button>
        <button class="ghost" data-act="reject">Reject</button>
      </div>
    </div>
  `;
    el.querySelector('[data-act="approve"]').addEventListener("click", async () => {
        try { await cap.approve(plan.id); } catch (e) { alert(e.message); }
    });
    el.querySelector('[data-act="reject"]').addEventListener("click", () => {
        try { cap.reject(plan.id); } catch (e) { alert(e.message); }
    });
}

function renderHistory(el, items) {
    if (!items.length) { el.innerHTML = `<div class="cap-empty">No history yet.</div>`; return; }
    el.innerHTML = items.slice(0, 20).map((p) => `
    <div class="cap-hist">
      <span class="cap-tag ${p.status}">${p.status}</span>
      <span class="cap-when">${new Date(p.appliedAt ?? p.createdAt).toLocaleTimeString()}</span>
      <span class="cap-intent">${escape(p.intent)}</span>
      <span class="cap-count">${p.actions.length} action(s)</span>
    </div>
  `).join("");
}

function renderDiff(changes) {
    if (!changes.length) return `<div class="cap-empty">No filesystem changes.</div>`;
    return changes.map((c) => {
        if (c.type === "dir") {
            return `<div class="diff-block"><div class="diff-head ${c.kind}">${c.kind.toUpperCase()} dir ${escape(c.path)}</div></div>`;
        }
        const lines = c.kind === "add"
            ? (c.after || "").split("\n").map((t) => ({ kind: "add", text: t }))
            : c.kind === "delete"
                ? (c.before || "").split("\n").map((t) => ({ kind: "del", text: t }))
                : cap.lineDiff(c.before || "", c.after || "");
        return `
      <div class="diff-block">
        <div class="diff-head ${c.kind}">${c.kind.toUpperCase()} ${escape(c.path)}</div>
        <pre class="diff-body">${lines.map((l) => `<span class="dl ${l.kind}">${prefix(l.kind)}${escape(l.text)}</span>`).join("\n")}</pre>
      </div>
    `;
    }).join("");
}
function prefix(k) { return k === "add" ? "+ " : k === "del" ? "- " : "  "; }
function escape(s) { return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
