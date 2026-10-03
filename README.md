# Hite

[![CI](https://github.com/robbie-med/Hite/actions/workflows/ci.yml/badge.svg)](https://github.com/robbie-med/Hite/actions/workflows/ci.yml)

Offline, installable study app for the ABFM In-Training Exam. Static site, no
server or account; progress stays in the browser. Live at
**https://hite.robbiemed.org**. Thanks to **NR** for the inspiration.

**Bank:** 884 questions with ABFM keys and critiques: complete 2022–2025
forms, plus the hardest 2020–2021 items (ABFM difficulty 500+). Every item
was reviewed for currency: outdated items from 2022 and earlier are hidden by
default, 2023+ items are only labelled (toggle per year in Settings). Questions and critiques are © ABFM and are
stored only encrypted (AES-256-GCM, PBKDF2-SHA256 key from the password).

## Build

Needs Python 3.10+ (`pip install -r requirements.txt`), Node.js, and
`pdftotext` (poppler) for the audit. Source PDFs come from the MyABFM
portfolio (`…/api/exam-result/ite/report?year=YYYY&iteReportType=MultipleChoiceQuestions|Critique|Handbook`)
and are saved as `<year>ITEMultChoice.pdf`, `<year>ITECritique.pdf`,
`<year>ITEHandbook.pdf` (gitignored, never committed).

```bash
python3 parse_pdfs.py --dir . --years 2020,2021,2022,2023,2024,2025   # PDFs → questions.json
python3 build.py --password '…'                 # → data.enc, images.enc, version stamp
python3 build.py --assets-only                  # after code-only changes (add --icons to redo icons)
python3 tools/audit_bank.py --password '…'      # every key and word vs the PDFs
python3 tools/check_charts.py && python3 tools/check_repo.py   # what CI runs
```

- `.salt` is kept so rebuilding with the same password keeps remembered
  devices logged in. New password: delete `.salt`, rebuild.
- Older forms included: `OLDER_FORMS` in `build.py`.
- `annotations.json` (gitignored, encrypted into the bank): AI currency flags
  and ABFM errata per item.
- New year's metadata: scoring tables go in `exam-meta.js` → `years` (only
  with a full raw→scaled table); difficulty bands are transcribed into
  `tools/charts/<year>{a,b}.txt`, copied to `exam-meta.js` → `difficulty`,
  and checked with `tools/check_charts.py`.

## Layout

| Path | |
|---|---|
| `index.html`, `styles.css`, `app.js`, `theme.js` | App (Material 3; `theme.js` builds the colour scheme before first paint) |
| `exam-meta.js` | Public ABFM metadata: blueprint, removed items, scaled-score tables, norms, difficulty |
| `data.enc`, `images.enc` | Encrypted bank and clinical images |
| `sw.js`, `manifest.webmanifest`, icons, `symbols.woff2` | PWA and offline support |
| `parse_pdfs.py`, `build.py` | Pipeline |
| `tools/` | CI checks, difficulty provenance, PDF audit |

## Run and release

```bash
python3 -m http.server 3918 --bind 127.0.0.1   # then open http://127.0.0.1:3918
```

Push to `main` with CI green; GitHub Pages deploys in about a minute.
Installed apps update on next launch: the service worker fetches
`<file>?v=<version>` to bypass Cloudflare's cache and activates immediately.
Updates never touch progress (`migrate()` in `app.js` reads old data forward).

## Question reports by text

Every question has a red **Report** button (the speech-bubble icon next to the
flag, and "Report" under any explanation). It opens a prefilled email to
`REPORT_EMAIL` in `app.js` (ite_problem@robbiemed.org) with the item reference
(`Hite 2024 #123 · Chronic Care Management · I chose B, key D · v4d9259 /
Problem:`); the person adds what is wrong and sends. No question text leaves
the app. Handling a report is the `/hite-reports` Claude Code skill
(`.claude/skills/hite-reports/SKILL.md`).

`sms-bridge/` is an optional SMS route the app does not use yet: a JMP.chat
number (jmp.chat, US/Canada, $4.99/month) delivers texts to an XMPP account via
the Cheogram gateway, and `bridge.py daemon` (user service `hite-sms-bridge`)
files each one in `sms-bridge/data/inbox.jsonl`; `bridge.py send +1… "text"`
replies. Setup: `cp sms-bridge/.env.example sms-bridge/.env`, fill in the JMP
account, `./sms-bridge/install.sh`. `sms-bridge/triage.sh` can run the skill
automatically (`AUTO_TRIAGE=1`, off by default).

Icons are a Google Fonts subset; after adding one to `app.js` run
`python3 tools/build_symbols.py` (verifies every name is in the font).

## License

Code: [MIT](LICENSE) © robbie-med, credit required in copies. ABFM questions, keys,
critiques and images are © ABFM and are not covered. Not affiliated with the ABFM.
