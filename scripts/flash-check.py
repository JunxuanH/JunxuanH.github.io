#!/usr/bin/env python3
"""WCAG 2.3.1 flash analysis (general flash + red flash) for short clips.

Usage: python3 scripts/flash-check.py <clip.mp4> [--loop] [--out design/night/landing/flash] [--name NAME]

Method (30 fps):
  * Decode at 10x the analysis grid (64x36 for 16:9, 36x64 for 9:16, 64x32 for 2:1), convert sRGB -> linear, average each
    10x10 block in linear light -> per-cell linear RGB and relative luminance Y = 0.2126 R + 0.7152 G + 0.0722 B.
  * General-flash transitions per cell: a zigzag over Y with a 0.10 reversal threshold; every swing between two confirmed
    extrema is a transition (>= 0.10 by construction) and counts only if the darker extreme is < 0.80. A flash = a pair of
    opposing transitions, so flashes = transitions / 2.
  * Red-flash transitions per cell: a change of more than 0.20 in CIE 1976 u'v' to or from a saturated red state
    (R / (R+G+B) >= 0.8 on the cell's linear RGB, with linear R >= 0.05 so near-black noise is not "red").
  * Area: for every 1 s window (30 frames) the count per cell is the number of transitions in the window. A region
    "flashes N times" when >= 25 % of its cells have >= 2N transitions. Regions = every 10-degree field, approximated
    per WCAG as a 341x256 box at 1024x768, i.e. 1/3 of the frame width x 1/3 of its height (slid by one cell), and the
    whole frame. This does not require the cells to flash concurrently, so it is an upper bound.
  * Averaged cross-check ("region-mean"): the zigzag applied to each 10-degree region's mean Y (flashing that is not
    spatially coherent averages out, as in the Harding-style area test).
  * --loop analyses the clip twice in a row so windows across the wrap are counted; times are reported modulo the duration.
Outputs <out>/<name>.csv (per window start: the four general/red counts + the region-mean count) and <out>/<name>.png.
"""
import argparse, json, os, subprocess, sys
import numpy as np

FF, FP = "/opt/homebrew/bin/ffmpeg", "/opt/homebrew/bin/ffprobe"
FPS, WIN, BLOCK = 30, 30, 10
GEN_DELTA, GEN_DARK, AREA = 0.10, 0.80, 0.25
RED_RATIO, RED_DUV, RED_MIN_R = 0.8, 0.20, 0.05


def probe(path):
    s = json.loads(subprocess.check_output([FP, "-v", "error", "-select_streams", "v:0", "-show_entries",
                                            "stream=width,height", "-of", "json", path]))["streams"][0]
    return s["width"], s["height"]


def decode(path, gw, gh):
    w, h = gw * BLOCK, gh * BLOCK
    raw = subprocess.check_output([FF, "-v", "error", "-i", path, "-vf", f"fps={FPS},scale={w}:{h}:flags=area,format=rgb24",
                                   "-f", "rawvideo", "-"])
    n = len(raw) // (w * h * 3)
    f = np.frombuffer(raw, np.uint8)[: n * w * h * 3].reshape(n, h, w, 3)
    lut = np.arange(256) / 255.0
    lut = np.where(lut <= 0.04045, lut / 12.92, ((lut + 0.055) / 1.055) ** 2.4).astype(np.float32)
    cells = np.empty((n, gh, gw, 3), np.float32)
    for i in range(n):  # linearise then block-average in linear light
        cells[i] = lut[f[i]].reshape(gh, BLOCK, gw, BLOCK, 3).mean(axis=(1, 3))
    return cells


def zigzag(Y, delta=GEN_DELTA, dark=GEN_DARK):
    """Y: (T, K) series. Returns (T, K) int8: +1/-1 where a counted transition ends (at the new extremum's frame)."""
    T, K = Y.shape
    out = np.zeros((T, K), np.int8)
    mode = np.zeros(K, np.int8)            # 0 unknown, +1 rising (tracking hi), -1 falling (tracking lo)
    hi, hi_t = Y[0].copy(), np.zeros(K, int)
    lo, lo_t = Y[0].copy(), np.zeros(K, int)
    piv = Y[0].copy()                      # value of the last confirmed extremum (start of the current swing)
    idx = np.arange(K)
    for t in range(1, T):
        y = Y[t]
        up = y > hi; hi = np.where(up, y, hi); hi_t = np.where(up, t, hi_t)
        dn = y < lo; lo = np.where(dn, y, lo); lo_t = np.where(dn, t, lo_t)
        # unknown: the first 0.1 excursion sets the direction (the earlier extreme becomes the first pivot)
        u = mode == 0
        start = u & (hi - lo >= delta)
        rising = start & (hi_t > lo_t); falling = start & (lo_t >= hi_t)
        piv = np.where(rising, lo, np.where(falling, hi, piv))
        mode = np.where(rising, 1, np.where(falling, -1, mode)).astype(np.int8)
        # rising and reversed by >= delta: swing piv -> hi is an up transition ending at hi_t
        r = (mode == 1) & ~start & (y <= hi - delta)
        if r.any():
            k = idx[r]; ok = np.minimum(piv[k], hi[k]) < dark
            out[hi_t[k][ok], k[ok]] = 1
            piv[k] = hi[k]; lo[k] = y[k]; lo_t[k] = t; mode[k] = -1
        f = (mode == -1) & ~start & (y >= lo + delta)
        if f.any():
            k = idx[f]; ok = lo[k] < dark
            out[lo_t[k][ok], k[ok]] = -1
            piv[k] = lo[k]; hi[k] = y[k]; hi_t[k] = t; mode[k] = 1
    # a final unconfirmed swing still counts if it is large enough
    for k in range(K):
        if mode[k] == 1 and hi[k] - piv[k] >= delta and piv[k] < dark: out[hi_t[k], k] = 1
        if mode[k] == -1 and piv[k] - lo[k] >= delta and lo[k] < dark: out[lo_t[k], k] = -1
    return out


