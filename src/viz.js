// Zero — visualization core. Drives the orb + state label.
const labels = {
  idle: "idle",
  thinking: "thinking",
  memory: "retrieving memory",
  tools: "executing tools",
  streaming: "streaming",
  error: "error",
  approval: "awaiting approval",
};

export function viz(el, labelEl) {
  return {
    set(state) {
      el.dataset.state = state;
      if (labelEl) labelEl.textContent = labels[state] ?? state;
    },
  };
}