"""Sound effects for the Lyrique how-to video (no music: the video uses effects only).

Writes into public/audio (or the folder given as the first argument):
  sfx-*.wav           one-shot effects; the Remotion scenes place them, so they follow the cut
Needs only numpy. Run: python3 audio/make_audio.py
"""
import os
import sys
import wave

import numpy as np

SR = 48000
DUR = 43.5
# Scene starts in seconds; keep in sync with src/timing.ts.
NEW = [0, 4.6, 9.1, 15.1, 19.6, 23.6, 27.6, 31.6, 35.6, 38.7, 43.5]
# The effects were first timed on a 60 s cut; M() maps those times onto this one.
OLD = [0, 5, 11, 20, 26, 32, 38, 44, 49.5, 53.5, 60]


def M(x):
    return float(__import__('numpy').interp(x, OLD, NEW))
N = int(SR * DUR)
OUT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'audio')
rng = np.random.default_rng(11)


def t_axis(sec):
    return np.arange(int(SR * sec)) / SR


def to_stereo(sig, pan=0.0):
    if sig.ndim == 2:
        return sig
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    return np.stack([sig * l, sig * r], axis=1) * 1.414


def place(buf, sig, at, gain=1.0, pan=0.0):
    i = int(round(at * SR))
    if i >= buf.shape[0] or i < 0:
        return
    sig = to_stereo(sig, pan)
    n = min(sig.shape[0], buf.shape[0] - i)
    buf[i:i + n] += sig[:n] * gain


def fft_filter(x, lo=None, hi=None, slope=2):
    X = np.fft.rfft(x, axis=0)
    f = np.fft.rfftfreq(x.shape[0], 1 / SR)
    h = np.ones_like(f)
    if hi:
        h *= 1 / np.sqrt(1 + (f / hi) ** (2 * slope))
    if lo:
        h *= 1 / np.sqrt(1 + (lo / np.maximum(f, 1e-3)) ** (2 * slope))
    if x.ndim == 2:
        h = h[:, None]
    return np.fft.irfft(X * h, n=x.shape[0], axis=0)


def reverb(x, seconds=2.6, mix=0.22, lo=200, hi=6500):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal((n, 2)) * np.exp(-t * 6.9 / seconds)[:, None]
    ir = fft_filter(ir, lo=lo, hi=hi, slope=1)
    ir[: int(0.018 * SR)] = 0
    ir /= np.sqrt((ir ** 2).sum(axis=0))
    size = 1 << int(np.ceil(np.log2(x.shape[0] + n)))
    wet = np.fft.irfft(np.fft.rfft(x, size, axis=0) * np.fft.rfft(ir, size, axis=0), size, axis=0)[: x.shape[0]]
    return x * (1 - mix) + wet * mix * 1.5


# ------------------------------------------------------------------ effects

def air(sec=0.6, lo=900, hi=9000, peak=0.6, pan_from=-0.4, pan_to=0.4):
    """Airy swish: band-limited noise, smooth rise and fall, moving across."""
    n = int(sec * SR)
    x = fft_filter(rng.standard_normal(n), lo=lo, hi=hi, slope=1)
    u = np.arange(n) / n
    e = np.where(u < peak, np.sin(u / peak * np.pi / 2) ** 2, np.cos((u - peak) / (1 - peak) * np.pi / 2) ** 2)
    m = x * e / (np.abs(x).max() + 1e-9)
    p = np.linspace(pan_from, pan_to, n)
    return np.stack([m * np.cos((p + 1) * np.pi / 4), m * np.sin((p + 1) * np.pi / 4)], axis=1) * 1.414


def landing(sec=2.2):
    """Low cinematic 'landing': sub drop + soft body, no click."""
    t = t_axis(sec)
    f = 38 + 30 * np.exp(-t * 6)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.4)
    rumble = fft_filter(rng.standard_normal(len(t)), lo=40, hi=220) * np.exp(-t * 3.5) * 0.35
    return (body + rumble) * np.minimum(1, t / 0.012)


