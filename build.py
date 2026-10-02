#!/usr/bin/env python3
"""Build the deployable ITE quiz site.

Reads questions.json (produced by parse_pdfs.py), cleans PDF-extraction
artifacts, gzips, and encrypts with AES-256-GCM using a key derived from the
password via PBKDF2-SHA256. Output goes to data.enc at the repo root (GitHub
Pages serves the repo root) so the plaintext bank never enters the git repo.

Usage:
    python3 build.py --password 'YourSecretPassword'   # rebuild data.enc + stamp version
    python3 build.py --assets-only                     # app code changed only: re-stamp version

The version hash covers data.enc, images.enc, index.html, app.js, styles.css and exam-meta.js; it is
stamped into sw.js (cache name), app.js (About screen) and the ?v= query on
the asset tags in index.html so every client picks up the new files.

The PBKDF2 salt is persisted in .salt (gitignored) so rebuilding with the
same password keeps "remember this device" logins working.
"""
import argparse
import base64
import gzip
import subprocess
import hashlib
import json
import os
import re
import sys
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent
DOCS = ROOT  # site is served from the repo root
ITERATIONS = 310_000
MAGIC = b"ITE1"


def clean_text(s: str) -> str:
    """Fix PDF extraction artifacts: dot-leader glyphs and hard line wraps."""
    # Dot leaders (private-use glyphs) followed by a newline separate a lab
    # label from its value — join them onto one line.
    s = re.sub(r"\s*[\uE000-\uF8FF]+\s*\n\s*", " … ", s)
    s = re.sub(r"\s*[\uE000-\uF8FF]+\s*", " … ", s)
    # Reflow prose: keep lab-table rows (containing …) on their own lines,
    # join everything else with spaces.
    out = []
    for line in s.split("\n"):
        line = re.sub(r"[ \t]+", " ", line).strip()
        if not line:
            continue
        if not out or "…" in line or "…" in out[-1]:
            out.append(line)
        else:
            out[-1] += " " + line
    return "\n".join(out)


# Older forms ship only their hardest questions (ABFM difficulty band >= this),
# minus items ABFM removed from scoring. None = form not included (2019's handbook
# has no real difficulty data). Forms not listed ship every question.
OLDER_FORMS = {2019: None, 2020: 500, 2021: 500}


def exam_meta() -> dict:
    """window.EXAM_META from exam-meta.js, read through Node (no JS parsing in Python)."""
    js = "global.window={};require(process.argv[1]);console.log(JSON.stringify(window.EXAM_META))"
    try:
        return json.loads(subprocess.check_output(["node", "-e", js, str(ROOT / "exam-meta.js")]))
    except (OSError, subprocess.CalledProcessError) as e:
        raise SystemExit(f"Need Node.js to read exam-meta.js for the older-form filter: {e}")


def included(q, meta) -> bool:
    y, n = q["year"], q["id"]
    if y not in OLDER_FORMS:
        return True
    cutoff = OLDER_FORMS[y]
    if cutoff is None:
        return False
    if str(n) in meta.get("removed", {}).get(str(y), {}):
        return False
    bands = meta.get("difficulty", {}).get(str(y), {})
    band = next((int(b) for b, ns in bands.items() if n in ns), None)
    return band is not None and band >= cutoff


def load_annotations() -> dict:
    """annotations.json (gitignored): {"year-id": {"ai": {"s", "w"}, "er": "..."}} merged into the bank."""
    p = ROOT / "annotations.json"
    if not p.exists():
        return {}
    return {k: v for k, v in json.loads(p.read_text()).items() if not k.startswith("_")}


