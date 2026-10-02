#!/usr/bin/env python3
"""Repository health checks that need no PDFs and no password (run locally and in CI).

  * nothing copyrighted or secret is tracked (PDFs, plaintext bank, salt, annotations, zips);
  * the version stamp is identical in sw.js, app.js and every ?v= in index.html;
  * every file the service worker precaches, the manifest lists and index.html loads exists;
  * data.enc and images.enc carry the ITE1 header and share one salt (one password unlocks both);
  * the app's JavaScript parses (node --check).

Usage: python3 tools/check_repo.py      (exit status 1 on any problem)
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN = [r"\.pdf$", r"(^|/)questions\.json$", r"(^|/)\.salt$", r"(^|/)annotations\.json$", r"\.zip$"]
ALLOWED_TXT = [r"^requirements\.txt$", r"^tools/charts/\d{4}[ab]\.txt$"]
JS = ["app.js", "theme.js", "sw.js", "exam-meta.js"]

problems = []


def check(cond, msg):
    if not cond:
        problems.append(msg)


def tracked():
    out = subprocess.check_output(["git", "ls-files"], cwd=ROOT, text=True)
    return [l for l in out.splitlines() if l]


def main():
    files = tracked()
    for f in files:
        for pat in FORBIDDEN:
            check(not re.search(pat, f), f"tracked file must never be committed: {f}")
        if f.endswith(".txt"):
            check(any(re.search(p, f) for p in ALLOWED_TXT), f"unexpected .txt in repo (could be extracted PDF text): {f}")

    sw = (ROOT / "sw.js").read_text()
    app = (ROOT / "app.js").read_text()
    index = (ROOT / "index.html").read_text()
    v_sw = re.search(r"const VERSION = '([^']*)'", sw)
    v_app = re.search(r"const APP_VERSION = '([^']*)'", app)
    v_idx = set(re.findall(r"\?v=([0-9a-f]+)", index))
    check(v_sw and v_app, "version constants missing from sw.js / app.js")
    if v_sw and v_app:
        check(v_sw.group(1) == v_app.group(1), f"sw.js {v_sw.group(1)} != app.js {v_app.group(1)}: run build.py --assets-only")
        check(v_idx == {v_sw.group(1)}, f"index.html ?v= {sorted(v_idx)} != {v_sw.group(1)}: run build.py --assets-only")
    css = (ROOT / "styles.css").read_text()
    v_css = set(re.findall(r"symbols\.woff2\?v=([0-9a-f]+)", css))
    if v_sw:
        check(v_css == {v_sw.group(1)}, "styles.css font ?v= is stale: run build.py --assets-only")

    assets = re.findall(r"'\./([^']*)'", sw.split("const ASSETS", 1)[1].split("];", 1)[0])
    for a in assets:
        check(a == "" or (ROOT / a).exists(), f"sw.js precaches a missing file: {a}")
    manifest = json.loads((ROOT / "manifest.webmanifest").read_text())
    for icon in manifest.get("icons", []):
        check((ROOT / icon["src"]).exists(), f"manifest icon missing: {icon['src']}")
    for ref in re.findall(r'(?:src|href)="([^":#?]+)(?:\?[^"]*)?"', index):
        if not ref.startswith(("http", "data:", "mailto:")):
            check((ROOT / ref).exists(), f"index.html references a missing file: {ref}")

    heads = {}
    for name in ("data.enc", "images.enc"):
        p = ROOT / name
        check(p.exists(), f"{name} is missing")
        if p.exists():
            b = p.read_bytes()[:20]
            check(b[:4] == b"ITE1", f"{name} has no ITE1 header")
            heads[name] = b[4:20]
    if len(heads) == 2:
        check(heads["data.enc"] == heads["images.enc"], "data.enc and images.enc use different salts")

    for js in JS:
        r = subprocess.run(["node", "--check", str(ROOT / js)], capture_output=True, text=True)
        check(r.returncode == 0, f"{js} does not parse: {r.stderr.strip()[:200]}")

    for p in problems:
        print("PROBLEM:", p)
    print(f"checked {len(files)} tracked files, {len(assets)} precached assets: {'OK' if not problems else f'{len(problems)} problem(s)'}")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
