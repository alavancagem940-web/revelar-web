#!/usr/bin/env python3
"""Gera PNG do ícone e o perfil .mobileconfig (Web Clip) do Revelar."""

from __future__ import annotations

import base64
import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
ICONS = PUBLIC / "icons"

BG = (18, 18, 18, 255)
GOLD = (232, 184, 109, 255)


def chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png(path: Path, width: int, height: int, rgba: bytes) -> None:
    raw = b"".join(b"\x00" + rgba[y * width * 4 : (y + 1) * width * 4] for y in range(height))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def blend(dst: bytearray, i: int, color: tuple[int, int, int, int], a: float) -> None:
    inv = 1.0 - a
    dst[i] = int(dst[i] * inv + color[0] * a)
    dst[i + 1] = int(dst[i + 1] * inv + color[1] * a)
    dst[i + 2] = int(dst[i + 2] * inv + color[2] * a)
    dst[i + 3] = 255


def draw_icon(size: int, *, padded: bool) -> bytes:
    px = bytearray(size * size * 4)
    for i in range(0, len(px), 4):
        px[i : i + 4] = bytes(BG)

    cx = cy = (size - 1) / 2.0
    ring_r = size * (0.28 if padded else 0.32)
    ring_w = size * 0.045
    inner_r = size * (0.09 if padded else 0.105)
    spoke = size * (0.40 if padded else 0.44)

    for y in range(size):
        for x in range(size):
            dx = x - cx
            dy = y - cy
            dist = math.hypot(dx, dy)
            i = (y * size + x) * 4
            ring = max(0.0, 1.0 - abs(dist - ring_r) / ring_w)
            if ring > 0:
                blend(px, i, GOLD, min(1.0, ring))
            if dist <= inner_r:
                cover = min(1.0, inner_r - dist + 0.5)
                blend(px, i, GOLD, cover)
            for angle in (0, 90, 180, 270):
                rad = math.radians(angle)
                sx = math.cos(rad)
                sy = math.sin(rad)
                proj = dx * sx + dy * sy
                perp = abs(-dx * sy + dy * sx)
                if 0 <= proj <= spoke and perp < size * 0.018 and dist > ring_r + ring_w * 0.4:
                    blend(px, i, GOLD, 1.0 - perp / (size * 0.018))
    return bytes(px)


def mobileconfig(icon_png: bytes) -> str:
    b64 = base64.encodebytes(icon_png).decode("ascii")
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>FullScreen</key>
      <true/>
      <key>Icon</key>
      <data>
{b64}      </data>
      <key>IsRemovable</key>
      <true/>
      <key>Label</key>
      <string>Revelar</string>
      <key>PayloadDescription</key>
      <string>Atalho do Revelar na Tela de Início</string>
      <key>PayloadDisplayName</key>
      <string>Revelar</string>
      <key>PayloadIdentifier</key>
      <string>web.revelar.webclip</string>
      <key>PayloadType</key>
      <string>com.apple.webClip.managed</string>
      <key>PayloadUUID</key>
      <string>7A3E9C12-4B8F-4D21-9E06-2C5A8F1B6D40</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>Precomposed</key>
      <true/>
      <key>URL</key>
      <string>https://alavancagem940-web.github.io/revelar-web/</string>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>Coloca o Revelar na Tela de Início como um aplicativo.</string>
  <key>PayloadDisplayName</key>
  <string>Revelar</string>
  <key>PayloadIdentifier</key>
  <string>web.revelar</string>
  <key>PayloadOrganization</key>
  <string>Revelar</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>1F6B2A90-8C34-4E17-B5D8-9A0C3E7F2146</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
"""


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)
    icon512 = draw_icon(512, padded=False)
    maskable = draw_icon(512, padded=True)
    icon192 = draw_icon(192, padded=False)
    apple = draw_icon(180, padded=False)
    write_png(ICONS / "icon-512.png", 512, 512, icon512)
    write_png(ICONS / "icon-512-maskable.png", 512, 512, maskable)
    write_png(ICONS / "icon-192.png", 192, 192, icon192)
    apple_path = PUBLIC / "apple-touch-icon.png"
    write_png(apple_path, 180, 180, apple)
    write_png(ICONS / "webclip-180.png", 180, 180, apple)
    (PUBLIC / "revelar.mobileconfig").write_text(
        mobileconfig(apple_path.read_bytes()), encoding="utf-8"
    )
    print("ícones e perfil gerados")


if __name__ == "__main__":
    main()
