#!/usr/bin/env python3
"""Derive roughness and ambient-occlusion maps from a tiling albedo, plus half-res lite copies.

The city ships albedo + normal for every ground set but no roughness or occlusion, so surfaces
respond to the environment with one flat gloss value. Both missing channels can be approximated
from the albedo well enough for a stylised night scene, at no generation cost:

  roughness  inverted, contrast-shaped luminance. Dark grout and worn asphalt read rough; bright
             polished stone and wet patches read smooth. Output is remapped into a sane band
             rather than 0..1, because fully smooth or fully rough both look wrong under bloom.
  occlusion  a cavity pass: the albedo minus a heavy blur of itself. Seams, grout lines and pits
             go dark, flat areas stay white. This is not true geometric occlusion, but on tiling
             detail it lands close and costs nothing.

Usage:
  scripts/texture-maps.py public/night/ground/asphalt.jpg [more.jpg ...]
  scripts/texture-maps.py --lite-dir public/night-lite/ground public/night/ground/*.jpg

Writes <name>-r.jpg and <name>-ao.jpg beside each input, and half-resolution copies of both into
the lite directory when one is given. Existing files are overwritten.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

# Rec. 709 luminance, the same weighting the shaders use.
LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

# Roughness band. Nothing in this city is a mirror and nothing is chalk.
ROUGH_MIN, ROUGH_MAX = 0.35, 0.95
# How hard to push contrast around the midpoint before remapping into the band.
ROUGH_CONTRAST = 1.6
# Cavity blur radius as a fraction of image width, and how strongly cavities darken.
CAVITY_RADIUS = 0.02
CAVITY_GAIN = 2.2
# Occlusion never goes fully black; that would punch holes in the albedo.
AO_FLOOR = 0.45

# Derived channels ship smaller than the albedo they came from. The ground tiles every 9 world
# units and these two maps carry no colour, so half the albedo's resolution is indistinguishable
# in motion and costs a quarter of the bandwidth.
DEFAULT_MAX_SIZE = 512
DEFAULT_QUALITY = 82


def luminance(img: Image.Image) -> np.ndarray:
    a = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    return a @ LUMA


def make_seamless(img: Image.Image, border: float = 0.10) -> Image.Image:
    """Cross-fade the outer border with the opposite edge so the tile wraps without a seam.

    Generated textures come back nearly tileable but not exactly. Blending each edge strip toward
    its opposite number, with the weight reaching an even mix exactly at the boundary, makes the
    first and last row and column identical. The fade is confined to the border, so the interior
    detail the model produced is untouched.
    """
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    h, w, _ = a.shape
    out = a.copy()
    bw = max(2, int(round(w * border)))
    bh = max(2, int(round(h * border)))
    for i in range(bw):
        alpha = 0.5 * (1.0 + i / bw)
        left, right = a[:, i], a[:, w - 1 - i]
        out[:, i] = left * alpha + right * (1 - alpha)
        out[:, w - 1 - i] = right * alpha + left * (1 - alpha)
    base = out.copy()
    for j in range(bh):
        alpha = 0.5 * (1.0 + j / bh)
        top, bottom = base[j, :], base[h - 1 - j, :]
        out[j, :] = top * alpha + bottom * (1 - alpha)
        out[h - 1 - j, :] = bottom * alpha + top * (1 - alpha)
    return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8), mode="RGB")


def normal_from(img: Image.Image, strength: float = 2.0) -> Image.Image:
    """Tangent-space normal map from the albedo's luminance treated as height.

    Wrapped gradients, so the normal map tiles exactly as well as the albedo it came from.
    """
    height = luminance(img)
    # Light blur first, or JPEG noise turns into a field of spikes.
    height = np.asarray(
        Image.fromarray((height * 255.0 + 0.5).astype(np.uint8), mode="L").filter(ImageFilter.GaussianBlur(1.0)),
        dtype=np.float32,
    ) / 255.0
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * strength
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * strength
    nz = np.ones_like(height)
    length = np.sqrt(dx * dx + dy * dy + nz * nz)
    # OpenGL convention (+Y up), which is what three's normalMap expects.
    rgb = np.stack([-dx / length, dy / length, nz / length], axis=-1)
    return Image.fromarray(((rgb * 0.5 + 0.5) * 255.0 + 0.5).astype(np.uint8), mode="RGB")


def roughness_from(img: Image.Image) -> Image.Image:
    lum = luminance(img)
    # Centre on the image's own mean so a dark asphalt tile and a pale paver tile both use the
    # full band instead of one collapsing to a constant.
    centred = (lum - float(lum.mean())) * ROUGH_CONTRAST + 0.5
    rough = 1.0 - np.clip(centred, 0.0, 1.0)
    rough = ROUGH_MIN + rough * (ROUGH_MAX - ROUGH_MIN)
    return Image.fromarray((rough * 255.0 + 0.5).astype(np.uint8), mode="L")


def occlusion_from(img: Image.Image) -> Image.Image:
    lum = luminance(img)
    radius = max(2.0, img.width * CAVITY_RADIUS)
    blurred = np.asarray(
        Image.fromarray((lum * 255.0 + 0.5).astype(np.uint8), mode="L").filter(
            ImageFilter.GaussianBlur(radius)
        ),
        dtype=np.float32,
    ) / 255.0
    # Only darkening matters: where the pixel is below its neighbourhood, it sits in a cavity.
    cavity = np.clip((blurred - lum) * CAVITY_GAIN, 0.0, 1.0)
    ao = np.clip(1.0 - cavity, AO_FLOOR, 1.0)
    # Renormalise so a texture with no cavities stays pure white rather than slightly grey.
    peak = float(ao.max())
    if peak > 0:
        ao = np.clip(ao / peak, AO_FLOOR, 1.0)
    return Image.fromarray((ao * 255.0 + 0.5).astype(np.uint8), mode="L")


def fit(img: Image.Image, size: int) -> Image.Image:
    if img.width <= size:
        return img
    return img.resize((size, max(1, round(img.height * size / img.width))), Image.LANCZOS)


def save(img: Image.Image, path: Path, quality: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, quality=quality, optimize=True)
    print(f"  {path}  {img.width}x{img.height}  {path.stat().st_size // 1024} KB")


def process(src: Path, args: argparse.Namespace) -> None:
    if not src.exists():
        print(f"missing: {src}", file=sys.stderr)
        return
    img = Image.open(src)
    print(f"{src}  {img.width}x{img.height}")
    if args.seamless:
        img = make_seamless(img)
    dest_dir = args.out_dir or src.parent
    stem = args.name or src.stem
    suffix = args.ext or src.suffix
    size, quality, lite_dir = args.max_size, args.quality, args.lite_dir

    channels: list[tuple[str, Image.Image, int]] = [("-r", roughness_from(img), size), ("-ao", occlusion_from(img), size)]
    if args.albedo_out:
        channels.append(("", img.convert("RGB"), args.albedo_size))
    if args.normal:
        channels.append(("-n", normal_from(img, args.normal_strength), args.albedo_size))

    for tag, made, target in channels:
        out = dest_dir / f"{stem}{tag}{suffix}"
        save(fit(made, target), out, quality)
        if lite_dir is not None:
            save(fit(made, max(1, target // 2)), lite_dir / out.name, quality)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("albedo", nargs="+", type=Path, help="tiling albedo images")
    ap.add_argument("--lite-dir", type=Path, default=None, help="also write half-size copies here")
    ap.add_argument("--out-dir", type=Path, default=None, help="write beside the source unless given")
    ap.add_argument("--name", default=None, help="output stem, default the source stem")
    ap.add_argument("--ext", default=None, help="output extension, e.g. .jpg")
    ap.add_argument("--max-size", type=int, default=DEFAULT_MAX_SIZE, help=f"derived channels' longest edge, default {DEFAULT_MAX_SIZE}")
    ap.add_argument("--albedo-size", type=int, default=1024, help="albedo and normal longest edge, default 1024")
    ap.add_argument("--quality", type=int, default=DEFAULT_QUALITY, help=f"JPEG quality, default {DEFAULT_QUALITY}")
    ap.add_argument("--seamless", action="store_true", help="cross-fade the borders so the tile wraps")
    ap.add_argument("--normal", action="store_true", help="also derive a tangent-space normal map")
    ap.add_argument("--normal-strength", type=float, default=2.0, help="normal map relief, default 2.0")
    ap.add_argument("--albedo-out", action="store_true", help="also write the (possibly seam-healed) albedo")
    args = ap.parse_args()
    for src in args.albedo:
        process(src, args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
