const { app, BrowserWindow, Menu, shell, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 900,
    minWidth: 760,
    minHeight: 640,
    title: 'Aion 2 Companion',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#0e0e16',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Links open in the user's browser, never in an app window -- but only ever
  // http(s). Handing an arbitrary scheme (file:, smb:, javascript: ...) to the
  // OS shell would let anything that got a link into the page run something.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { protocol } = new URL(url);
      if (protocol === 'http:' || protocol === 'https:') shell.openExternal(url);
    } catch (e) { /* unparseable URL: ignore */ }
    return { action: 'deny' };
  });

  // Nothing in this app should ever navigate the window away from index.html.
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'index.html'));
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
// Stored in the per-user app data directory rather than the renderer, so the
// API key never lives in localStorage and is never handed back to the page.
// Where the OS offers encryption (DPAPI / Keychain / libsecret) the key is
// encrypted at rest; otherwise it is stored as-is and the UI says so.

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');

const DEFAULT_SETTINGS = {
  theme: 'system',            // system | dark | light
  density: 'normal',          // normal | compact
  startupTab: 'last',         // last | cp | damage | arcana | guides | other
  region: 'tw',               // tw | kr | utc | local -- Time Rift countdown zone
  riftHours: '2,5,8,11,14,17,20,23',
  ai: {
    enabled: false,
    provider: 'gemini',
    model: '',
    baseUrl: '',
    requireSearch: true
  }
};

function readSettingsRaw() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8'));
    return {
      ...DEFAULT_SETTINGS, ...raw,
      ai: { ...DEFAULT_SETTINGS.ai, ...(raw.ai || {}) }
    };
  } catch (e) {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }
}

