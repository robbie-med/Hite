# Hite — ITE Quiz

A static, installable quiz web app for ABFM In-Training Exam practice
(2022–2025, 799 questions with answers, explanations, and categories).
Runs entirely in the browser — no server. Progress (accuracy, category
mastery, score trend) is stored in `localStorage` on each device.

Live at **https://hite.robbiemed.org** (GitHub Pages, served from the repo
root of `main`).

The question bank is **encrypted** (AES-256-GCM, key derived from the
password with PBKDF2-SHA256 / 310k iterations) so the copyrighted ABFM
content is never readable in the repository. The password entered on the
login screen is the decryption key — there is no account or server.

## Layout

| Path              | What it is                                                |
|-------------------|-----------------------------------------------------------|
| `index.html`      | The whole app (single file: UI, quiz engine, stats)       |
| `data.enc`        | Encrypted, gzipped question bank                          |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | PWA offline/install support |
| `parse_pdfs.py`   | Parses the ABFM PDFs into `questions.json`                |
| `build.py`        | Cleans, gzips, encrypts the bank → `data.enc`             |
| `questions.json`, `*.pdf`, `.salt` | Local only — gitignored              |

## Build & deploy

```bash
python3 parse_pdfs.py                       # only when PDFs change
python3 build.py --password 'YourPassword'  # writes data.enc, icons, sw version
git add -A && git commit -m "update" && git push
```

Re-running `build.py` with the same password keeps "Remember this device"
logins working (the PBKDF2 salt is persisted in `.salt`).

## Local preview

```bash
python3 -m http.server 8641
```

Open http://localhost:8641. (A plain `file://` open won't work — the app
fetches `data.enc` and registers a service worker.)

## Notes

- **Install it like an app**: on iOS Safari use Share → Add to Home Screen;
  on Android/desktop Chrome use the install prompt. Works offline after the
  first load.
- **Progress portability**: Stats → Export/Import progress moves your history
  between devices.
- **Changing the password**: delete `.salt`, re-run `build.py` with the new
  password, and push. Existing "remembered" devices will be asked to log in
  again.
