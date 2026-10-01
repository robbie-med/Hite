# Hite — ITE study tool

A static, installable, offline-capable study app for the ABFM In-Training
Exam (2022–2025, 799 questions with answers, explanations and categories),
built for family medicine residents. Runs entirely in the browser — no
server, no account. All progress is stored in `localStorage` on the device.

Live at **https://hite.robbiemed.org** (GitHub Pages, served from the repo
root of `main`).

Thanks to my colleague **NR** for the inspiration to build this.

## What it does

Hite is built around the study techniques with the strongest evidence
(practice testing, spacing, interleaving, metacognitive monitoring, immediate
feedback) with as little friction as possible between you and the next
question.

- **Study now** — one tap builds an interleaved session: due reviews first
  (confident misses prioritised), then unseen questions from your weakest
  categories, then new material.
- **Tutor mode** — answer, optionally rate your confidence (Guess / Fairly
  sure / Certain; tap the choice again to skip), see the explanation, jot a
  one-line note, flag it, move on. Auto-advance after correct answers is
  optional.
- **Exam mode** — timed blocks at ITE pace (~72 s/question, adjustable), no
  feedback until you submit, question navigator, flagging, the clock pauses
  if you leave. Full review afterwards.
- **Spaced repetition** — every question is rescheduled SM-2 style. Lucky
  guesses come back soon instead of being counted as learned; confident
  misses come back tomorrow.
- **Browse** — full-text search across stems, choices and explanations,
  filter by year / category / status, answer hidden until you tap Reveal,
  "Quiz me on these".
- **Stats** — lifetime vs first-try accuracy, 7-day accuracy, retention
  (re-attempts ≥ 7 days apart), score trend with rolling average, 12-week
  study calendar, review forecast, confidence calibration, category mastery
  with Wilson 95% intervals (weakest first, one-tap Practice), pacing,
  session history with per-question drill-down.
- **Full ITE simulation** — take a whole form in order at exam pace. For
  forms with ABFM scoring data (2024, 2025) you get the **official 200–800
  scaled score** from that year's raw-to-scaled table (items ABFM removed
  from scoring are excluded), plotted against the FMCE passing standard
  (380), the "reassuring" 440 line and national PGY-1/2/3 means.
- **Official blueprint categories** — every 2024/2025 item carries its ABFM
  blueprint area (Acute Care and Diagnosis 35%, Chronic Care Management
  25%, Emergent and Urgent Care 20%, Preventive Care 15%, Foundations of
  Care 5%). Filter by area in the builder and Browse; Stats shows accuracy
  per area and a blueprint-weighted accuracy. Items ABFM deleted from
  scoring are flagged and kept out of new sessions by default.
- **Daily goal, streak, ITE countdown** with a per-day plan.
- **Light / dark / auto theme, text size**, keyboard shortcuts on desktop.

## Backups — please read

Progress lives only on the device. A new phone, a cleared browser, or
deleting the app loses it. So:

- **More → Back up now** exports a JSON file. On iPhone/iPad this opens the
  share sheet — save to Files (iCloud Drive) or AirDrop it to your Mac. On
  desktop it downloads.
- Hite **reminds you after a session** when a backup is overdue (default:
  weekly, after at least 10 new answers; configurable or off).
- **Import merges by default**, so combining a phone and a laptop never
  loses attempts from either side. "Replace" is available too.
- Local safety nets: a snapshot is taken automatically before any update
  that changes the data format, before every import/restore/reset, and once
  a day. **More → Restore a snapshot** lists them.
- On iOS, **Add to Home Screen**. Safari can clear storage for ordinary tabs
  after 7 days without use; installed web apps are exempt. Hite also asks
  the browser for persistent storage.

## Updates never delete progress

The app and the data are separate: updating the site only replaces the
cached app shell. Stored progress is read forward by `migrate()` in
`app.js`, which backfills new fields idempotently and snapshots the old data
first. New versions install in the background and show an "Update ready —
your progress is kept" bar; nothing reloads mid-session unless you tap it.
Existing "Remember this device" logins keep working because the stored AES
key and `data.enc` format are unchanged.