function writeSettingsRaw(s) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(s, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

function encryptionAvailable() {
  try { return safeStorage.isEncryptionAvailable(); } catch (e) { return false; }
}

function storeKey(plain) {
  if (!plain) return { apiKeyEnc: '', apiKeyPlain: '' };
  if (encryptionAvailable()) {
    return { apiKeyEnc: safeStorage.encryptString(plain).toString('base64'), apiKeyPlain: '' };
  }
  return { apiKeyEnc: '', apiKeyPlain: plain };
}

function loadKey(s) {
  if (s.apiKeyEnc) {
    try { return safeStorage.decryptString(Buffer.from(s.apiKeyEnc, 'base64')); }
    catch (e) { return ''; }
  }
  return s.apiKeyPlain || '';
}

// What the renderer is allowed to see: everything except the key itself.
function publicSettings() {
  const s = readSettingsRaw();
  const key = loadKey(s);
  const { apiKeyEnc, apiKeyPlain, ...safe } = s;
  return {
    ...safe,
    apiKeySet: !!key,
    apiKeyHint: key ? key.slice(0, 4) + '…' + key.slice(-4) : '',
    encryptionAvailable: encryptionAvailable(),
    providers: Object.entries(AI_PROVIDERS).map(([id, p]) => ({
      id, label: p.label, free: !!p.free, local: !!p.local,
      search: !!p.search, keyUrl: p.keyUrl || '', needsKey: !p.local && !p.noKey,
      defaultModel: p.defaultModel || '', note: p.note || '', setup: p.setup || ''
    }))
  };
}

ipcMain.handle('settings:get', () => publicSettings());

ipcMain.handle('settings:set', (_e, patch) => {
  const s = readSettingsRaw();
  const next = { ...s, ...patch, ai: { ...s.ai, ...(patch && patch.ai ? patch.ai : {}) } };
  // apiKey arrives only when the user actually edits it: undefined means keep,
  // empty string means clear.
  if (patch && typeof patch.apiKey === 'string') {
    Object.assign(next, storeKey(patch.apiKey));
  } else {
    next.apiKeyEnc = s.apiKeyEnc || '';
    next.apiKeyPlain = s.apiKeyPlain || '';
  }
  delete next.apiKey;
  writeSettingsRaw(next);
  return publicSettings();
});

ipcMain.handle('settings:openFolder', () => {
  shell.openPath(app.getPath('userData'));
  return true;
});

// ---------------------------------------------------------------------------
// AI providers
// ---------------------------------------------------------------------------
// Deliberately provider-neutral and dependency-free: every provider is reached
// over plain HTTPS from the main process, so no vendor SDK is bundled and the
// renderer never needs network access of its own.
//
// `search: true` means the provider can ground its answer in a live web search.
// That matters more here than model quality: Aion 2 patches monthly, so an
// ungrounded model answers guide questions from stale training data and states
// guesses as fact. The UI warns when the selected provider cannot search.

const AI_PROVIDERS = {
  gemini: {
    setup: 'Free tier, no card needed. Sign in with a Google account at aistudio.google.com/apikey, click "Create API key", paste it here.',
    label: 'Google Gemini',
    free: true, search: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-2.5-flash',
    note: 'Free tier available. Grounds answers with Google Search.',
    build(cfg, key, system, prompt) {
      const model = cfg.model || this.defaultModel;
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        headers: { 'x-goog-api-key': key },
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: cfg.requireSearch ? [{ google_search: {} }] : undefined
        }
      };
    },
    parse(j) {
      const cand = (j.candidates || [])[0] || {};
      const text = ((cand.content || {}).parts || []).map(p => p.text || '').join('').trim();
      const sources = (((cand.groundingMetadata || {}).groundingChunks) || [])
        .map(c => (c.web ? { title: c.web.title || c.web.uri, url: c.web.uri } : null))
        .filter(Boolean);
      return { text, sources };
    }
  },

  anthropic: {
    label: 'Anthropic (Claude)',
    search: true,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-opus-5',
    note: 'Paid API. Uses Claude\'s server-side web search tool.',
    build(cfg, key, system, prompt) {
      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: {
          model: cfg.model || this.defaultModel,
          max_tokens: 4096,
          system,
          messages: [{ role: 'user', content: prompt }],
          tools: cfg.requireSearch
            ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }]
            : undefined
        }
      };
    },
    parse(j) {
      const blocks = j.content || [];
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      const sources = [];
      for (const b of blocks) {
        if (b.type !== 'web_search_tool_result') continue;
        // On success .content is a list of results; on error it is a single
        // error object, so guard before iterating.
        if (!Array.isArray(b.content)) continue;
        for (const r of b.content) {
          if (r && r.url) sources.push({ title: r.title || r.url, url: r.url });
        }
      }
      return { text, sources };
    }
  },

  openrouter: {
    setup: 'Free account. Sign up at openrouter.ai, open Keys, create one, paste it here. Models ending in :free cost nothing.',
    label: 'OpenRouter',
    free: true, search: true,
    keyUrl: 'https://openrouter.ai/keys',
    defaultModel: 'google/gemini-2.0-flash-exp:free',
    note: 'One key, many models — several are free. Append :online to a model name for web search.',
    openai: 'https://openrouter.ai/api/v1'
  },

  groq: {
    setup: 'Free account. Sign up at console.groq.com, open API Keys, create one, paste it here.',
    label: 'Groq',
    free: true,
    keyUrl: 'https://console.groq.com/keys',
    defaultModel: 'llama-3.3-70b-versatile',
    note: 'Free tier, very fast. No web search — answers come from training data only.',
    openai: 'https://api.groq.com/openai/v1'
  },

  openai: {
    label: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o-mini',
    note: 'Paid API.',
    openai: 'https://api.openai.com/v1'
  },

  ollama: {
    noKey: true,
    setup: 'No account and no key at all. Install Ollama from ollama.com, then run: ollama pull llama3.1',
    label: 'Ollama (local, offline)',
    free: true, local: true,
    defaultModel: 'llama3.1',
    note: 'Runs entirely on your own machine — no key, no cost, no data leaves your PC. No web search, so it cannot know about recent patches.',
    openai: 'http://localhost:11434/v1'
  },

  custom: {
    noKey: true,
    label: 'Custom (OpenAI-compatible)',
    defaultModel: '',
    note: 'Any endpoint that speaks the OpenAI chat-completions API — LM Studio, llama.cpp, LiteLLM, a self-hosted gateway.',
    openai: ''
  }
};

