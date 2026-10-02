# Changelog

## 2026-10-02

- **Bank: 884 questions.** Added the hardest 2020 (46) and 2021 (38) items
  (ABFM difficulty 500+). Every item audited against the PDFs with an
  independent extractor; 0 answer-key mismatches.
- **ABFM difficulty** for 2020–2025: "Skip questions most residents get
  right" setting (off by default), By-difficulty blocks, Hardest pool,
  Browse filter, difficulty shown after answering.
- **AI currency review** of older items: 3 outdated 2020–2021 items hidden
  by default, 3 dated explanations annotated. 2022+ never hidden by default.
- **Errata:** 2023 critique replaced with ABFM's January 2024 correction;
  2023 #119 shows what changed.
- **Clinical images:** 31 images for 24 items, tap to enlarge.
- **Parser fixes:** numeric choices on their own line (2022 #167, 2023
  #47/#115/#116), a wrapped "6" in 2025 #158, a duplicate 2022 #22.
- **Updates:** fixed installed apps getting stuck on old versions
  (Cloudflare cache + waiting service worker).
- **UI:** Material 3 redesign with seed-colour theming and an icons/emoji
  switch; header removed; Quick 5; first-run intro; new app icon and favicons.
- **Repo:** CI (GitHub Actions), `tools/` for repo checks, difficulty
  provenance and the PDF audit; README rewritten.

## 2026-07-02

- First release: encrypted 2022–2025 bank, quiz PWA, offline support,
  local progress tracking.
