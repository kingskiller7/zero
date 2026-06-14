class VirtualFileSystem {
    constructor() { this.fs = { "/sys/boot.log": "Zero Opt. V3 - Sec Suite" }; }
    read(p) { return this.fs[p] || "ERR: 404"; }
    write(p, c) { this.fs[p] = c; return "OK"; }
    delete(p) { delete this.fs[p]; return "OK"; }
    ls() { return Object.keys(this.fs).join("\n") || "Empty"; }
}

const AppState = {
    apiKey: localStorage.getItem('_z_key') || null,
    model: "gemini-2.5-flash",
    vfs: new VirtualFileSystem(),
    memory: [],
    tts: window.speechSynthesis,
    voices: []
};

const DOM = {
    init: document.getElementById('init-screen'), boot: document.getElementById('boot-sequence'),
    main: document.getElementById('main-ui'), input: document.getElementById('api-key-input'),
    btn: document.getElementById('boot-btn'), virt: document.getElementById('virtualization'),
    log: document.getElementById('chat-log'), trigger: document.getElementById('input-trigger'),
    cIcon: document.getElementById('code-icon'), wIcon: document.getElementById('wiki-icon'),
    cModal: document.getElementById('code-modal'), wModal: document.getElementById('wiki-modal'),
    editor: document.getElementById('code-editor')
};

const Ops = {
    contextOptimizer: (mem) => {
        let pruned = mem.filter(m => !(m.parts && (m.parts[0].functionResponse || m.parts[0].functionCall)));
        return pruned.slice(-10);
    },
    speculativeEdit: (code) => { 
        try { 
            localStorage.setItem('_z_js', code);
            return "Script updated in memory. Reload required to execute structural changes.";
        } catch(e) { return `Crash: ${e.message}`; }
    }
};

// Sub-Agent AI Generator
const runSecuritySubAgent = async (toolName, systemRole, contextData) => {
    const prompt = `You are an autonomous [${toolName}]. Mandate: ${systemRole}. 
Analyze this data and return strict JSON { "tool":"${toolName}", "verdict":"SAFE|BLOCKED|VULNERABLE|suspicious|clean", "confidenceScore":"0.0-1.0", "summary":"...", "actionTakenOrResult":"..." }
Data Payload: ${JSON.stringify(contextData)}`;

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${AppState.model}:generateContent?key=${AppState.apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json" }
            })
        });
        const d = await res.json();
        return d.candidates[0].content.parts[0].text;
    } catch(e) { return JSON.stringify({ error: e.message }); }
};

const toolsDefinition = [
    { name: "browser", description: "Search web.", parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } },
    { name: "file_write", description: "Write VFS.", parameters: { type: "object", properties: { p: { type: "string" }, c: { type: "string" } }, required: ["p", "c"] } },
    { name: "file_read", description: "Read VFS.", parameters: { type: "object", properties: { p: { type: "string" } }, required: ["p"] } },
    { name: "eval_js", description: "Exec JS logic natively.", parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } },
    // Security Tools
    { name: "siem_analyzer", description: "Analyze logs for anomalies.", parameters: { type: "object", properties: { logs: { type: "string" } }, required: ["logs"] } },
    { name: "edr_hunter", description: "Analyze process behaviors.", parameters: { type: "object", properties: { process_data: { type: "string" } }, required: ["process_data"] } },
    { name: "waf_inspector", description: "Inspect HTTP payload injections.", parameters: { type: "object", properties: { payload: { type: "string" } }, required: ["payload"] } },
    { name: "dlp_scanner", description: "Check text for data/IP leaks.", parameters: { type: "object", properties: { content: { type: "string" } }, required: ["content"] } },
    { name: "iam_risk_eval", description: "Evaluate login context risk.", parameters: { type: "object", properties: { context: { type: "string" } }, required: ["context"] } },
    { name: "sast_patcher", description: "Analyze/patch source code logic.", parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } },
    { name: "forensic_decider", description: "Deconstruct AI agent logs.", parameters: { type: "object", properties: { logs: { type: "string" } }, required: ["logs"] } }
];

const ToolExecutor = {
    browser: async (a) => `Search data for: ${a.q}`,
    file_write: async (a) => AppState.vfs.write(a.p, a.c),
    file_read: async (a) => AppState.vfs.read(a.p),
    eval_js: async (a) => { try { return String(new Function(a.code)()); } catch(e) { return `Err: ${e.message}`; } },
    // Defensive Security Callbacks
    siem_analyzer: async (a) => runSecuritySubAgent("Anomaly Detector AI", "Analyze logs dynamically to detect suspicious behavior patterns", a.logs),
    edr_hunter: async (a) => runSecuritySubAgent("Behavioral Endpoint Hunter AI", "Watch memory and process behaviors to neutralize zero-days", a.process_data),
    waf_inspector: async (a) => runSecuritySubAgent("Adaptive Traffic Engine", "Inspect web requests to isolate injection/bypasses", a.payload),
    dlp_scanner: async (a) => runSecuritySubAgent("Intent DLP AI", "Flag contextual IP theft and secret leaks", a.content),
    iam_risk_eval: async (a) => runSecuritySubAgent("Risk-Based Auth AI", "Synthesize telemetry to block account takeovers", a.context),
    sast_patcher: async (a) => runSecuritySubAgent("Auto-Patching Engine", "Analyze code for design issues and patch", a.code),
    forensic_decider: async (a) => runSecuritySubAgent("Forensic Decider AI", "Track and explain anomalous AI generation paths", a.logs)
};

