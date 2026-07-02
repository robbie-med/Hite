#!/usr/bin/env python3
"""Build the deployable ITE quiz site.

Reads questions.json (produced by parse_pdfs.py), cleans PDF-extraction
artifacts, gzips, and encrypts with AES-256-GCM using a key derived from the
password via PBKDF2-SHA256. Output goes to data.enc at the repo root (GitHub
Pages serves the repo root) so the plaintext bank never enters the git repo.

Usage:
    python3 build.py --password 'YourSecretPassword'

The PBKDF2 salt is persisted in .salt (gitignored) so rebuilding with the
same password keeps "remember this device" logins working.
"""
import argparse
import base64
import gzip
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


def load_questions() -> list:
    with open(ROOT / "questions.json") as f:
        raw = json.load(f)
    slim = []
    for q in raw:
        if not q.get("correctAnswer"):
            continue
        slim.append({
            "k": f"{q['year']}-{q['id']}",
            "y": q["year"],
            "n": q["id"],
            "q": clean_text(q["question"]),
            "c": {L: clean_text(t) for L, t in sorted(q["choices"].items())},
            "a": q["correctAnswer"],
            "e": clean_text(q.get("explanation", "")),
            "d": q.get("domain", "General Medicine"),
        })
    return slim


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


def stamp_sw_version(data: bytes):
    sw = DOCS / "sw.js"
    src = sw.read_text()
    h = hashlib.sha256(data + (DOCS / "index.html").read_bytes()).hexdigest()[:12]
    src = re.sub(r"const VERSION = '[^']*'", f"const VERSION = '{h}'", src)
    sw.write_text(src)
    return h


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--password", required=True, help="Password that will unlock the site")
    args = ap.parse_args()

    questions = load_questions()
    domains = {}
    for q in questions:
        domains[q["d"]] = domains.get(q["d"], 0) + 1
    payload = json.dumps(questions, separators=(",", ":"), ensure_ascii=False).encode()
    gz = gzip.compress(payload, 9)
    enc = encrypt(gz, args.password, get_salt())

    (DOCS / "data.enc").write_bytes(enc)
    make_icons()
    ver = stamp_sw_version(enc)

    print(f"questions : {len(questions)}")
    print(f"domains   : {len(domains)}")
    print(f"plaintext : {len(payload):,} bytes")
    print(f"gzipped   : {len(gz):,} bytes")
    print(f"encrypted : {len(enc):,} bytes -> data.enc")
    print(f"sw version: {ver}")


if __name__ == "__main__":
    main()
