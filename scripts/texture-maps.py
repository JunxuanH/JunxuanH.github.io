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


def process(src: Path, lite_dir: Path | None, size: int, quality: int) -> None:
    if not src.exists():
        print(f"missing: {src}", file=sys.stderr)
        return
    img = Image.open(src)
    print(f"{src}  {img.width}x{img.height}")
    for suffix, made in (("-r", roughness_from(img)), ("-ao", occlusion_from(img))):
        out = src.with_name(f"{src.stem}{suffix}{src.suffix}")
        save(fit(made, size), out, quality)
        if lite_dir is not None:
            save(fit(made, max(1, size // 2)), lite_dir / out.name, quality)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("albedo", nargs="+", type=Path, help="tiling albedo images")
    ap.add_argument("--lite-dir", type=Path, default=None, help="also write half-size copies here")
    ap.add_argument("--max-size", type=int, default=DEFAULT_MAX_SIZE, help=f"longest edge, default {DEFAULT_MAX_SIZE}")
    ap.add_argument("--quality", type=int, default=DEFAULT_QUALITY, help=f"JPEG quality, default {DEFAULT_QUALITY}")
    args = ap.parse_args()
    for src in args.albedo:
        process(src, args.lite_dir, args.max_size, args.quality)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
