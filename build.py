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


def make_icons():
    from PIL import Image, ImageDraw, ImageFont

    for size in (192, 512):
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        r = size // 5
        # Rounded-square gradient-ish background
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=(20, 23, 34, 255))
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, outline=(109, 127, 247, 255), width=max(2, size // 48))
        # "ITE" text
        font = None
        for name in ("DejaVuSans-Bold.ttf", "DejaVuSans.ttf"):
            try:
                font = ImageFont.truetype(name, int(size * 0.34))
                break
            except OSError:
                continue
        text = "ITE"
        if font:
            bbox = d.textbbox((0, 0), text, font=font)
            w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
            d.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]), text, font=font, fill=(122, 139, 250, 255))
        else:
            d.text((size * 0.3, size * 0.4), text, fill=(122, 139, 250, 255))
        # Accent check mark bar at bottom
        d.rounded_rectangle([size * 0.3, size * 0.72, size * 0.7, size * 0.76], radius=size // 96, fill=(45, 212, 160, 255))
        img.save(DOCS / f"icon-{size}.png")


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