def load_questions() -> tuple:
    """(bank, images): the slim question list for data.enc and {key: [data URL, …]}
    for images.enc. Items with figures carry "im" (how many) so the app can hold
    a placeholder until images.enc has loaded."""
    with open(ROOT / "questions.json") as f:
        raw = json.load(f)
    meta, notes = exam_meta(), load_annotations()
    slim, images = [], {}
    for q in raw:
        if not q.get("correctAnswer") or not included(q, meta):
            continue
        note = notes.get(f"{q['year']}-{q['id']}", {})
        if q.get("images"):
            images[f"{q['year']}-{q['id']}"] = q["images"]
        slim.append({
            "k": f"{q['year']}-{q['id']}",
            "y": q["year"],
            "n": q["id"],
            "q": clean_text(q["question"]),
            "c": {L: clean_text(t) for L, t in sorted(q["choices"].items())},
            "a": q["correctAnswer"],
            "e": clean_text(q.get("explanation", "")),
            "d": q.get("domain", "General Medicine"),
            **({"im": len(q["images"])} if q.get("images") else {}),
            **({"ai": note["ai"]} if note.get("ai") else {}),
            **({"er": note["er"]} if note.get("er") else {}),
        })
    return slim, images


def get_salt() -> bytes:
    salt_path = ROOT / ".salt"
    if salt_path.exists():
        return salt_path.read_bytes()
    salt = os.urandom(16)
    salt_path.write_bytes(salt)
    return salt


def encrypt(payload: bytes, password: str, salt: bytes) -> bytes:
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS, dklen=32)
    iv = os.urandom(12)
    ct = AESGCM(key).encrypt(iv, payload, None)
    return MAGIC + salt + iv + ct


# ---- app icon: graduation cap on the default indigo (theme.js DEFAULT_SEED, tone 40) ----
ICON_BG, ICON_BOARD, ICON_BASE = "#4C53BA", "#FFFFFF", "#DBE1FF"


def _cubic(p0, p1, p2, p3, n=24):
    return [tuple((1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d
                  for a, b, c, d in zip(p0, p1, p2, p3)) for t in (i / n for i in range(n + 1))]


def _cap_shapes():
    """Mortarboard geometry in a 512 box (content spans x 72-456, y 140-388)."""
    board = [(256, 140), (440, 222), (256, 304), (72, 222)]
    base = [(148, 262), (148, 330)] + _cubic((148, 330), (148, 362), (196, 388), (256, 388)) \
        + _cubic((256, 388), (316, 388), (364, 362), (364, 330)) + [(364, 262), (256, 310)]
    return board, base


def icon_svg(full_bleed=False, scale=0.78):
    """SVG master. full_bleed=False gives the rounded-square favicon; True a square for masks."""
    t = f"translate(256 256) scale({scale}) translate(-264 -264)"
    bg = '<rect width="512" height="512" fill="{c}"/>' if full_bleed else '<rect width="512" height="512" rx="112" fill="{c}"/>'
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' + bg.format(c=ICON_BG) +
            f'<g transform="{t}">'
            f'<path d="M148 262v68c0 32 48 58 108 58s108-26 108-58v-68l-108 48z" fill="{ICON_BASE}"/>'
            f'<path d="M256 140l184 82-184 82-184-82z" fill="{ICON_BOARD}"/>'
            f'<path d="M440 222v96" stroke="{ICON_BOARD}" stroke-width="14" stroke-linecap="round"/>'
            f'<circle cx="440" cy="326" r="16" fill="{ICON_BOARD}"/></g></svg>')


def _render(size, full_bleed, scale):
    from PIL import Image, ImageDraw
    S = size * 4                                   # draw large, downsample for clean edges
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = S / 512
    if full_bleed:
        d.rectangle([0, 0, S, S], fill=ICON_BG)
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(112 * k), fill=ICON_BG)
    tf = lambda pts: [((256 + (x - 264) * scale) * k, (256 + (y - 264) * scale) * k) for x, y in pts]
    board, base = _cap_shapes()
    d.polygon(tf(base), fill=ICON_BASE)
    d.polygon(tf(board), fill=ICON_BOARD)
    (x0, y0), (x1, y1) = tf([(440, 222), (440, 318)])
    d.line([(x0, y0), (x1, y1)], fill=ICON_BOARD, width=max(1, int(14 * scale * k)))
    rr = 7 * scale * k                              # round cap where the cord meets the board
    d.ellipse([x0 - rr, y0 - rr, x0 + rr, y0 + rr], fill=ICON_BOARD)
    (cx, cy), = tf([(440, 326)]); r = 16 * scale * k
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ICON_BOARD)
    return img.resize((size, size), Image.LANCZOS)


