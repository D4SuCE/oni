"""Generates src/assets/backdrop.svg: the window's ink-and-sakura background
(blossoming branches in the corners, falling petals, red ink splashes, gold brush streaks).
Deterministic (seeded), so the file only changes when this script does.
    python scripts/backdrop.py
"""
import math
import os
import random

W, H = 1600, 1000
rnd = random.Random(7)
out = []


def f(v):
    return f'{v:.1f}'.rstrip('0').rstrip('.')


def branch(points, width):
    """A tapering branch through the points, drawn as overlapping strokes."""
    for i in range(len(points) - 1):
        (x0, y0), (x1, y1) = points[i], points[i + 1]
        w = width * (1 - i / len(points)) + 1.2
        mx, my = (x0 + x1) / 2 + rnd.uniform(-14, 14), (y0 + y1) / 2 + rnd.uniform(-14, 14)
        out.append(f'<path d="M{f(x0)} {f(y0)} Q{f(mx)} {f(my)} {f(x1)} {f(y1)}" stroke="#4a2a22" stroke-width="{f(w)}" stroke-linecap="round" fill="none"/>')


def blossom(x, y, r, alpha=1.0):
    rot = rnd.uniform(0, 72)
    shade = rnd.choice(['#f2b8c0', '#e796a3', '#d9677b', '#f6d3d8'])
    petals = ''.join(
        f'<ellipse cx="0" cy="{f(-r * 0.55)}" rx="{f(r * 0.42)}" ry="{f(r * 0.6)}" transform="rotate({f(rot + k * 72)})"/>' for k in range(5)
    )
    out.append(
        f'<g transform="translate({f(x)} {f(y)})" opacity="{f(alpha)}"><g fill="{shade}">{petals}</g>'
        f'<circle r="{f(r * 0.22)}" fill="#b8323f"/><circle r="{f(r * 0.09)}" fill="#f3d58a"/></g>'
    )


def petal(x, y, s, alpha):
    out.append(
        f'<path d="M0 0 C{f(s * 0.6)} {f(-s * 0.4)} {f(s * 1.1)} {f(s * 0.2)} 0 {f(s)} C{f(-s * 0.9)} {f(s * 0.3)} {f(-s * 0.5)} {f(-s * 0.3)} 0 0 Z" '
        f'fill="#e796a3" opacity="{f(alpha)}" transform="translate({f(x)} {f(y)}) rotate({f(rnd.uniform(0, 360))})"/>'
    )


def splash(cx, cy, r, color, alpha):
    """An irregular ink blot: a wobbly closed curve plus a few droplets."""
    n = 14
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        rr = r * rnd.uniform(0.55, 1.25)
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    d = f'M{f(pts[0][0])} {f(pts[0][1])} ' + ' '.join(
        f'Q{f(pts[k][0])} {f(pts[k][1])} {f((pts[k][0] + pts[(k + 1) % n][0]) / 2)} {f((pts[k][1] + pts[(k + 1) % n][1]) / 2)}' for k in range(n)
    ) + ' Z'
    out.append(f'<path d="{d}" fill="{color}" opacity="{f(alpha)}"/>')
    for _ in range(rnd.randint(4, 9)):
        a = rnd.uniform(0, 2 * math.pi)
        dist = r * rnd.uniform(1.3, 2.6)
        out.append(f'<circle cx="{f(cx + dist * math.cos(a))}" cy="{f(cy + dist * math.sin(a))}" r="{f(rnd.uniform(2, r * 0.16))}" fill="{color}" opacity="{f(alpha)}"/>')


def streak(x, y, length, angle, width, color, alpha):
    """A dry-brush stroke: a long thin tapered shape with ragged bristle lines."""
    ca, sa = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    def at(t, off):
        return x + ca * t - sa * off, y + sa * t + ca * off
    body = [at(0, 0), at(length * 0.15, -width / 2), at(length * 0.85, -width * 0.3), at(length, 0), at(length * 0.8, width * 0.35), at(length * 0.1, width / 2)]
    d = 'M' + ' L'.join(f'{f(px)} {f(py)}' for px, py in body) + ' Z'
    out.append(f'<path d="{d}" fill="{color}" opacity="{f(alpha)}"/>')
    for _ in range(5):
        off = rnd.uniform(-width, width)
        t0, t1 = rnd.uniform(0, length * 0.3), rnd.uniform(length * 0.6, length * 1.1)
        (ax, ay), (bx, by) = at(t0, off), at(t1, off * 0.6)
        out.append(f'<path d="M{f(ax)} {f(ay)} L{f(bx)} {f(by)}" stroke="{color}" stroke-width="{f(rnd.uniform(0.8, 2.4))}" opacity="{f(alpha * 0.8)}" stroke-linecap="round"/>')


# red ink and gold streaks first, so the branches sit on top
for cx, cy, r in [(1450, 140, 70), (1520, 860, 90), (1180, 960, 60), (60, 520, 40), (840, -20, 50), (1590, 520, 55)]:
    splash(cx, cy, r, '#9c1418', 0.55)
for x, y, l, a, w, c, al in [
    (1080, 360, 520, -28, 22, '#b3171b', 0.42), (1180, 470, 380, -30, 10, '#c9973e', 0.5), (980, 980, 520, -32, 26, '#b3171b', 0.38),
    (1240, 900, 300, -34, 9, '#c9973e', 0.45), (180, 980, 360, -26, 14, '#b3171b', 0.32), (1320, 120, 260, -24, 8, '#c9973e', 0.4),
]:
    streak(x, y, l, a, w, c, al)

# branches with blossoms: top-left and bottom-left corners, one reaching in from the top right
for pts, width, n in [
    ([(-30, 70), (90, 110), (200, 96), (300, 150), (390, 140)], 13, 34),
    ([(-20, 210), (70, 230), (150, 300)], 8, 12),
    ([(-30, 930), (80, 860), (170, 820), (250, 730), (290, 650)], 12, 30),
    ([(1620, 40), (1530, 70), (1460, 60), (1400, 110)], 9, 16),
]:
    branch(pts, width)
    for _ in range(n):
        i = rnd.randrange(len(pts) - 1)
        t = rnd.random()
        x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t + rnd.uniform(-34, 34)
        y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t + rnd.uniform(-30, 30)
        blossom(x, y, rnd.uniform(7, 15), rnd.uniform(0.75, 1))

# petals drifting across the window, denser at the edges
for _ in range(70):
    x = rnd.choice([rnd.uniform(0, 380), rnd.uniform(1250, W), rnd.uniform(0, W)])
    y = rnd.uniform(0, H)
    petal(x, y, rnd.uniform(5, 11), rnd.uniform(0.3, 0.8))

svg = (
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice">\n'
    '<!-- Generated by scripts/backdrop.py: sakura branches, petals, red ink and gold streaks. -->\n'
    + '\n'.join(out)
    + '\n</svg>\n'
)
path = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'backdrop.svg')
open(path, 'w', encoding='utf8').write(svg)
print(path, len(svg) // 1024, 'KB')
