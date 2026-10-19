// Runs in the page's MAIN world so it can reach YouTube Music's player object.
// It never touches the network except for YouTube Music's own lyrics endpoint,
// and talks to the isolated content script via window.postMessage.
(() => {
  if (window.__lyriqueInjected) return;
  window.__lyriqueInjected = true;

  const SOURCE = 'lyrique-bridge';
  // Bump when the page script gains features the app relies on; the app compares it to warn
  // when the extension wasn't reloaded or the YouTube Music tab wasn't refreshed afterwards.
  const BRIDGE_VERSION = 2;
  const POLL_MS = 250; // the app interpolates between samples; 4 Hz is plenty
  let player = null;
  let video = null;
  let lastVideoId = '';
  let lastTitle = '';
  let pendingSince = 0; // when we first saw a new videoId whose metadata isn't ready yet
  let lastSentAt = 0;
  let lastPlaying = null;
  let lyricsAbort = null;

  const post = (msg) => window.postMessage({ source: SOURCE, ...msg }, 'https://music.youtube.com');

  function largestArtwork() {
    const art = navigator.mediaSession?.metadata?.artwork ?? [];
    let best = '';
    let bestSize = 0;
    for (const a of art) {
      const m = /(\d+)x(\d+)/.exec(a.sizes ?? '');
      const size = m ? Number(m[1]) * Number(m[2]) : 0;
      if (size >= bestSize) {
        bestSize = size;
        best = a.src;
      }
    }
    if (!best) {
      const img = document.querySelector('ytmusic-player-bar img.image, ytmusic-player-bar #img');
      if (img?.src) best = img.src;
    }
    return best;
  }

  /** Next song in YouTube Music's queue (for prefetching its lyrics); cached briefly. */
  let nextCache = { at: 0, value: null };
  function nextInQueue() {
    const now = Date.now();
    if (now - nextCache.at < 2000) return nextCache.value;
    let value = null;
    try {
      const items = [...document.querySelectorAll('ytmusic-player-queue-item')];
      const i = items.findIndex((el) => el.hasAttribute('selected'));
      const el = i >= 0 ? items[i + 1] : null;
      const title = el?.querySelector('.song-title')?.textContent?.trim();
      const artist = el?.querySelector('.byline')?.textContent?.trim();
      if (title && artist) {
        const d = (el.querySelector('.duration')?.textContent ?? '').trim().split(':').map(Number);
        const duration = d.length >= 2 && d.every(Number.isFinite) ? d.reduce((a, b) => a * 60 + b, 0) : 0;
        value = { title, artist: artist.split(' • ')[0], duration };
      }
    } catch {
      value = null;
    }
    nextCache = { at: now, value };
    return value;
  }

  function readState() {
    if (!player || typeof player.getCurrentTime !== 'function') return null;
    let details = null;
    try {
      details = player.getPlayerResponse?.()?.videoDetails ?? null;
    } catch {
      details = null;
    }
    const vd = (() => {
      try {
        return player.getVideoData?.() ?? {};
      } catch {
        return {};
      }
    })();
    const meta = navigator.mediaSession?.metadata;
    const videoId = details?.videoId || vd.video_id || '';
    if (!videoId) return null;
    const isAd = player.classList?.contains('ad-showing') || player.classList?.contains('ad-interrupting') || false;
    const state = (() => {
      try {
        return player.getPlayerState();
      } catch {
        return null;
      }
    })();
    // Trust the player's own state when it has one: while buffering (3) the <video> isn't
    // paused but the audio isn't moving either, and the app would extrapolate past it.
    const playing = typeof state === 'number' && state >= 0 ? state === 1 : video ? !video.paused && !video.ended : false;
    let duration = Number(details?.lengthSeconds ?? 0);
    if (!duration) {
      try {
        duration = player.getDuration?.() ?? 0;
      } catch {
        duration = 0;
      }
    }
    return {
      type: 'state',
      videoId,
      title: (meta?.title || details?.title || vd.title || '').trim(),
      artist: (meta?.artist || details?.author || vd.author || '').replace(/\s*-\s*Topic$/i, '').trim(),
      album: (meta?.album || '').trim(),
      duration,
      position: player.getCurrentTime(),
      playing,
      rate: video?.playbackRate ?? 1,
      artwork: largestArtwork(),
      videoType: (details?.musicVideoType || '').replace('MUSIC_VIDEO_TYPE_', ''),
      isAd,
      next: nextInQueue(),
      bridge: BRIDGE_VERSION,
      sentAt: Date.now()
    };
  }

  function tick(force = false) {
    const s = readState();
    if (!s) return;
    const now = Date.now();
    // YouTube Music swaps the videoId a few hundred ms before it fills in title/artist,
    // and mediaSession can still hold the previous song's title. Hold the new track until
    // its metadata is real (or stale for >2 s, in which case it's probably genuinely the same).
    if (s.videoId !== lastVideoId) {
      if (!pendingSince) pendingSince = now;
      const stale = s.title === lastTitle && now - pendingSince < 2000;
      if (!s.title || stale) return;
    }
    pendingSince = 0;
    const changed = s.videoId !== lastVideoId || s.playing !== lastPlaying;
    if (!force && !changed && now - lastSentAt < POLL_MS) return;
    lastSentAt = now;
    lastPlaying = s.playing;
    if (s.videoId !== lastVideoId) {
      lastVideoId = s.videoId;
      lastTitle = s.title;
      if (!s.isAd) startAudio(s.videoId);
      if (!s.isAd) void fetchYtLyrics(s.videoId);
    }
    post(s);
  }

  /**
   * Try YouTube Music's own timed lyrics (cut to the exact master playing here).
   * Timestamps are only returned to mobile client contexts, so we send clientName 26.
   * Any failure is silent — the desktop app falls back to LRCLIB.
   */
  async function fetchYtLyrics(videoId) {
    lyricsAbort?.abort();
    const ac = new AbortController();
    lyricsAbort = ac;
    try {
      const cfg = window.ytcfg?.get?.('INNERTUBE_CONTEXT') ?? {};
      const key = window.ytcfg?.get?.('INNERTUBE_API_KEY') ?? '';
      const hl = cfg?.client?.hl || 'en';
      const gl = cfg?.client?.gl || 'US';
      const common = { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json' } };
      const next = await fetch(`/youtubei/v1/next?prettyPrint=false${key ? `&key=${key}` : ''}`, {
        ...common,
        body: JSON.stringify({ videoId, context: cfg })
      }).then((r) => r.json());
      const tabs =
        next?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs ?? [];
      const tab = tabs.find(
        (t) => t?.tabRenderer?.endpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ===
          'MUSIC_PAGE_TYPE_TRACK_LYRICS'
      );
      const browseId = tab?.tabRenderer?.endpoint?.browseEndpoint?.browseId;
      if (!browseId) return;
      const browse = await fetch(`/youtubei/v1/browse?prettyPrint=false${key ? `&key=${key}` : ''}`, {
        ...common,
        body: JSON.stringify({
          browseId,
          context: { client: { clientName: '26', clientVersion: '7.01.05', hl, gl } }
        })
      }).then((r) => r.json());
      const timed =
        browse?.contents?.elementRenderer?.newElement?.type?.componentType?.model?.timedLyricsModel?.lyricsData?.timedLyricsData;
      if (Array.isArray(timed) && timed.length && timed[0]?.cueRange) {
        const lines = timed
          .map((l) => ({
            text: String(l.lyricLine ?? '').trim().replace(/^♪$/, ''),
            startMs: parseInt(l.cueRange?.startTimeMilliseconds ?? '0', 10),
            endMs: parseInt(l.cueRange?.endTimeMilliseconds ?? '0', 10)
          }))
          .filter((l) => Number.isFinite(l.startMs));
        if (lines.length) post({ type: 'lyrics', videoId, source: 'YouTube Music', lines });
        return;
      }
      // Plain fallback (unsynced)
      let plain = '';
      if (Array.isArray(timed) && timed.length) plain = timed.map((l) => l.lyricLine ?? '').join('\n');
      else if (browse?.contents?.messageRenderer) plain = (browse.contents.messageRenderer.text?.runs ?? []).map((r) => r.text).join('');
      else {
        const runs =
          browse?.contents?.sectionListRenderer?.contents?.[0]?.musicDescriptionShelfRenderer?.description?.runs ?? [];
        plain = runs.map((r) => r.text).join('');
      }
      plain = plain.trim();
      if (plain && plain !== 'Lyrics not available') post({ type: 'lyrics', videoId, source: 'YouTube Music', plain });
    } catch {
      /* silent — LRCLIB fallback in the app */
    }
  }

  /** Transport controls from the app. Click YouTube Music's own buttons so its queue logic runs. */
  function runCommand(action) {
    const bar = document.querySelector('ytmusic-player-bar');
    const click = (sel) => {
      const b = bar?.querySelector(sel);
      if (b) b.click();
      return !!b;
    };
    if (action === 'playPause') {
      if (!click('#play-pause-button')) {
        if (video?.paused) player?.playVideo?.();
        else player?.pauseVideo?.();
      }
    } else if (action === 'next') {
      if (!click('.next-button')) player?.nextVideo?.();
    } else if (action === 'previous') {
      if (!click('.previous-button')) player?.previousVideo?.();
    }
    setTimeout(() => tick(true), 80);
  }

  /* ------------------------------ audio features ------------------------------ */
  // For automatic lyric sync the app needs to know *when* singing happens. We tap the
  // <video>'s audio with captureStream() — this doesn't reroute or alter what you hear —
  // and every 20 ms record band energy (250–4000 Hz) of the stereo mid (where lead vocals
  // sit) and side (wide instruments), plus spectral flatness (voice is harmonic, drums are
  // noisy). Only these numbers leave the page; never audio.
  const AUDIO = { FRAME_MS: 20, MAX_S: 120, BATCH_MS: 2000 };
  const audio = { ctx: null, nodes: null, track: null, videoId: '', frames: [], seconds: 0, lastT: -1, timer: 0, flush: 0 };

  function teardownAudioGraph() {
    try {
      audio.nodes?.src.disconnect();
    } catch {
      /* already gone */
    }
    audio.nodes = null;
    audio.track = null;
  }

  function buildAudioGraph() {
    if (!video?.captureStream) return false;
    let track;
    try {
      track = video.captureStream().getAudioTracks()[0];
    } catch {
      return false; // e.g. encrypted media
    }
    if (!track) return false;
    if (audio.track === track && audio.nodes) return true;
    teardownAudioGraph();
    const ctx = (audio.ctx ??= new AudioContext());
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    const split = ctx.createChannelSplitter(2);
    const mid = ctx.createGain();
    const side = ctx.createGain();
    const invR = ctx.createGain();
    mid.gain.value = 0.5;
    side.gain.value = 0.5;
    invR.gain.value = -1;
    src.connect(split);
    split.connect(mid, 0);
    split.connect(mid, 1);
    split.connect(side, 0);
    split.connect(invR, 1);
    invR.connect(side);
    const mk = () => {
      const a = ctx.createAnalyser();
      a.fftSize = 2048;
      a.smoothingTimeConstant = 0;
      return a;
    };
    const aMid = mk();
    const aSide = mk();
    mid.connect(aMid);
    side.connect(aSide);
    // Keep the analysers pulled without making any sound.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    aMid.connect(mute);
    aSide.connect(mute);
    mute.connect(ctx.destination);
    const bin = ctx.sampleRate / aMid.fftSize;
    audio.nodes = {
      src,
      aMid,
      aSide,
      lo: Math.max(1, Math.floor(250 / bin)),
      hi: Math.min(aMid.frequencyBinCount - 1, Math.ceil(4000 / bin)),
      bufM: new Float32Array(aMid.frequencyBinCount),
      bufS: new Float32Array(aMid.frequencyBinCount)
    };
    audio.track = track;
    return true;
  }

  function sampleAudio() {
    if (!video || video.paused || video.playbackRate !== 1 || audio.seconds >= AUDIO.MAX_S) return;
    if (player?.classList?.contains('ad-showing')) return;
    if (!audio.nodes && !buildAudioGraph()) return;
    if (audio.track?.readyState === 'ended' && !buildAudioGraph()) return;
    if (audio.ctx?.state === 'suspended') {
      audio.ctx.resume().catch(() => {});
      return;
    }
    const n = audio.nodes;
    n.aMid.getFloatFrequencyData(n.bufM);
    n.aSide.getFloatFrequencyData(n.bufS);
    let em = 0;
    let es = 0;
    let logSum = 0;
    let count = 0;
    for (let i = n.lo; i <= n.hi; i++) {
      const pm = 10 ** (n.bufM[i] / 10);
      em += pm;
      es += 10 ** (n.bufS[i] / 10);
      logSum += Math.log(pm + 1e-20);
      count++;
    }
    if (!count || !Number.isFinite(em)) return;
    const flat = Math.exp(logSum / count) / (em / count + 1e-20);
    const t = video.currentTime;
    if (audio.lastT >= 0 && t > audio.lastT && t - audio.lastT < 0.5) audio.seconds += t - audio.lastT;
    audio.lastT = t;
    audio.frames.push([
      Math.round(t * 1000) / 1000,
      Math.round(Math.log10(em + 1e-12) * 1000) / 1000,
      Math.round(Math.log10(es + 1e-12) * 1000) / 1000,
      Math.round(Math.min(1, flat) * 1000) / 1000
    ]);
  }

  function flushAudio() {
    if (!audio.frames.length || !audio.videoId) return;
    post({ type: 'audio', videoId: audio.videoId, frames: audio.frames });
    audio.frames = [];
  }

  function startAudio(videoId) {
    flushAudio();
    audio.videoId = videoId;
    audio.frames = [];
    audio.seconds = 0;
    audio.lastT = -1;
    teardownAudioGraph(); // the element may get a fresh stream for the new track
    if (!audio.timer) {
      audio.timer = setInterval(() => {
        try {
          sampleAudio();
        } catch {
          teardownAudioGraph();
        }
      }, AUDIO.FRAME_MS);
      audio.flush = setInterval(flushAudio, AUDIO.BATCH_MS);
    }
  }

  function attach() {
    const p = document.querySelector('#movie_player');
    const v = document.querySelector('video');
    if (p && p !== player) {
      player = p;
      try {
        player.addEventListener('videodatachange', () => setTimeout(() => tick(true), 50));
      } catch {
        /* older player builds */
      }
    }
    if (v && v !== video) {
      video = v;
      for (const ev of ['play', 'playing', 'pause', 'seeked', 'waiting', 'ratechange', 'ended']) {
        video.addEventListener(ev, () => tick(true));
      }
    }
    return !!(player && video);
  }

  // The player is created lazily; poll until it exists, then keep an eye on it.
  const boot = setInterval(() => {
    if (attach()) {
      clearInterval(boot);
      setInterval(() => {
        attach();
        tick(false);
      }, POLL_MS);
      tick(true);
    }
  }, 500);

  // The app can request a fresh snapshot (e.g. right after it connects).
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'lyrique-bridge-ctl') return;
    if (e.data.type === 'snapshot') {
      tick(true);
      if (lastVideoId) void fetchYtLyrics(lastVideoId);
    } else if (e.data.type === 'command') {
      runCommand(e.data.action);
    } else if (e.data.type === 'seek' && player?.seekTo) {
      const pos = Number(e.data.position);
      if (Number.isFinite(pos)) {
        player.seekTo(pos, true);
        setTimeout(() => tick(true), 60);
      }
    }
  });
})();