def make_icons():
    """favicon.svg/.ico, apple-touch-icon (full bleed: iOS rounds it), PWA icons (any + maskable)."""
    (DOCS / "favicon.svg").write_text(icon_svg())
    _render(256, False, 0.78).save(DOCS / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    _render(180, True, 0.70).convert("RGB").save(DOCS / "apple-touch-icon.png")
    for size in (192, 512):
        _render(size, False, 0.78).save(DOCS / f"icon-{size}.png")
        _render(size, True, 0.60).save(DOCS / f"icon-maskable-{size}.png")   # inside the 80% safe zone

ICON_FILES = ("favicon.svg", "favicon.ico", "apple-touch-icon.png", "icon-192.png", "icon-512.png",
              "icon-maskable-192.png", "icon-maskable-512.png")
VERSION_FILES = ("index.html", "app.js", "sw.js", "styles.css")
VERSION_PATTERNS = (
    (r"(const VERSION = ')[^']*(')", r"\g<1>{v}\g<2>"),        # sw.js
    (r"(const APP_VERSION = ')[^']*(')", r"\g<1>{v}\g<2>"),    # app.js
    (r"(\?v=)[0-9a-f_A-Z]+", r"\g<1>{v}"),                     # index.html asset tags
)


def _normalized(path: Path) -> bytes:
    """File contents with any stamped version replaced by a placeholder."""
    text = path.read_text()
    for pat, rep in VERSION_PATTERNS:
        text = re.sub(pat, rep.format(v="__VERSION__"), text)
    return text.encode()


def stamp_version() -> str:
    """Hash the deployable inputs and write the hash into every file that carries it."""
    h = hashlib.sha256()
    h.update((DOCS / "data.enc").read_bytes())
    if (DOCS / "images.enc").exists():
        h.update((DOCS / "images.enc").read_bytes())
    h.update((DOCS / "symbols.woff2").read_bytes())
    for icon in ICON_FILES:
        if (DOCS / icon).exists():
            h.update((DOCS / icon).read_bytes())
    for name in ("index.html", "app.js", "styles.css", "exam-meta.js", "theme.js"):
        h.update(_normalized(DOCS / name))
    ver = h.hexdigest()[:12]
    for name in VERSION_FILES:
        p = DOCS / name
        text = p.read_text()
        for pat, rep in VERSION_PATTERNS:
            text = re.sub(pat, rep.format(v=ver), text)
        p.write_text(text)
    return ver


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--password", help="Password that will unlock the site")
    ap.add_argument("--assets-only", action="store_true",
                    help="Do not rebuild data.enc; just re-stamp the version (and icons with --icons)")
    ap.add_argument("--icons", action="store_true", help="Regenerate icon-*.png (needs Pillow)")
    args = ap.parse_args()

    if not args.assets_only:
        if not args.password:
            ap.error("--password is required unless --assets-only is given")
        questions, images = load_questions()
        domains = {}
        for q in questions:
            domains[q["d"]] = domains.get(q["d"], 0) + 1
        payload = json.dumps(questions, separators=(",", ":"), ensure_ascii=False).encode()
        gz = gzip.compress(payload, 9)
        enc = encrypt(gz, args.password, get_salt())
        (DOCS / "data.enc").write_bytes(enc)
        print(f"questions : {len(questions)}")
        print(f"domains   : {len(domains)}")
        print(f"plaintext : {len(payload):,} bytes")
        print(f"gzipped   : {len(gz):,} bytes")
        print(f"encrypted : {len(enc):,} bytes -> data.enc")
        # Figures go in their own file (same password and salt) so unlocking stays fast;
        # the app fetches it in the background after login.
        img_payload = json.dumps(images, separators=(",", ":")).encode()
        img_enc = encrypt(gzip.compress(img_payload, 9), args.password, get_salt())
        (DOCS / "images.enc").write_bytes(img_enc)
        print(f"images    : {sum(len(v) for v in images.values())} for {len(images)} items · {len(img_enc):,} bytes -> images.enc")
        make_icons()
    elif args.icons:
        make_icons()

    ver = stamp_version()
    print(f"version   : {ver}  (stamped into sw.js, app.js, index.html)")


if __name__ == "__main__":
    main()
