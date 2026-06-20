// Zero — Tools view. Lists available tools.
import { listTools } from "./tools.js";

export function mountToolsView(root) {
    root.innerHTML = "";
    root.classList.add("tools-view");

    const h = document.createElement("header");
    h.className = "tools-h";
    h.textContent = "Available tools";
    root.append(h);

    for (const t of listTools()) {
        const card = document.createElement("div");
        card.className = "tool-card";
        const name = document.createElement("div");
        name.className = "tool-name";
        name.textContent = t.name;
        const desc = document.createElement("div");
        desc.className = "tool-desc";
        desc.textContent = t.description;
        const usage = document.createElement("code");
        usage.className = "tool-usage";
        usage.textContent = t.usage;
        card.append(name, desc, usage);
        root.append(card);
    }

    const note = document.createElement("p");
    note.className = "tools-note";
    note.textContent =
        "Tools run locally, before the model. Results are injected as context so Zero answers using verified data. HTTP/fetch are subject to browser CORS.";
    root.append(note);
}
