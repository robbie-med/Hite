---
name: hite-reports
description: Triage "Report this question" texts that arrived through sms-bridge (JMP/Cheogram). Look the item up in the bank, decide whether the report is right, fix the bank or correct the sender, reply by text, acknowledge.
---

# Handling question reports

Reports arrive as SMS on the Hite report number and land in
`sms-bridge/data/inbox.jsonl`. Each one starts with the reference the app fills in:
`Hite 2024 #123 · Chronic Care Management · I chose B, key D · v4d9259 / Problem: …`.

## Steps, per report

1. List them: `python3 sms-bridge/bridge.py inbox` (add `--json` for scripting).
2. Find the item. The plaintext bank is `questions.json` (gitignored; key = year + id).
   Read the stem, choices, key and critique. The app shows `clean_text()` output
   (see `build.py`), so compare against that when the report is about wording.
   If `questions.json` is missing, re-run `parse_pdfs.py` (the PDFs are in the folder).
3. Decide what kind of report it is:
   - **Parser damage** (missing choice, wrapped number, text from the next item):
     fix `parse_pdfs.py`, re-parse, confirm with `tools/audit_bank.py`.
   - **Key or critique disagrees with current practice:** judge against what the
     ITE currently tests, not the newest guideline (see memory
     `ite-outdated-review-standard`). Record the verdict in `annotations.json`
     under `"YEAR-ID"`: `{"ai": {"s": "outdated"|"dated"|"error", "w": "one-line reason"}}`.
     Hiding happens per year through the app's setting; never delete an item.
   - **ABFM erratum:** `{"er": "what ABFM corrected and when"}`.
   - **Metadata** (blueprint area, difficulty, removed-from-scoring): `exam-meta.js`,
     then `python3 tools/check_charts.py`.
   - **The sender is mistaken:** no change; explain briefly in the reply, citing the
     critique's reasoning.
   - **App bug:** fix in `app.js` / `styles.css`, verify in the preview
     (`.claude/launch.json` → `ite-quiz`, port 3918), stop the server afterwards.
4. Rebuild if the bank changed: `python3 build.py --password '<the live password>'`
   (ask for it; never guess). Code-only change: `python3 build.py --assets-only`.
   Then `python3 tools/check_repo.py`.
5. Commit with `git add <files>` (never `-A`). Push only if the user has said to deploy.
6. Reply by text, short and plain, under ~300 characters, no markdown:
   `python3 sms-bridge/bridge.py send +15551234567 "Thanks — 2024 #123: you're right, the key …"`
   Say what was wrong, what changed (or why nothing changed), and when it goes live
   (installed apps update on next launch after a push).
7. `python3 sms-bridge/bridge.py ack <id>`.

## Rules

- Never text question or critique text back (© ABFM); refer to the item by year and number.
- Never quote `.env`, the password, or the sender's number anywhere but the reply.
- One report, one fix, one verify. Batch replies only when several reports are the same issue.
