"""Builds src/assets/brush.woff2: a Japanese brush font cut down to the few kanji the UI
shows (鬼 in the logo, the hero's vertical line, the genre seals on mix covers).

The full font is megabytes; the subset is a few kilobytes. Run after changing CHARS:
    python scripts/brush-font.py <path-to-@fontsource-package> [out.woff2]
e.g. python scripts/brush-font.py node_modules/@fontsource/yuji-boku
Needs: pip install fonttools brotli
"""
import io
import os
import re
import sys

from fontTools import subset
from fontTools.merge import Merger
from fontTools.ttLib import TTFont

# Every kanji/kana the interface draws with the brush font. Keep in sync with src/recs seals.
CHARS = '鬼波音楽で生きる発見新作和風電子代替人気激鋼鉄舞踏独立民謡映画古典魂歌反逆即興哀太陽日本韓流'

pkg = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'brush.woff2')
css = open(os.path.join(pkg, '400.css'), encoding='utf8').read()

def ranges(spec):
    for part in spec.split(','):
        part = part.strip().upper().removeprefix('U+')
        if '-' in part:
            a, b = part.split('-')
            yield int(a, 16), int(b, 16)
        elif part:
            yield int(part, 16), int(part, 16)

# fontsource splits CJK fonts into chunks, each with its own unicode-range
chunks = []
for block in re.findall(r'@font-face\s*{(.*?)}', css, re.S):
    file = re.search(r"url\(\./files/([^)]+?\.woff2)\)", block)
    rng = re.search(r'unicode-range:\s*([^;]+);', block)
    if file and rng:
        chunks.append((file.group(1), list(ranges(rng.group(1)))))

needed = {}
for ch in CHARS:
    cp = ord(ch)
    for file, rs in chunks:
        if any(a <= cp <= b for a, b in rs):
            needed.setdefault(file, []).append(ch)
            break
    else:
        print('missing in font:', ch)

parts = []
for file, chars in needed.items():
    font = TTFont(os.path.join(pkg, 'files', file))
    opts = subset.Options()
    opts.flavor = None
    opts.layout_features = ['*']
    sub = subset.Subsetter(opts)
    sub.populate(text=''.join(chars))
    sub.subset(font)
    buf = io.BytesIO()
    font.save(buf)
    parts.append(buf)

tmp = []
for i, b in enumerate(parts):
    p = f'{out}.part{i}.ttf'
    open(p, 'wb').write(b.getvalue())
    tmp.append(p)
merged = Merger().merge(tmp) if len(tmp) > 1 else TTFont(tmp[0])
for p in tmp:
    os.remove(p)
merged.flavor = 'woff2'
merged.save(out)
print(f'{out}: {len(CHARS)} chars from {len(needed)} chunks, {os.path.getsize(out)} bytes')
