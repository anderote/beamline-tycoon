#!/usr/bin/env python3
"""
extract-pob-sprites.py

Extracts decoration sprites for Beamline Tycoon from the already-exported
RCT2 g1.dat PNGs and generates procedural pixel-art placeholders for trees,
shrubs, benches, lampposts, and fences.

Output:
  assets/decorations/*.png
  assets/decorations/decoration-manifest.json
"""

import json
import os
import shutil
from pathlib import Path

from PIL import Image, ImageDraw

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent
G1_DIR = REPO_ROOT / "assets" / "rct2-extracted" / "g1"
OUT_DIR = REPO_ROOT / "assets" / "decorations"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Helper: copy + convert a g1 PNG to RGBA decoration asset
# ---------------------------------------------------------------------------
def copy_g1(index: int, dest_name: str) -> str:
    src = G1_DIR / f"{index:05d}.png"
    dst = OUT_DIR / dest_name
    img = Image.open(src).convert("RGBA")
    img.save(dst)
    return dest_name


# ---------------------------------------------------------------------------
# Procedural sprite generators
# ---------------------------------------------------------------------------

def make_oak_tree(size=(20, 32)) -> Image.Image:
    """Broad deciduous tree with dark-green canopy and brown trunk."""
    w, h = size
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # trunk
    tx = w // 2 - 1
    d.rectangle([tx, h - 10, tx + 2, h - 1], fill=(101, 67, 33, 255))
    # canopy layers (bottom → top, each a bit narrower)
    layers = [
        (2,  h - 18, w - 3, h - 10, (34, 139, 34, 255)),
        (4,  h - 24, w - 5, h - 17, (0,  128,  0, 255)),
        (6,  h - 30, w - 7, h - 23, (0,  100,  0, 255)),
        (8,  h - 33, w - 9, h - 29, (0,   80,  0, 255)),
    ]
    for x0, y0, x1, y1, col in layers:
        d.ellipse([x0, y0, x1, y1], fill=col)
    return img


