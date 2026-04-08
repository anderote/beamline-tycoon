#!/usr/bin/env python3
"""Dev server: serves the game + handles tile saves from the asset dashboard."""

import http.server
import json
import base64
import os
from urllib.parse import urlparse
from pathlib import Path

PORT = 8001
TILES_DIR = Path("assets/tiles")
MANIFEST = TILES_DIR / "tile-manifest.json"


class DevHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == "/api/save-tile":
            self._handle_save_tile()
        else:
            self.send_error(404)

    def _handle_save_tile(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))

        game_id = body["gameId"]
        section = body["section"]
        image_b64 = body["imageData"]  # base64 PNG
        width = body.get("width", 64)
        height = body.get("height", 64)
        upscale = body.get("upscale", False)

        # Decode PNG
        png_data = base64.b64decode(image_b64)

        # Optionally upscale with nearest-neighbor
        if upscale:
            try:
                from PIL import Image
                import io
                img = Image.open(io.BytesIO(png_data))
                img = img.resize((width, height), Image.NEAREST)
                buf = io.BytesIO()
                img.save(buf, format="PNG")
                png_data = buf.getvalue()
            except ImportError:
                pass  # No PIL, save as-is

        # Write PNG
        TILES_DIR.mkdir(parents=True, exist_ok=True)

        # Update manifest
        manifest = {}
        if MANIFEST.exists():
            manifest = json.loads(MANIFEST.read_text())

        if section == "zones":
            # Zone tiles: append as a new variant
            entry = manifest.get(game_id, {"files": [], "section": section, "size": {"width": width, "height": height}})
            files = entry.get("files", [])
            idx = len(files)
            tile_path = TILES_DIR / f"{game_id}_{idx}.png"
            tile_path.write_bytes(png_data)
            files.append(f"assets/tiles/{game_id}_{idx}.png")
            entry["files"] = files
            entry["section"] = section
            entry["size"] = {"width": width, "height": height}
            manifest[game_id] = entry
        else:
            # Flooring: single file, replace
            tile_path = TILES_DIR / f"{game_id}.png"
            tile_path.write_bytes(png_data)
            manifest[game_id] = {
                "file": f"assets/tiles/{game_id}.png",
                "section": section,
                "size": {"width": width, "height": height},
            }

        MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")

        # Response
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True, "path": str(tile_path)}).encode())

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()


if __name__ == "__main__":
    os.chdir(Path(__file__).parent)
    print(f"Dev server on http://localhost:{PORT}")
    print(f"  Game:      http://localhost:{PORT}/")
    print(f"  Dashboard: http://localhost:{PORT}/tools/asset-dashboard.html")
    http.server.HTTPServer(("", PORT), DevHandler).serve_forever()
