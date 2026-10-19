const $ = (id) => document.getElementById(id);

async function refresh() {
  const res = await chrome.runtime.sendMessage({ type: 'status' }).catch(() => null);
  const connected = !!res?.connected;
  $('dot').classList.toggle('on', connected);
  $('status').textContent = connected ? 'Connected to Lyrique' : 'Waiting for Lyrique app';
  const s = res?.lastState;
  $('track').textContent = s ? `${s.title} — ${s.artist}` : 'Nothing detected yet';
}

chrome.storage.local.get({ port: 41337 }).then(({ port }) => {
  $('port').value = port;
});
$('port').addEventListener('change', (e) => {
  const v = Number(e.target.value) || 41337;
  chrome.storage.local.set({ port: v });
});

refresh();
setInterval(refresh, 1500);
