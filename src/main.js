const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const https = require('https');

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

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'index.html'));
}

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
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BoringNonRacistCalculator/1.0)' }, timeout: 7000 }, res => {
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
