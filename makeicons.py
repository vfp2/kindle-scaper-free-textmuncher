#!/usr/bin/env python3
"""
Generate icon16.png / icon48.png / icon128.png for the
"Kindle to Markdown Exporter" Firefox extension.

Usage:
    python3 make_icons.py
"""

import struct
import zlib

# --- Palette ---------------------------------------------------------------
ORANGE = (255, 153, 0, 255)   # #ff9900  (Kindle orange)
WHITE  = (255, 255, 255, 255)
CLEAR  = (0, 0, 0, 0)


def in_rrect(x, y, x0, y0, x1, y1, r):
    """Point-in-rounded-rectangle test."""
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= r * r


def color_at(nx, ny):
    """RGBA colour for a point in normalised [0,1] space."""
    # Background rounded square
    if not in_rrect(nx, ny, 0.0, 0.0, 1.0, 1.0, 0.18):
        return CLEAR

    col = ORANGE

    # Book / document body
    if in_rrect(nx, ny, 0.22, 0.16, 0.78, 0.66, 0.05):
        col = WHITE

    # "Text" lines inside the book
    for ly in (0.255, 0.345, 0.435):
        if 0.30 <= nx <= 0.70 and ly <= ny <= ly + 0.045:
            col = ORANGE

    # Download arrow - shaft
    if 0.44 <= nx <= 0.56 and 0.62 <= ny <= 0.78:
        col = WHITE

    # Download arrow - head (triangle)
    if 0.78 <= ny <= 0.94:
        t = (ny - 0.78) / 0.16
        half = 0.22 * (1.0 - t)
        if abs(nx - 0.5) <= half:
            col = WHITE

    return col


def render(size, ss=4):
    """Render the icon at `size` px with ss x ss supersampling."""
    samples = ss * ss
    buf = bytearray(size * size * 4)

    for py in range(size):
        for px in range(size):
            sr = sg = sb = sa = 0
            for sy in range(ss):
                ny = (py + (sy + 0.5) / ss) / size
                for sx in range(ss):
                    nx = (px + (sx + 0.5) / ss) / size
                    cr, cg, cb, ca = color_at(nx, ny)
                    sr += cr * ca
                    sg += cg * ca
                    sb += cb * ca
                    sa += ca

            alpha = sa / samples
            if sa:
                r, g, b = round(sr / sa), round(sg / sa), round(sb / sa)
            else:
                r = g = b = 0

            i = (py * size + px) * 4
            buf[i]     = min(255, max(0, r))
            buf[i + 1] = min(255, max(0, g))
            buf[i + 2] = min(255, max(0, b))
            buf[i + 3] = min(255, max(0, round(alpha)))

    return buf


def write_png(path, size, rgba):
    """Write an RGBA buffer out as a PNG file."""
    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)                                  # filter type 0 (None)
        raw += rgba[y * stride:(y + 1) * stride]

    png  = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')

    with open(path, 'wb') as fh:
        fh.write(png)
    return len(png)


if __name__ == '__main__':
    for s in (16, 48, 128):
        name = 'icon%d.png' % s
        n = write_png(name, s, render(s))
        print('wrote %-12s (%d bytes)' % (name, n))