def make_pine_tree(size=(14, 36)) -> Image.Image:
    """Triangular pine / conifer."""
    w, h = size
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # trunk
    tx = w // 2 - 1
    d.rectangle([tx, h - 6, tx + 1, h - 1], fill=(101, 67, 33, 255))
    # three triangular tiers
    tiers = [
        (1, h - 12, w // 2, h - 18, (34, 120, 34, 255)),
        (0, h - 20, w // 2, h - 28, (0,  100,  0, 255)),
        (2, h - 26, w // 2, h - 36, (0,   80,  0, 255)),
    ]
    for bx, by, cx, cy, col in tiers:
        d.polygon([(bx, by), (w - 1 - bx, by), (cx, cy)], fill=col)
    return img


def make_small_tree(size=(12, 20)) -> Image.Image:
    """Compact round sapling."""
    w, h = size
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    tx = w // 2 - 1
    d.rectangle([tx, h - 6, tx + 1, h - 1], fill=(120, 80, 40, 255))
    d.ellipse([1, 0, w - 2, h - 5], fill=(50, 160, 50, 255))
    d.ellipse([3, 2, w - 4, h - 7], fill=(30, 130, 30, 255))
    return img


def make_shrub(size=(10, 8)) -> Image.Image:
    """Low rounded shrub."""
    w, h = size
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([0, 1, w - 1, h - 1], fill=(56, 142, 60, 255))
    d.ellipse([2, 0, w - 3, h - 2], fill=(76, 175, 80, 255))
    return img


def make_flower_bed(size=(12, 8)) -> Image.Image:
    """Small patch of colourful flowers on a green base."""
    w, h = size
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # green base
    d.rectangle([0, h - 3, w - 1, h - 1], fill=(60, 140, 60, 255))
    # flowers: red, yellow, pink, white, purple
    flowers = [
        (1, h - 5, (220, 50, 50, 255)),
        (4, h - 6, (255, 220, 0, 255)),
        (7, h - 5, (255, 105, 180, 255)),
        (10, h - 4, (200, 200, 255, 255)),
        (3, h - 4, (180, 0, 200, 255)),
    ]
    for fx, fy, col in flowers:
        d.rectangle([fx, fy, fx + 1, fy + 1], fill=col)
    return img


def make_park_bench(size=(16, 10)) -> Image.Image:
    """Simple side-on bench: two legs, seat, back-rest."""
    w, h = size
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    wood = (139, 90, 43, 255)
    dark = (100, 60, 20, 255)
    # legs
    d.rectangle([1, h - 4, 3, h - 1], fill=dark)
    d.rectangle([w - 4, h - 4, w - 2, h - 1], fill=dark)
    # seat
    d.rectangle([0, h - 5, w - 1, h - 4], fill=wood)
    # back-rest planks
    d.rectangle([0, h - 9, w - 1, h - 8], fill=wood)
    d.rectangle([0, h - 7, w - 1, h - 6], fill=wood)
    # back-rest supports
    d.rectangle([2, h - 9, 3, h - 5], fill=dark)
    d.rectangle([w - 4, h - 9, w - 3, h - 5], fill=dark)
    return img


def make_lamppost(size=(6, 20)) -> Image.Image:
    """Thin pole with a small glow at the top."""
    w, h = size
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx = w // 2
    # pole
    d.rectangle([cx - 1, 3, cx, h - 1], fill=(80, 80, 80, 255))
    # base
    d.rectangle([cx - 2, h - 3, cx + 1, h - 1], fill=(60, 60, 60, 255))
    # lamp housing
    d.rectangle([cx - 2, 2, cx + 1, 4], fill=(50, 50, 50, 255))
    # glow
    d.ellipse([cx - 2, 0, cx + 2, 3], fill=(255, 240, 100, 220))
    return img


def make_iron_fence(size=(32, 12)) -> Image.Image:
    """Horizontal fence segment: two rails with evenly-spaced pickets."""
    w, h = size
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rail_col = (60, 60, 60, 255)
    picket_col = (80, 80, 80, 255)
    tip_col = (120, 120, 120, 255)
    # top and bottom rails
    d.rectangle([0, 2, w - 1, 3], fill=rail_col)
    d.rectangle([0, h - 4, w - 1, h - 3], fill=rail_col)
    # pickets every 4 px
    for px in range(0, w, 4):
        d.rectangle([px, 1, px, h - 2], fill=picket_col)
        # pointed tip
        d.point((px, 0), fill=tip_col)
    return img


# ---------------------------------------------------------------------------
# Build all assets and manifest
# ---------------------------------------------------------------------------

def main():
    manifest = {}

    # --- g1 grass terrain tiles ---
    grass_indices = {
        "grass_tile_0": 1955,
        "grass_tile_1": 1956,
        "grass_tile_2": 1957,
        "grass_tile_3": 1958,
    }
    for key, idx in grass_indices.items():
        fname = f"{key}.png"
        copy_g1(idx, fname)
        img = Image.open(OUT_DIR / fname)
        manifest[key] = {
            "file": f"assets/decorations/{fname}",
            "size": list(img.size),
            "category": "terrain",
            "source": f"rct2-g1:{idx}",
        }
        print(f"  [g1]   {key}  {img.size}")

    # --- g1 hedge sprites ---
    hedge_indices = {
        "hedge_0": 21179,
        "hedge_1": 21182,
    }
    for key, idx in hedge_indices.items():
        fname = f"{key}.png"
        copy_g1(idx, fname)
        img = Image.open(OUT_DIR / fname)
        manifest[key] = {
            "file": f"assets/decorations/{fname}",
            "size": list(img.size),
            "category": "hedge",
            "source": f"rct2-g1:{idx}",
        }
        print(f"  [g1]   {key}  {img.size}")

    # --- Procedural sprites ---
    procedural = [
        ("oak_tree",    (20, 32), "tree",      make_oak_tree),
        ("pine_tree",   (14, 36), "tree",      make_pine_tree),
        ("small_tree",  (12, 20), "tree",      make_small_tree),
        ("shrub",       (10,  8), "shrub",     make_shrub),
        ("flower_bed",  (12,  8), "shrub",     make_flower_bed),
        ("park_bench",  (16, 10), "furniture", make_park_bench),
        ("lamppost",    ( 6, 20), "furniture", make_lamppost),
        ("iron_fence",  (32, 12), "fence",     make_iron_fence),
    ]

    for key, size, category, fn in procedural:
        fname = f"{key}.png"
        img = fn(size)
        img.save(OUT_DIR / fname)
        manifest[key] = {
            "file": f"assets/decorations/{fname}",
            "size": list(size),
            "category": category,
            "source": "procedural",
        }
        print(f"  [proc] {key}  {size}")

    # --- Write manifest ---
    manifest_path = OUT_DIR / "decoration-manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\nWrote manifest: {manifest_path}")
    print(f"Total assets: {len(manifest)}")


if __name__ == "__main__":
    main()