def reverse_swell(sec=1.0):
    """Air that rises into a moment (like a reversed reverb tail)."""
    n = int(sec * SR)
    x = fft_filter(rng.standard_normal((n, 2)), lo=600, hi=7000, slope=1)
    u = np.arange(n) / n
    return x * (u ** 3)[:, None] / (np.abs(x).max() + 1e-9)


def key_click():
    """Quiet low-profile keyboard key."""
    t = t_axis(0.06)
    x = fft_filter(rng.standard_normal(len(t)), lo=1200, hi=6000, slope=2) * np.exp(-t * 320)
    body = np.sin(2 * np.pi * 330 * t) * np.exp(-t * 180) * 0.35
    return x + body


def trackpad_click():
    t = t_axis(0.05)
    x = fft_filter(rng.standard_normal(len(t)), lo=2000, hi=9000, slope=2) * np.exp(-t * 450)
    body = np.sin(2 * np.pi * 150 * t) * np.exp(-t * 140) * 0.5
    return x * 0.8 + body


def sfx():
    buf = np.zeros((N, 2))

    def P(sig, at, *a, **k):
        place(buf, sig, M(at), *a, **k)

    # Intro reveal: air rises, the window lands, then a soft pull-back swish.
    P(reverse_swell(1.1), 0.0, 0.10)
    P(landing(), 1.05, 0.55)
    P(air(1.0, 500, 6000, 0.5, 0.0, 0.5), 1.8, 0.07)

    # Scene changes: quiet, airy.
    for k, at in enumerate((5.0, 11.0, 20.0, 26.0, 32.0, 38.0, 44.0, 49.5)):
        d = 1 if k % 2 == 0 else -1
        P(air(0.7, 1000, 9000, 0.6, -0.4 * d, 0.4 * d), at - 0.5, 0.06)

    # Step 1: trackpad click on Download.
    P(trackpad_click(), 8.7, 0.22, pan=-0.05)
    # Extension icon click.
    P(trackpad_click(), 21.6, 0.20, pan=0.4)
    # Key presses.
    for at in (27.6, 33.6, 39.4, 46.0, 46.95, 50.8):
        P(key_click(), at, 0.20, pan=-0.35)
    # Mini bar slides up: a short, soft swish.
    P(air(0.5, 700, 7000, 0.55, 0.1, 0.3), 39.3, 0.06)

    # Outro: swell into the logo, low landing, nothing else.
    P(reverse_swell(1.2), 52.4, 0.10)
    P(landing(2.8), 53.55, 0.5)

    return reverb(buf, 1.6, 0.15, lo=150, hi=8000)


def oneshots(bus_scale):
    """Each effect on its own, with the same room and level as in the effects bus."""
    shots = {
        'air': air(0.7, 1000, 9000, 0.6, -0.4, 0.4),
        'air-back': air(0.7, 1000, 9000, 0.6, 0.4, -0.4),
        'pull': air(1.0, 500, 6000, 0.5, 0.0, 0.5),
        'rise': air(0.5, 700, 7000, 0.55, 0.1, 0.3),
        'swell': reverse_swell(1.2),
        'landing': to_stereo(landing(2.8)),
        'click': to_stereo(trackpad_click()),
        'key': to_stereo(key_click(), -0.35),
    }
    for name, sig in shots.items():
        sig = to_stereo(sig)
        padded = np.concatenate([sig, np.zeros((int(1.6 * SR), 2))])
        out = reverb(padded, 1.6, 0.15, lo=150, hi=8000) * bus_scale
        pcm = (np.clip(out, -1, 1) * 32767).astype('<i2')
        with wave.open(os.path.join(OUT, 'sfx-%s.wav' % name), 'wb') as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(pcm.tobytes())


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    bus = sfx()
    oneshots(0.89 / (np.abs(bus).max() + 1e-9))
    print('audio written to', OUT)