// Every OpenAI-compatible provider shares one request/response shape.
for (const p of Object.values(AI_PROVIDERS)) {
  if (typeof p.openai !== 'string') continue;
  const base = p.openai;
  p.build = function (cfg, key, system, prompt) {
    const root = (cfg.baseUrl || base || '').replace(/\/+$/, '');
    return {
      url: root + '/chat/completions',
      headers: key ? { authorization: 'Bearer ' + key } : {},
      body: {
        model: cfg.model || this.defaultModel,
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }]
      }
    };
  };
  p.parse = function (j) {
    const msg = ((j.choices || [])[0] || {}).message || {};
    const text = (msg.content || '').trim();
    const sources = (j.citations || []).map(u =>
      typeof u === 'string' ? { title: u, url: u } : { title: u.title || u.url, url: u.url }
    ).filter(x => x.url);
    return { text, sources };
  };
}

function postJSON(url, headers, body, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('Invalid endpoint URL')); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return reject(new Error('Endpoint must be http(s)'));
    // Plain http is only reasonable for a local model server.
    if (u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname)) {
      return reject(new Error('Refusing to send an API key over plain http to a remote host'));
    }
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': payload.length,
        'user-agent': 'Aion2Companion/1.0',
        ...headers
      },
      timeout: timeoutMs
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { data += c; if (data.length > 5_000_000) req.destroy(new Error('Response too large')); });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) { /* not JSON */ }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const detail = parsed && (parsed.error && (parsed.error.message || parsed.error.type) || parsed.message);
          return reject(new Error(`HTTP ${res.statusCode}${detail ? ': ' + detail : ''}`));
        }
        if (!parsed) return reject(new Error('Response was not valid JSON'));
        resolve(parsed);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.end(payload);
  });
}

const AI_SYSTEM = [
  'You help a player of the MMO Aion 2 (NCSOFT) find current, factual information',
  'about the game: dungeon and boss mechanics, class builds, stat priorities and patch changes.',
  '',
  'Rules you must follow:',
  '- If you used a web search, cite what you found and prefer recent sources.',
  '- If you are not sure, or your information may predate the current patch, say so plainly.',
  '- Never invent numbers, item names, skill names or patch dates. "I could not confirm this"',
  '  is a better answer than a plausible guess.',
  '- Aion 2 launched in Korea and Taiwan first; Korean and Taiwanese sources are usually ahead',
  '  of English ones. Say which region a piece of information applies to when it matters.',
  '- Be concise. Use short paragraphs or bullets, no preamble.'
].join('\n');

async function runAI(prompt, systemPrompt) {
  const s = readSettingsRaw();
  const cfg = s.ai || {};
  const provider = AI_PROVIDERS[cfg.provider];
  if (!provider) throw new Error('No AI provider selected');
  const key = loadKey(s);
  if (!provider.local && !provider.noKey && !key) throw new Error('No API key saved for ' + provider.label);
  if (cfg.provider === 'custom' && !cfg.baseUrl) throw new Error('Custom provider needs a base URL');

  const { url, headers, body } = provider.build(cfg, key, systemPrompt || AI_SYSTEM, prompt);
  if (!url || url.startsWith('/')) throw new Error('This provider needs a base URL in Settings');
  const json = await postJSON(url, headers, body);
  const out = provider.parse(json);
  if (!out.text) throw new Error('The model returned an empty response');
  return {
    text: out.text,
    sources: out.sources || [],
    provider: provider.label,
    model: cfg.model || provider.defaultModel,
    searched: !!(out.sources && out.sources.length),
    canSearch: !!provider.search
  };
}

