// Isolated-world content script: relays messages from inject.js (page world)
// to the service worker, which owns the WebSocket to the desktop app.
(() => {
  let alive = true;

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'lyrique-bridge') return;
    if (!alive) return;
    const { source, ...msg } = e.data;
    // Extension was reloaded/updated: this script instance is orphaned (runtime.id goes away).
    // Don't use lastError for this — the worker never replies, so every send reports
    // "message port closed", which would kill the relay after the first message.
    if (!chrome.runtime?.id) {
      alive = false;
      return;
    }
    try {
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch {
      alive = false;
    }
  });

  // Service worker asks for a snapshot when the app (re)connects.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'snapshot' || msg?.type === 'seek' || msg?.type === 'command') {
      window.postMessage({ source: 'lyrique-bridge-ctl', ...msg }, 'https://music.youtube.com');
    }
  });
})();
