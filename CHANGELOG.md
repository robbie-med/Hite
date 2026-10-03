# Changelog

## 2026-10-03

- **Report this question:** a red button on every item (next to the flag, and
  under explanations in Browse and review) opens a prefilled email to
  ite_problem@robbiemed.org with the item reference; the person adds what is
  wrong and sends. `/hite-reports` skill documents the triage.
- **sms-bridge/** (optional, unused by the app for now): receives texts on the
  maintainer's PC over XMPP (JMP.chat number via the Cheogram gateway) and
  replies from the command line.
- **tools/build_symbols.py** regenerates the icon font subset and checks every
  icon name used in the app is present (the `sms` icon was added this way).

## 2026-10-02

- **Bank: 884 questions.** Added the hardest 2020 (46) and 2021 (38) items
  (ABFM difficulty 500+). Every item audited against the PDFs with an
  independent extractor; 0 answer-key mismatches.
- **ABFM difficulty** for 2020–2025: "Skip questions most residents get
  right" setting (on by default), By-difficulty blocks, Hardest pool,
  Browse filter, difficulty shown after answering.
- **AI currency review** of all 884 items, judged against what the ITE
  currently expects: 4 outdated (2020 #103, 2021 #13/#80, 2022 #193),
  12 dated explanations, 2 critique errors (2025 #44, #189). Outdated items
  are hidden by default for 2022 and earlier and labelled for 2023+, with a
  per-year toggle in Settings.
- **Errata:** 2023 critique replaced with ABFM's January 2024 correction;
  2023 #119 shows what changed.
- **Clinical images:** 31 images for 24 items, tap to enlarge.
- **Parser fixes:** numeric choices on their own line (2022 #167, 2023
  #47/#115/#116), a wrapped "6" in 2025 #158, a duplicate 2022 #22.
- **Updates:** fixed installed apps getting stuck on old versions
  (Cloudflare cache + waiting service worker).
- **UI:** Material 3 redesign with seed-colour theming and an icons/emoji
  switch; header removed; Quick 5; first-run intro; new app icon and favicons.
- **3-zone answers:** tap the left/middle/right of a choice to answer and rate
  confidence (guess/shaky/confident) in one tap; the classic rating buttons
  remain an option. Scrolling over the choices no longer selects one.
- **Repo:** CI (GitHub Actions), `tools/` for repo checks, difficulty
  provenance and the PDF audit; README rewritten.

## 2026-07-02

- First release: encrypted 2022–2025 bank, quiz PWA, offline support,
  local progress tracking.