ipcMain.handle('ai:ask', async (_e, prompt) => {
  if (typeof prompt !== 'string' || !prompt.trim()) return { success: false, error: 'Empty question' };
  if (prompt.length > 4000) return { success: false, error: 'Question is too long' };
  try {
    return { success: true, ...(await runAI(prompt.trim())) };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

ipcMain.handle('ai:test', async () => {
  try {
    const r = await runAI('Reply with exactly: OK');
    return { success: true, provider: r.provider, model: r.model, sample: r.text.slice(0, 80) };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

// ---------------------------------------------------------------------------
// AI-contributed content
// ---------------------------------------------------------------------------
// The app's own guides are the base layer and are never modified. Anything the
// model contributes is stored separately here, keyed by target, and rendered as
// a clearly-marked overlay that the user can refresh or delete per target or all
// at once. Keeping the two layers apart is what makes "let the AI update the
// app" safe: nothing it produces can quietly overwrite a sourced fact.

const CONTENT_FILE = () => path.join(app.getPath('userData'), 'ai-content.json');

function readContent() {
  try { return JSON.parse(fs.readFileSync(CONTENT_FILE(), 'utf8')) || {}; }
  catch (e) { return {}; }
}
function writeContent(c) {
  try {
    fs.mkdirSync(path.dirname(CONTENT_FILE()), { recursive: true });
    fs.writeFileSync(CONTENT_FILE(), JSON.stringify(c, null, 2), 'utf8');
    return true;
  } catch (e) { return false; }
}

const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

// Model output is data, never markup and never trusted shape. Everything is
// coerced to plain strings with hard caps before it is allowed near the store.
function sanitiseUpdate(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Model did not return an object');
  const entries = (Array.isArray(raw.entries) ? raw.entries : []).slice(0, 8).map(e => ({
    heading: clean(e && e.heading, 120),
    bullets: (Array.isArray(e && e.bullets) ? e.bullets : []).slice(0, 8)
      .map(b => clean(b, 400)).filter(Boolean),
    confidence: ['high', 'medium', 'low'].includes(e && e.confidence) ? e.confidence : 'low'
  })).filter(e => e.heading && e.bullets.length);

  const sources = (Array.isArray(raw.sources) ? raw.sources : []).slice(0, 10).map(x => {
    const url = clean(x && x.url, 400);
    let ok = '';
    try { const u = new URL(url); if (u.protocol === 'http:' || u.protocol === 'https:') ok = u.href; }
    catch (e) { /* drop */ }
    return ok ? { title: clean((x && x.title) || ok, 160), url: ok } : null;
  }).filter(Boolean);

  return { entries, sources, noChanges: !!raw.no_changes };
}

// Models routinely wrap JSON in ``` fences or add a sentence around it.
function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in the model response');
  return JSON.parse(body.slice(start, end + 1));
}

const UPDATE_SYSTEM = [
  'You are updating a reference app for the MMO Aion 2 (NCSOFT).',
  'You will be given one topic. Report only information that ADDS TO or CORRECTS what the app',
  'already shows for that topic, based on the current live build of the game.',
  '',
  'Reply with a single JSON object and nothing else:',
  '{"entries":[{"heading":"short title","bullets":["fact","fact"],"confidence":"high|medium|low"}],',
  ' "sources":[{"title":"page title","url":"https://..."}],',
  ' "no_changes":false}',
  '',
  'Rules:',
  '- Set "no_changes": true with an empty entries array if you have nothing verifiable to add.',
  '  That is a perfectly good answer and is much better than padding.',
  '- Never invent numbers, names, dates or mechanics. Use "confidence":"low" for anything you',
  '  could not confirm from a source, and omit it entirely if you are guessing.',
  '- Cite a URL for every claim you can. Uncited claims must be "low" confidence.',
  '- Korean and Taiwanese sources lead the global build; say which region a change applies to.',
  '- Plain text only in every string: no markdown, no HTML, no links inside the text.'
].join('\n');

async function runAIUpdate(topic) {
  const prompt = [
    'Topic: ' + topic,
    '',
    'What does the current live build of Aion 2 have for this topic that a guide written',
    'earlier might be missing or have wrong? Reply with the JSON object described above.'
  ].join('\n');
  const raw = await runAI(prompt, UPDATE_SYSTEM);
  const parsed = sanitiseUpdate(extractJSON(raw.text));
  return {
    ...parsed,
    // Prefer the provider's own grounding citations; fall back to what the model listed.
    sources: raw.sources && raw.sources.length ? raw.sources.slice(0, 10) : parsed.sources,
    provider: raw.provider, model: raw.model, canSearch: raw.canSearch,
    fetchedAt: new Date().toISOString()
  };
}

ipcMain.handle('content:get', () => readContent());

ipcMain.handle('content:clear', (_e, target) => {
  const c = readContent();
  if (typeof target === 'string' && target) delete c[target];
  writeContent(c);
  return readContent();
});

ipcMain.handle('content:clearAll', () => { writeContent({}); return {}; });

ipcMain.handle('ai:update', async (_e, target, topic) => {
  if (typeof target !== 'string' || !target) return { success: false, error: 'No target given' };
  if (typeof topic !== 'string' || !topic) return { success: false, error: 'No topic given' };
  try {
    const result = await runAIUpdate(topic.slice(0, 500));
    const c = readContent();
    if (result.noChanges && !result.entries.length) {
      c[target] = { entries: [], sources: result.sources, noChanges: true,
                    provider: result.provider, model: result.model,
                    canSearch: result.canSearch, fetchedAt: result.fetchedAt };
    } else {
      c[target] = { entries: result.entries, sources: result.sources, noChanges: false,
                    provider: result.provider, model: result.model,
                    canSearch: result.canSearch, fetchedAt: result.fetchedAt };
    }
    writeContent(c);
    return { success: true, target, entry: c[target] };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

// Is a local Ollama server running? Lets the UI offer a genuinely key-free
// option without the user having to know the URL.
ipcMain.handle('ai:detectOllama', () => new Promise(resolve => {
  const req = http.get({ host: '127.0.0.1', port: 11434, path: '/api/tags', timeout: 1500 }, res => {
    let d = '';
    res.setEncoding('utf8');
    res.on('data', c => { d += c; if (d.length > 200000) req.destroy(); });
    res.on('end', () => {
      try {
        const models = (JSON.parse(d).models || []).map(m => m.name).filter(Boolean).slice(0, 40);
        resolve({ running: true, models });
      } catch (e) { resolve({ running: res.statusCode === 200, models: [] }); }
    });
  });
  req.on('timeout', () => { req.destroy(); resolve({ running: false, models: [] }); });
  req.on('error', () => resolve({ running: false, models: [] }));
}));

// ---------------------------------------------------------------------------
// Patch notes feed
// ---------------------------------------------------------------------------
// No confirmed official RSS/Atom feed exists for Aion2 patch notes as of writing.
// These are best-guess candidate feed URLs on sites known to publish English
// translations of the official notes; each is tried in turn and the first one
// that returns something XML-shaped wins. Failure is expected and handled
// gracefully by the renderer with static links to the same sites.
const FEED_CANDIDATES = [
  'https://aion2hub.com/feed',
  'https://aion2hub.com/updates/feed',
  'https://aion2hub.com/rss.xml',
  'https://questlog.gg/aion-2/en/patch-notes/feed',
  'https://questlog.gg/feed',
  'https://shugo.gg/feed',
  'https://shugo.gg/rss.xml',
];

function fetchOnce(url, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Aion2Companion/1.0)' }, timeout: 7000 }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        fetchOnce(next, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; if (body.length > 2_000_000) req.destroy(); });
      res.on('end', () => resolve({ url, body, contentType: res.headers['content-type'] || '' }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function looksLikeFeed(result) {
  const ct = result.contentType.toLowerCase();
  const head = result.body.slice(0, 500).toLowerCase();
  return ct.includes('xml') || ct.includes('rss') || ct.includes('atom') || head.includes('<rss') || head.includes('<feed') || head.includes('<?xml');
}

ipcMain.handle('fetch-patch-notes', async () => {
  for (const url of FEED_CANDIDATES) {
    try {
      const result = await fetchOnce(url);
      if (looksLikeFeed(result)) {
        return { success: true, source: url, xml: result.body };
      }
    } catch (e) { /* try next candidate */ }
  }
  return { success: false, tried: FEED_CANDIDATES };
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
