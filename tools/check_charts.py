#!/usr/bin/env python3
"""Verify exam-meta.js difficulty data against the chart transcriptions in tools/charts/.

Each tools/charts/<year><a|b>.txt is a hand transcription of Figure 2a / 2b
(Item Performance Report) from that year's ABFM ITE Score Results Handbook:
one line per difficulty band, cells separated by "|", item numbers zero-padded,
"P" marking items removed from scoring for psychometric reasons.

Checks, per year:
  * no item appears twice within a figure;
  * no item removed from scoring for content reasons appears; "P" marks match;
  * items shown in both figures sit in the same band;
  * exam-meta.js `difficulty` equals the union of the figures exactly.
2025's bands were read by OCR and checked against Table 4 and Figure 2b at the
time; they are compared only for internal consistency here. The 2019 handbook
figures are a generic 240-item demo, so 2019 has no ratings.

Usage: python3 tools/check_charts.py      (exit status 1 on any problem)
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHARTS = ROOT / "tools" / "charts"


def exam_meta():
    js = "global.window={};require(process.argv[1]);console.log(JSON.stringify(window.EXAM_META))"
    return json.loads(subprocess.check_output(["node", "-e", js, str(ROOT / "exam-meta.js")]))


def read_chart(path):
    out = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        band, *cells = [c.strip() for c in line.split("|")]
        for col, cell in enumerate(cells):
            for tok in cell.split():
                m = re.fullmatch(r"(\d{3})(P?)", tok)
                if not m:
                    raise ValueError(f"{path.name}: bad token {tok!r}")
                n = int(m.group(1))
                if n in out:
                    raise ValueError(f"{path.name}: item {n} appears twice")
                out[n] = (int(band), col, m.group(2) == "P")
    return out


def main():
    meta = exam_meta()
    removed = {int(y): {int(n): r for n, r in v.items()} for y, v in meta.get("removed", {}).items()}
    for y, v in meta.get("years", {}).items():
        removed.setdefault(int(y), {}).update({int(n): r for n, r in v.get("deleted", {}).items()})
    problems = []
    years = sorted({int(p.name[:4]) for p in CHARTS.glob("*.txt")})
    for y in years:
        merged = {}
        for p in sorted(CHARTS.glob(f"{y}*.txt")):
            try:
                fig = read_chart(p)
            except ValueError as e:
                problems.append(str(e)); continue
            for n, (band, _, psych) in fig.items():
                why = removed.get(y, {}).get(n)
                if why == "content":
                    problems.append(f"{p.name}: content-removed item {n} is on the chart")
                if psych != (why == "psychometric"):
                    problems.append(f"{p.name}: 'P' mark on item {n} does not match the removed list")
                if n in merged and merged[n] != band:
                    problems.append(f"{y}: item {n} is {merged[n]} in one figure and {band} in another")
                merged[n] = band
        meta_bands = {int(n): int(b) for b, ns in meta["difficulty"].get(str(y), {}).items() for n in ns}
        if meta_bands != merged:
            diff = sorted(set(meta_bands.items()) ^ set(merged.items()))
            problems.append(f"{y}: exam-meta.js difficulty differs from the charts: {diff[:10]}")
        print(f"{y}: {len(merged)} items rated, figures consistent")
    d25 = {int(n): int(b) for b, ns in meta["difficulty"].get("2025", {}).items() for n in ns}
    if len(d25) != len(set(d25)) or any(not 1 <= n <= 200 for n in d25):
        problems.append("2025: difficulty has invalid item numbers")
    for p in problems:
        print("PROBLEM:", p)
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