const logMsg = (m) => {
    const d = document.createElement('div'); d.style.marginBottom="6px"; d.innerText=m;
    DOM.log.appendChild(d); DOM.log.scrollTop = DOM.log.scrollHeight;
};

const setVirt = (s) => { DOM.virt.className = ''; if(s !== 'idle') DOM.virt.classList.add(s); };

const speak = (t) => {
    if(AppState.tts.speaking) AppState.tts.cancel();
    const u = new SpeechSynthesisUtterance(t);
    const v = AppState.voices.find(v => v.name.includes('Google') || v.lang.startsWith('en'));
    if(v) u.voice = v;
    u.pitch = 0.6; u.rate = 1.2;
    u.onstart = () => setVirt('speaking'); u.onend = () => setVirt('idle');
    AppState.tts.speak(u); logMsg(`[ZERO]: ${t}`);
};

const boot = async () => {
    DOM.init.style.display = 'none'; DOM.boot.style.display = 'block';
    const logs = ["[SYS] Allocating core...", "[SEC] Initializing Defense Sub-Agents...", "[ZERO] Online."];
    for(let l of logs) { logMsg(l); await new Promise(r => setTimeout(r, 200)); }
    DOM.boot.style.display = 'none'; DOM.main.style.display = 'block';
    speak("Security suite initialized. Monitoring channels open.");
};

DOM.btn.addEventListener('click', () => {
    const k = DOM.input.value.trim();
    if(k) { AppState.apiKey = k; localStorage.setItem('_z_key', k); boot(); }
});

DOM.cIcon.addEventListener('click', () => { 
    DOM.editor.value = localStorage.getItem('_z_js') || "// Core Logic"; 
    DOM.cModal.style.display = 'flex'; 
});
DOM.wIcon.addEventListener('click', () => DOM.wModal.style.display = 'flex');

document.getElementById('close-code-btn').addEventListener('click', () => DOM.cModal.style.display='none');
document.getElementById('close-wiki-btn').addEventListener('click', () => DOM.wModal.style.display='none');
document.getElementById('apply-code-btn').addEventListener('click', () => Ops.speculativeEdit(DOM.editor.value));

const initVoices = () => { AppState.voices = AppState.tts.getVoices(); };
initVoices(); if (speechSynthesis.onvoiceschanged !== undefined) speechSynthesis.onvoiceschanged = initVoices;

const callGemini = async (prompt) => {
    setVirt('thinking');
    AppState.memory.push({ role: "user", parts: [{ text: prompt }] });

    const payload = {
        contents: Ops.contextOptimizer(AppState.memory),
        tools: [{ functionDeclarations: toolsDefinition }],
        systemInstruction: { parts: [{ text: "You are Zero. Exact, mechanical, brief. You have access to specialized child AIs (SIEM, EDR, WAF) for deep analysis." }] }
    };

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${AppState.model}:generateContent?key=${AppState.apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        const data = await res.json();
        if(!data.candidates) throw new Error("API stream invalid.");

        const msg = data.candidates[0].content;
        AppState.memory.push(msg);

        const tools = msg.parts ? msg.parts.filter(p => p.functionCall) : [];
        if (tools.length > 0) {
            const results = [];
            await Promise.all(tools.map(async (c) => {
                logMsg(`[SYS] Spawning Sub-Agent: ${c.functionCall.name}`);
                if(ToolExecutor[c.functionCall.name]) {
                    const r = await ToolExecutor[c.functionCall.name](c.functionCall.args);
                    results.push({ functionResponse: { name: c.functionCall.name, response: { result: r } } });
                }
            }));
            AppState.memory.push({ role: "function", parts: results });
            return callGemini("Agent analysis complete. Present the verdict concisely.");
        }

        const txt = msg.parts ? msg.parts.find(p => p.text) : null;
        if(txt) speak(txt.text); else setVirt('idle');

    } catch (err) {
        console.error(err); logMsg(`[ERR] Pipeline failed.`); setVirt('idle');
    }
};

// ============================================================================
// 🎤 SPEECH RECOGNITION ENGINE (STT)
// ============================================================================

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false; // Stop listening after one phrase
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        setVirt('listening');
        logMsg("[SYS] Microphone active. Awaiting voice input...");
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        logMsg(`[USER VOICE]: ${transcript}`);
        callGemini(transcript); // Immediately send to Zero
    };

    recognition.onerror = (event) => {
        logMsg(`[ERR] Mic error: ${event.error}`);
        setVirt('idle');
    };

    recognition.onend = () => {
        if(DOM.virt.classList.contains('listening')) {
            setVirt('idle');
        }
    };
} else {
    console.warn("Speech Recognition API is not supported in this browser.");
}

DOM.virt.addEventListener('click', () => {
    // If double clicked or API unavailable, show the manual text box
    if (!recognition || DOM.virt.classList.contains('listening')) {
        DOM.trigger.focus(); 
        DOM.trigger.style.bottom = "20px"; 
        setVirt('listening');
        if(recognition) recognition.stop();
    } else {
        // Start voice recognition
        try {
            recognition.start();
        } catch (e) {
            logMsg("[ERR] Microphone already in use.");
        }
    }
});

DOM.trigger.addEventListener('keypress', (e) => {
    if(e.key === 'Enter' && DOM.trigger.value.trim()) {
        const v = DOM.trigger.value.trim(); 
        DOM.trigger.value = ''; 
        DOM.trigger.style.bottom = "-100px";
        logMsg(`[USER]: ${v}`); 
        callGemini(v);
    }
});

if (AppState.apiKey) DOM.input.value = AppState.apiKey;
