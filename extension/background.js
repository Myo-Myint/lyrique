// MV3 service worker: keeps one WebSocket open to the Lyrique desktop app on localhost.
// Chrome ≥116 keeps a service worker alive while WebSocket traffic flows (≤30 s gaps),
// so we send a keepalive whenever the player is idle.
const DEFAULT_PORT = 41337;
const KEEPALIVE_MS = 20_000;
let socket = null;
let connecting = false;
let backoff = 1000;
let lastTx = 0;
let lastState = null;
let lastLyrics = null;
let keepaliveTimer = null;

async function port() {
  const { port } = await chrome.storage.local.get({ port: DEFAULT_PORT });
  return Number(port) || DEFAULT_PORT;
}

function setBadge(connected) {
  chrome.action.setBadgeText({ text: connected ? '●' : '' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: connected ? '#34c759' : '#8e8e93' }).catch(() => {});
  chrome.action.setTitle({ title: connected ? 'Lyrique Bridge — connected' : 'Lyrique Bridge — waiting for the Lyrique app' }).catch(() => {});
  chrome.storage.session?.set({ connected }).catch?.(() => {});
}

async function connect() {
  if (socket || connecting) return;
  connecting = true;
  const p = await port();
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${p}`);
    ws.onopen = () => {
      socket = ws;
      connecting = false;
      backoff = 1000;
      setBadge(true);
      // Replay the latest known state so the app shows something immediately.
      if (lastState) send(lastState);
      if (lastLyrics) send(lastLyrics);
      requestSnapshot();
      startKeepalive();
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg?.type === 'seek' || msg?.type === 'command') void forwardToTabs(msg);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      socket = null;
      connecting = false;
      setBadge(false);
      stopKeepalive();
      scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  } catch {
    connecting = false;
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  setTimeout(() => void connect(), backoff);
  backoff = Math.min(backoff * 2, 10_000);
}

function send(obj) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(obj));
    lastTx = Date.now();
  }
}

function startKeepalive() {
  stopKeepalive();
  keepaliveTimer = setInterval(() => {
    if (Date.now() - lastTx >= KEEPALIVE_MS - 500) send({ type: 'ping' });
  }, KEEPALIVE_MS);
}

function stopKeepalive() {
  if (keepaliveTimer) clearInterval(keepaliveTimer);
  keepaliveTimer = null;
}

async function forwardToTabs(msg) {
  const tabs = await chrome.tabs.query({ url: 'https://music.youtube.com/*' });
  for (const t of tabs) {
    if (t.id != null) chrome.tabs.sendMessage(t.id, msg).catch(() => {});
  }
}

function requestSnapshot() {
  return forwardToTabs({ type: 'snapshot' });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'state') {
    lastState = msg;
    send(msg);
  } else if (msg?.type === 'audio') {
    send(msg);
  } else if (msg?.type === 'lyrics') {
    lastLyrics = msg;
    send(msg);
  } else if (msg?.type === 'status') {
    sendResponse({ connected: socket?.readyState === WebSocket.OPEN, lastState });
    return true;
  }
  if (!socket && !connecting) void connect();
  return false;
});

// Belt and braces: an alarm wakes the worker and retries the connection.
chrome.alarms.create('lyrique-reconnect', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'lyrique-reconnect' && !socket) void connect();
});

chrome.runtime.onInstalled.addListener(() => void connect());
chrome.runtime.onStartup.addListener(() => void connect());
void connect();