def uv(rgb):
    X = 0.4124 * rgb[..., 0] + 0.3576 * rgb[..., 1] + 0.1805 * rgb[..., 2]
    Yv = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    Z = 0.0193 * rgb[..., 0] + 0.1192 * rgb[..., 1] + 0.9505 * rgb[..., 2]
    d = X + 15 * Yv + 3 * Z + 1e-9
    return np.stack([4 * X / d, 9 * Yv / d], -1)


def red_transitions(rgb, lookback=3):
    """rgb: (T, K, 3) linear. Returns (T, K) int8 1 where a red transition happens: the cell's u'v' moved > 0.20 within
    the last `lookback` frames and either end is saturated red. Hits in consecutive frames are one transition."""
    T, K, _ = rgb.shape
    s = rgb.sum(-1) + 1e-9
    red = (rgb[..., 0] / s >= RED_RATIO) & (rgb[..., 0] >= RED_MIN_R)
    UV = uv(rgb)
    hit = np.zeros((T, K), bool)
    for lag in range(1, lookback + 1):
        d = np.linalg.norm(UV[lag:] - UV[:-lag], axis=-1)
        hit[lag:] |= (d > RED_DUV) & (red[lag:] | red[:-lag])
    out = np.zeros((T, K), np.int8)
    out[0] = hit[0]
    out[1:] = hit[1:] & ~hit[:-1]          # rising edge of a hit run = one transition
    return out


