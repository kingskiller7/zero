// Zero — provider adapters. Streaming chat completions.

export const DEFAULT_MODELS = {
  gemini: "gemini-2.5-flash",
  openrouter: "meta-llama/llama-3.2-3b-instruct:free"
};

export function makeProvider({ provider, apiKey, model }) {
  if (provider === "gemini") return geminiProvider({ apiKey, model });
  if (provider === "openrouter") return openrouterProvider({ apiKey, model });
  throw new Error(`unknown provider: ${provider}`);
}

// ─── Gemini ────────────────────────────────────────────
function geminiProvider({ apiKey, model }) {
  const base = "https://generativelanguage.googleapis.com/v1beta/models";
  return {
    provider: "gemini",
    model,
    async verify() {
      const r = await fetch(
        `${base}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: "ping" }] }]
          })
        }
      );
      if (!r.ok) throw new Error(`auth failed (${r.status})`);
      return true;
    },
    async *stream(messages, { signal } = {}) {
      const sys = messages.find((m) => m.role === "system")?.content;
      const contents = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }]
        }));
      const body = {
        contents,
        ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {})
      };
      const url = `${base}/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(
        apiKey
      )}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal
      });
      if (!r.ok) throw new Error(`gemini ${r.status}: ${await r.text()}`);
      yield* sse(r, (json) => {
        const text =
          json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ??
          "";
        return text;
      });
    }
  };
}

// ─── OpenRouter ────────────────────────────────────────
function openrouterProvider({ apiKey, model }) {
  const url = "https://openrouter.ai/api/v1/chat/completions";
  return {
    provider: "openrouter",
    model,
    async verify() {
      const r = await fetch("https://openrouter.ai/api/v1/auth/key", {
        headers: { authorization: `Bearer ${apiKey}` }
      });
      if (!r.ok) throw new Error(`auth failed (${r.status})`);
      return true;
    },
    async *stream(messages, { signal } = {}) {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "HTTP-Referer": location.origin,
          "X-Title": "Zero"
        },
        body: JSON.stringify({ model, messages, stream: true }),
        signal
      });
      if (!r.ok) throw new Error(`openrouter ${r.status}: ${await r.text()}`);
      yield* sse(r, (json) => json?.choices?.[0]?.delta?.content ?? "");
    }
  };
}

// ─── SSE reader ────────────────────────────────────────
async function* sse(response, extract) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const chunk = extract(json);
        if (chunk) yield chunk;
      } catch {
        /* partial json — skip */
      }
    }
  }
}