## Layout

| Path | What it is |
|---|---|
| `index.html` | App markup |
| `styles.css` | Design tokens (light/dark) and components |
| `app.js` | Login/decryption, session engine, scheduling, analytics, backup |
| `data.enc` | Encrypted, gzipped question bank |
| `exam-meta.js` | Public ABFM exam metadata from the ITE handbooks: blueprint roster per item, deleted items, raw→scaled tables, PGY norms. No question content. Joined to the bank at load time, so adding a year needs no rebuild of `data.enc` |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | PWA offline/install support |
| `parse_pdfs.py` | Parses the ABFM PDFs (or pasted `.txt` of them) into `questions.json` |
| `build.py` | Cleans, gzips, encrypts the bank → `data.enc`; stamps the version |
| `questions.json`, `*.pdf`, `.salt` | Local only — gitignored |

The question bank is **encrypted** (AES-256-GCM, key derived from the
password with PBKDF2-SHA256 / 310k iterations) so the copyrighted ABFM
content is never readable in the repository. The password entered on the
login screen is the decryption key.

## Build & deploy

```bash
python3 parse_pdfs.py --dir ~/ite            # only when PDFs change; writes questions.json here
python3 build.py --password 'YourPassword'   # rebuild data.enc + stamp version
python3 build.py --assets-only               # app code changed only: re-stamp version
git add -A && git commit -m "update" && git push
```

Always run one of the `build.py` commands before committing app changes: it
hashes `data.enc` + `index.html` + `app.js` + `styles.css` and stamps the
result into `sw.js` (cache name), `app.js` (About screen) and the `?v=`
query on the asset tags, which is what makes clients pick up new files.

Re-running `build.py` with the same password keeps "Remember this device"
logins working (the PBKDF2 salt is persisted in `.salt`).

`parse_pdfs.py` expects `<year>ITEMultChoice.pdf` and `<year>ITECritique.pdf`
in `--dir`. If a PDF is unavailable, a `<year>ITECritique.txt` (text copied
out of the PDF) works in its place. It splits items by sequential number so
stems that contain "15. On examination…" or forms whose PDF text order puts
an item a page late parse correctly; it prints any item it could not parse
or could not find an answer key for. Source PDFs, `.txt` files and
`questions.json` are gitignored and must never be committed.

To add a new ITE year's scoring data, paste that year's handbook Tables 2–4
(norms, raw→scaled, questions by blueprint category) and deleted-item list
into `exam-meta.js` following the existing entries.

## Local preview

```bash
python3 -m http.server 8641
```

Open http://localhost:8641. (A plain `file://` open won't work — the app
fetches `data.enc` and registers a service worker.)

## Data model (localStorage, `ite.*`)

- `qstats` — per question: `s` attempts, `c` correct, `lc` last correct,
  `l` last time, `fa` first-attempt correct, `iv`/`ef`/`due`/`st` schedule,
  `lcf` last confidence, `h` attempt log `[[t, ok, conf, sec], …]` (last
  30), `fl` flag, `nt` note.
- `history` — sessions, newest first, with per-question answers kept for
  the most recent 120.
- `session` — the in-progress session (resumable, clock paused).
- `settings`, `lastBackup`, `sinceBackup`, `snapshot.*`, `schema`, `key`.

## Notes

- Body-system category labels are keyword-derived (`parse_pdfs.py`) and
  approximate; blueprint areas for 2024/2025 are the official ABFM ones.
- Scaled scores use ABFM's published full-form conversion tables, which the
  handbooks say apply only to the entire form, so Hite never extrapolates a
  scaled score from a partial session.
- Changing the password: delete `.salt`, re-run `build.py` with the new
  password, and push. Remembered devices will be asked to log in again.
- Hite is not affiliated with the ABFM.