def area_counts(trans, gh, gw, rw, rh):
    """trans: (T, gh*gw) nonzero = transition. Returns per window start: (max over 10-degree regions, whole frame) of the
    largest transition count n with >= 25 % of the region's cells having >= n transitions in the window."""
    T = trans.shape[0]
    c = np.concatenate([np.zeros((1, trans.shape[1]), np.int32), np.cumsum(trans != 0, 0, dtype=np.int32)])
    nW = T - WIN + 1
    counts = (c[WIN:] - c[:nW]).reshape(nW, gh, gw)   # transitions per cell per window
    kmax = int(counts.max()) if counts.size else 0
    region = np.zeros(nW, int); frame = np.zeros(nW, int); where = np.zeros((nW, 2), int)
    for k in range(1, kmax + 1):
        ind = (counts >= k).astype(np.int32)
        ii = np.pad(ind.cumsum(1).cumsum(2), ((0, 0), (1, 0), (1, 0)))
        s = ii[:, rh:, rw:] - ii[:, :-rh, rw:] - ii[:, rh:, :-rw] + ii[:, :-rh, :-rw]   # (nW, gh-rh+1, gw-rw+1)
        best = s.reshape(nW, -1).max(1)
        hitr = best >= AREA * rw * rh
        arg = s.reshape(nW, -1).argmax(1)
        where[hitr] = np.stack([arg // s.shape[2], arg % s.shape[2]], 1)[hitr]
        region[hitr] = k
        frame[ind.reshape(nW, -1).sum(1) >= AREA * gh * gw] = k
    return region, frame, where


def region_mean_counts(Y, gh, gw, rw, rh, step=3):
    """Zigzag on each 10-degree region's mean luminance; returns max transitions in any region per window start."""
    T = Y.shape[0]
    Yg = Y.reshape(T, gh, gw)
    ii = np.pad(Yg.cumsum(1).cumsum(2), ((0, 0), (1, 0), (1, 0)))
    ys = np.arange(0, gh - rh + 1, step); xs = np.arange(0, gw - rw + 1, step)
    s = (ii[:, ys[:, None] + rh, xs[None] + rw] - ii[:, ys[:, None], xs[None] + rw]
         - ii[:, ys[:, None] + rh, xs[None]] + ii[:, ys[:, None], xs[None]]) / (rw * rh)
    tr = zigzag(s.reshape(T, -1))
    c = np.concatenate([np.zeros((1, tr.shape[1]), np.int32), np.cumsum(tr != 0, 0, dtype=np.int32)])
    return (c[WIN:] - c[: T - WIN + 1]).max(1)


def plot(path, title, t, series, dur):
    from PIL import Image, ImageDraw
    W, H, L, B = 900, 300, 50, 30
    im = Image.new("RGB", (W, H), (250, 250, 250)); d = ImageDraw.Draw(im)
    ymax = max(4.0, max(float(np.max(v)) for _, v, _ in series) + 0.5)
    X = lambda x: L + (W - L - 10) * x / max(dur, 1e-6)
    Yp = lambda y: H - B - (H - B - 25) * y / ymax
    d.text((L, 5), title, fill=(20, 20, 20))
    for g in range(int(ymax) + 1):
        d.line([(L, Yp(g)), (W - 10, Yp(g))], fill=(225, 225, 225)); d.text((10, Yp(g) - 6), str(g), fill=(90, 90, 90))
    d.line([(L, Yp(3)), (W - 10, Yp(3))], fill=(200, 0, 0), width=2); d.text((W - 150, Yp(3) - 14), "WCAG limit 3 / s", fill=(200, 0, 0))
    for s in range(int(dur) + 1):
        d.text((X(s) - 3, H - B + 8), f"{s}s", fill=(90, 90, 90))
    for i, (label, v, col) in enumerate(series):
        pts = [(X(a), Yp(b)) for a, b in zip(t, v)]
        if len(pts) > 1: d.line(pts, fill=col, width=2)
        d.text((L + 10 + i * 210, 20), label, fill=col)
    im.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clip"); ap.add_argument("--loop", action="store_true")
    ap.add_argument("--out", default="design/night/landing/flash"); ap.add_argument("--name")
    a = ap.parse_args()
    name = a.name or os.path.splitext(os.path.basename(a.clip))[0]
    w, h = probe(a.clip)
    if w >= h: gw = 64; gh = max(1, round(64 * h / w))
    else: gh = 64; gw = max(1, round(64 * w / h))
    rw, rh = max(1, round(gw / 3)), max(1, round(gh / 3))
    cells = decode(a.clip, gw, gh)
    n = cells.shape[0]; dur = n / FPS
    if a.loop: cells = np.concatenate([cells, cells])
    T = cells.shape[0]
    rgb = cells.reshape(T, gh * gw, 3)
    Y = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    gen = zigzag(Y); red = red_transitions(rgb)
    g_reg, g_frame, g_where = area_counts(gen, gh, gw, rw, rh)
    r_reg, r_frame, _ = area_counts(red, gh, gw, rw, rh)
    g_mean = region_mean_counts(Y, gh, gw, rw, rh)
    nW = T - WIN + 1
    if a.loop: keep = np.arange(n)            # window starts over one period (each may run across the wrap)
    else: keep = np.arange(nW)
    t = keep / FPS
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, name + ".csv"), "w") as fh:
        fh.write("start_s,frame,general_flashes_10deg,general_flashes_frame,general_flashes_region_mean,red_flashes_10deg,red_flashes_frame,general_10deg_cell_x,general_10deg_cell_y\n")
        for i in keep:
            fh.write(f"{i / FPS:.3f},{i},{g_reg[i] / 2:.1f},{g_frame[i] / 2:.1f},{g_mean[i] / 2:.1f},{r_reg[i] / 2:.1f},{r_frame[i] / 2:.1f},{g_where[i, 1]},{g_where[i, 0]}\n")
    res = {"clip": a.clip, "loop": a.loop, "frames": n, "grid": [gw, gh], "region_cells": [rw, rh]}
    for key, arr in [("general_10deg", g_reg), ("general_frame", g_frame), ("general_region_mean", g_mean), ("red_10deg", r_reg), ("red_frame", r_frame)]:
        v = arr[keep] / 2; i = int(np.argmax(v))
        res[key] = {"max_flashes_per_s": float(v[i]), "window_s": [round(i / FPS, 2), round((i + WIN) / FPS % dur if a.loop else (i + WIN) / FPS, 2)],
                    "windows_over_3": int((v > 3).sum())}
    plot(os.path.join(a.out, name + ".png"), f"{name}: flashes in the 1 s window starting at t" + (" (loop, wraps)" if a.loop else ""), t,
         [("general, 10-deg region (cells)", g_reg[keep] / 2, (20, 90, 200)), ("general, region mean", g_mean[keep] / 2, (20, 160, 90)),
          ("red, 10-deg region", r_reg[keep] / 2, (210, 60, 30)), ("general, whole frame", g_frame[keep] / 2, (120, 60, 160))], dur)
    print(json.dumps(res))


if __name__ == "__main__":
    main()
