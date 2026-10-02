#!/usr/bin/env python3
"""Audit the encrypted bank against the source PDFs with an independent extractor.

Decrypts data.enc and compares every question in it with the text poppler's
`pdftotext` gets from <year>ITEMultChoice.pdf / <year>ITECritique.pdf (no code
shared with parse_pdfs.py, so a parser bug can't hide itself):

  * answer key == the critique's "ANSWER: X"            (must match exactly)
  * every word and number of stem + choices, both ways  (order-insensitive)
  * explanation: nothing from the critique missing, nothing invented

Formatting-only differences are expected and listed for a human to skim:
sub/superscripts (HbA1c, FEV1, m2), hyphenated words, and page-number or
column-order quirks in pdftotext itself.

Usage:
    python3 tools/audit_bank.py --password '...' [--dir /path/to/pdfs]
Needs: pdftotext (poppler-utils), cryptography. Exit status 1 if any answer key differs.
"""
import argparse
import collections
import gzip
import hashlib
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parents[1]
C = collections.Counter


def decrypt(path, password):
    b = Path(path).read_bytes()
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), b[4:20], 310000, 32)
    return json.loads(gzip.decompress(AESGCM(key).decrypt(b[20:32], b[32:], None)))


def tokens(s):
    s = unicodedata.normalize("NFKC", s)
    s = re.sub(r"[‐-―−]", "-", s)
    s = re.sub(r"\.{3,}|…", " ", s)
    return re.findall(r"\w+", s)


def pdf_text(pdf):
    pages = subprocess.run(["pdftotext", "-enc", "UTF-8", str(pdf), "-"], capture_output=True, text=True, check=True).stdout.split("\f")
    lines = []
    for pg in pages:
        L = pg.split("\n")
        filled = [i for i, l in enumerate(L) if l.strip()]
        edges = {filled[0], filled[-1]} if filled else set()
        for i, l in enumerate(L):
            prev = L[i - 1] if i else ""
            if i in edges and re.fullmatch(r"\s*\d{1,3}\s*", l) and not re.fullmatch(r"\s*[A-E]\)\s*", prev):
                continue   # page number
            if re.fullmatch(r"\s*Item\s*#\s*\d+\s*", l) or re.fullmatch(r"\s*\d{4}\s+ITE\s+RATIONALE\s+BOOK.*", l, re.I):
                continue   # image-page and running headers
            lines.append(l)
    return "\n".join(lines)


def split_items(text, marker):
    pos, n = {}, 1
    for m in re.finditer(marker, text):
        if int(m.group(1)) == n:
            pos[n] = m.start(); n += 1
    keys = sorted(pos)
    return {k: text[pos[k]:(pos[keys[i + 1]] if i + 1 < len(keys) else len(text))] for i, k in enumerate(keys)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--password", required=True)
    ap.add_argument("--dir", default=str(ROOT), help="folder holding the <year>ITE*.pdf files")
    args = ap.parse_args()
    bank = {q["k"]: q for q in decrypt(ROOT / "data.enc", args.password)}
    years = sorted({q["y"] for q in bank.values()})
    report = collections.defaultdict(list)
    for y in years:
        mc_pdf, cr_pdf = Path(args.dir) / f"{y}ITEMultChoice.pdf", Path(args.dir) / f"{y}ITECritique.pdf"
        if not (mc_pdf.exists() and cr_pdf.exists()):
            print(f"{y}: PDFs not found, skipped"); continue
        mc = split_items(pdf_text(mc_pdf), r"(?m)^\s*(\d{1,3})\.(?=\s)")
        cr = split_items(pdf_text(cr_pdf), r"(?m)^\s*Item\s+(\d{1,3})\s*$")
        items = sorted((q for q in bank.values() if q["y"] == y), key=lambda q: q["n"])
        for q in items:
            k, n = q["k"], q["n"]
            if n not in mc or n not in cr:
                report["not found in pdftotext output"].append(k); continue
            m = re.search(r"ANSWER:\s*([A-E])", cr[n])
            if not m or m.group(1) != q["a"]:
                report["ANSWER KEY MISMATCH"].append((k, m and m.group(1), q["a"]))
            pdf = C(tokens(re.sub(r"^\s*\d{1,3}\.", "", mc[n], count=1)))
            app = C(tokens(q["q"] + " " + " ".join(f"{L}) {t}" for L, t in q["c"].items())))
            if pdf - app or app - pdf:
                report["stem/choice word differences"].append((k, "pdf-only:", dict(pdf - app), "app-only:", dict(app - pdf)))
            if m:
                full = C(tokens(cr[n][m.end():]))
                body = C(tokens(re.split(r"(?m)^\s*Ref(?:erence)?s?\b", cr[n][m.end():])[0]))
                ex = C(tokens(q["e"]))
                if body - ex or ex - full:
                    report["explanation word differences"].append((k, "pdf-only:", dict(body - ex), "app-only:", dict(ex - full)))
        print(f"{y}: {len(items)} questions audited")
    for section in ("ANSWER KEY MISMATCH", "not found in pdftotext output", "stem/choice word differences", "explanation word differences"):
        rows = report.get(section, [])
        print(f"\n## {section}: {len(rows)}")
        for r in rows:
            print("  ", r)
    sys.exit(1 if report.get("ANSWER KEY MISMATCH") or report.get("not found in pdftotext output") else 0)


if __name__ == "__main__":
    main()
