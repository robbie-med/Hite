#!/usr/bin/env python3
"""Rebuild symbols.woff2, the Material Symbols Rounded subset the app ships.

The app never loads fonts from the network: styles.css points at this file and the
service worker precaches it. This script is a maintainer step. It collects every
icon name used by app.js (ICONS table and <span class="… ms …"> literals),
index.html and styles.css (content: '…'), downloads the variable font from Google
Fonts once (or reads it from --source), keeps only the glyphs those ligatures need
with FILL/opsz/wght variable and GRAD pinned at 0, and verifies each name.
Run it after adding an icon, then `python3 build.py --assets-only` to re-stamp
the version (the font is part of the version hash).

    python3 tools/build_symbols.py                      # fetch + subset
    python3 tools/build_symbols.py --source full.woff2  # subset a font already on disk
    python3 tools/build_symbols.py --check              # verify the current font only (offline)

Requires fonttools >= 4.40 and brotli (pip install --user fonttools brotli).
"""
import io
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FONT = ROOT / "symbols.woff2"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
CSS_URL = ("https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded"
           ":opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&text=")
# Icons referenced from code the regexes below cannot see (ternaries, option tables).
EXTRA = {"visibility", "visibility_off", "check", "close", "chevron_left", "chevron_right",
         "brightness_auto", "light_mode", "dark_mode", "ios_share", "more_vert", "palette"}


def used_names() -> set[str]:
    app = (ROOT / "app.js").read_text()
    idx = (ROOT / "index.html").read_text()
    css = (ROOT / "styles.css").read_text()
    names = set(EXTRA)
    icons = app.split("const ICONS = {", 1)[1].split("\n};", 1)[0]
    names |= set(re.findall(r"\['([a-z0-9_]+)', '", icons))                                   # ICONS table
    names |= set(re.findall(r'class="(?:[a-z-]+ )*ms(?: [a-z-]+)*"[^>]*>([a-z0-9_]+)<', app + idx))  # literal spans
    names |= set(re.findall(r"content: '([a-z0-9_]+)'; font-family: 'Material Symbols", css))
    names |= set(re.findall(r"\['[a-z]+', '[A-Z][a-z]+', '([a-z0-9_]+)'\]", app))            # segCtl [value, Label, icon]
    return names


def ligatures(font):
    """(cmap, {component glyph tuple: ligature glyph}) for every GSUB ligature."""
    cmap = font.getBestCmap()
    ligs = {}
    for lookup in font["GSUB"].table.LookupList.Lookup:
        for st in lookup.SubTable:
            if st.LookupType == 7:
                st = st.ExtSubTable
            if st.LookupType == 4:
                for first, lst in st.ligatures.items():
                    for lig in lst:
                        ligs[(first,) + tuple(lig.Component)] = lig.LigGlyph
    return cmap, ligs


def components(cmap, name: str):
    try:
        return tuple(cmap[ord(c)] for c in name)
    except KeyError:
        return None


def check(names: set[str], path: Path = FONT) -> list[str]:
    from fontTools.ttLib import TTFont
    cmap, ligs = ligatures(TTFont(path))
    return sorted(n for n in names if components(cmap, n) not in ligs)


def fetch(names: set[str]) -> bytes:
    """The variable font from Google Fonts. text= limits the cmap to these letters but the
    file still carries every icon outline (~5 MB); subset() does the real work."""
    url = CSS_URL + urllib.parse.quote(" ".join(sorted(names)), safe="")
    css = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30).read().decode()
    m = re.search(r"url\((https://fonts\.gstatic\.com/[^)]+)\)\s*format\('woff2'\)", css)
    if not m:
        raise SystemExit("Google Fonts did not return a woff2 URL:\n" + css[:400])
    last = None
    for attempt in range(6):                      # gstatic answers 504 now and then
        try:
            return urllib.request.urlopen(urllib.request.Request(m.group(1), headers={"User-Agent": UA}), timeout=60).read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(5 * (attempt + 1))
    raise SystemExit(f"could not download the font: {last}")


def subset(data: bytes, names: set[str]) -> bytes:
    """Keep exactly the letters and ligature glyphs these names need. The GSUB closure
    cannot be used: every icon name is spelt from the same letters, so closure keeps all
    5,900 icons. GRAD is pinned at 0 (styles.css always sets 'GRAD' 0)."""
    from fontTools import subset as fs
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer
    font = TTFont(io.BytesIO(data))
    cmap, ligs = ligatures(font)
    glyphs = {".notdef", cmap[ord(" ")]}
    for n in sorted(names):
        comps = components(cmap, n)
        if comps is None or comps not in ligs:
            raise SystemExit(f"source font has no icon named {n!r} (misspelled?)")
        glyphs |= set(comps)
        glyphs.add(ligs[comps])
    opts = fs.Options()
    opts.layout_features = ["rlig", "rclt"]     # the features Material Symbols uses for its ligatures
    opts.layout_closure = False
    opts.notdef_outline = True
    sub = fs.Subsetter(opts)
    sub.populate(glyphs=sorted(glyphs))
    sub.subset(font)
    if "fvar" in font and any(a.axisTag == "GRAD" for a in font["fvar"].axes):
        font = instancer.instantiateVariableFont(font, {"GRAD": 0}, inplace=True, updateFontNames=False)
    font.flavor = "woff2"
    out = io.BytesIO()
    font.save(out)
    return out.getvalue()


def main() -> None:
    names = used_names()
    if "--check" in sys.argv:
        missing = check(names)
        print(f"{len(names)} icon names used; {FONT.name} {'has them all' if not missing else 'is MISSING: ' + ', '.join(missing)}")
        sys.exit(1 if missing else 0)
    before = check(names) if FONT.exists() else sorted(names)
    src = Path(sys.argv[sys.argv.index("--source") + 1]).read_bytes() if "--source" in sys.argv else fetch(names)
    data = subset(src, names)
    tmp = FONT.with_suffix(".new.woff2")
    tmp.write_bytes(data)
    missing = check(names, tmp)
    if missing:
        tmp.unlink()
        raise SystemExit("new font lacks: " + ", ".join(missing))
    tmp.replace(FONT)
    print(f"{FONT.name}: {len(data):,} bytes, {len(names)} icons, all present (was missing: {', '.join(before) or 'none'})")
    print("now run: python3 build.py --assets-only")


if __name__ == "__main__":
    main()
