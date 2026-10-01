'use strict';
/* ============================================================
   Hite theme: Material 3 colour scheme from one seed colour.
   Loaded synchronously in <head> so the saved colours, theme,
   text size and icon style are applied before first paint.

   Tonal palettes are built in OKLCH (perceptual hue/chroma) and
   each tone is solved so its CIE L* equals the M3 tone number,
   which keeps M3's contrast guarantees (e.g. 40 on 90, 80 on 20).
   ============================================================ */
(function () {
  const DEFAULT_SEED = '#5b64d6';
  const PRESETS = [
    ['Indigo', '#5b64d6'], ['Blue', '#2f6fdb'], ['Teal', '#00897b'], ['Green', '#3c8d40'],
    ['Amber', '#c77c02'], ['Coral', '#e0662c'], ['Rose', '#c2416b'], ['Violet', '#7e57c2'], ['Graphite', '#6b6f78'],
  ];

  /* ---- colour math ---- */
  const toLin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const toGam = c => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  function hexToOklch(hex) {
    const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
    const r = toLin((n >> 16 & 255) / 255), g = toLin((n >> 8 & 255) / 255), b = toLin((n & 255) / 255);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    return { L, C: Math.hypot(A, B), h: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360 };
  }
  function oklchToLin(L, C, h) {
    const a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  }
  const inGamut = c => c.every(v => v >= -1e-4 && v <= 1 + 1e-4);
  /* Largest in-gamut colour at (L, h) with chroma ≤ C. */
  function fit(L, C, h) {
    let rgb = oklchToLin(L, C, h);
    if (inGamut(rgb)) return rgb;
    let lo = 0, hi = C;
    for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (inGamut(oklchToLin(L, mid, h))) lo = mid; else hi = mid; }
    return oklchToLin(L, lo, h).map(v => Math.min(1, Math.max(0, v)));
  }
  const luminance = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const toHex = c => '#' + c.map(v => Math.round(toGam(Math.min(1, Math.max(0, v))) * 255).toString(16).padStart(2, '0')).join('');
  /* Colour of hue h, chroma ≤ C, whose L* equals tone T (0–100). */
  function tone(h, C, T) {
    if (T >= 100) return '#ffffff';
    if (T <= 0) return '#000000';
    const Y = T > 8 ? ((T + 16) / 116) ** 3 : T / 903.2963;
    let lo = 0, hi = 1, rgb = null;
    for (let i = 0; i < 22; i++) {
      const L = (lo + hi) / 2; rgb = fit(L, C, h);
      if (luminance(rgb) < Y) lo = L; else hi = L;
    }
    return toHex(rgb);
  }
  /* Nudge a fixed hue (success green, warning amber) toward the seed, like M3 harmonize(). */
  function harmonize(h, seedH) {
    const d = ((seedH - h + 540) % 360) - 180;
    return (h + Math.sign(d) * Math.min(Math.abs(d) * 0.5, 15) + 360) % 360;
  }

  /* ---- scheme ---- */
  function scheme(seed) {
    const s = hexToOklch(/^#[0-9a-f]{6}$/i.test(seed || '') ? seed : DEFAULT_SEED);
    const mono = s.C < 0.02;
    const k = mono ? 0 : 1;
    const P = { h: s.h, c: k * Math.min(0.16, Math.max(0.09, s.C)) };
    const S = { h: s.h, c: k * 0.035 };
    const T = { h: (s.h + 60) % 360, c: k * 0.06 };
    const N = { h: s.h, c: k * 0.008 };
    const NV = { h: s.h, c: k * 0.016 };
    const E = { h: 27, c: 0.18 };
    const G = { h: harmonize(148, s.h), c: 0.13 };
    const W = { h: harmonize(75, s.h), c: 0.13 };
    const t = (p, n) => tone(p.h, p.c, n);
    const accents = (name, p, dark) => dark
      ? { [name]: t(p, 80), ['on-' + name]: t(p, 20), [name + '-container']: t(p, 30), ['on-' + name + '-container']: t(p, 90) }
      : { [name]: t(p, 40), ['on-' + name]: t(p, 100), [name + '-container']: t(p, 90), ['on-' + name + '-container']: t(p, 20) };
    const build = dark => Object.assign({},
      accents('primary', P, dark), accents('secondary', S, dark), accents('tertiary', T, dark),
      accents('error', E, dark), accents('good', G, dark), accents('warn', W, dark),
      dark ? {
        surface: t(N, 6), 'surface-dim': t(N, 6), 'surface-bright': t(N, 24),
        'sc-lowest': t(N, 4), 'sc-low': t(N, 10), sc: t(N, 12), 'sc-high': t(N, 17), 'sc-highest': t(N, 22),
        'on-surface': t(N, 90), 'on-surface-variant': t(NV, 80), outline: t(NV, 60), 'outline-variant': t(NV, 30),
        'inverse-surface': t(N, 90), 'inverse-on-surface': t(N, 20), 'inverse-primary': t(P, 40),
      } : {
        surface: t(N, 98), 'surface-dim': t(N, 87), 'surface-bright': t(N, 98),
        'sc-lowest': t(N, 100), 'sc-low': t(N, 96), sc: t(N, 94), 'sc-high': t(N, 92), 'sc-highest': t(N, 90),
        'on-surface': t(N, 10), 'on-surface-variant': t(NV, 30), outline: t(NV, 50), 'outline-variant': t(NV, 80),
        'inverse-surface': t(N, 20), 'inverse-on-surface': t(N, 95), 'inverse-primary': t(P, 80),
      });
    return { light: build(false), dark: build(true) };
  }
  const vars = o => Object.keys(o).map(k => `--md-${k}:${o[k]};`).join('');

  function apply(seed) {
    const sc = scheme(seed);
    const css = `:root{${vars(sc.light)}color-scheme:light}`
      + `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${vars(sc.dark)}color-scheme:dark}}`
      + `:root[data-theme="dark"]{${vars(sc.dark)}color-scheme:dark}`;
    let tag = document.getElementById('m3-scheme');
    if (!tag) { tag = document.createElement('style'); tag.id = 'm3-scheme'; document.head.appendChild(tag); }
    tag.textContent = css;
    return sc;
  }

  window.HiteTheme = { DEFAULT_SEED, PRESETS, apply, scheme, tone };

  /* Before first paint: saved colour, theme, text size and icon style. */
  let s = {};
  try { s = JSON.parse(localStorage.getItem('ite.settings') || '{}') || {}; } catch (e) {}
  const root = document.documentElement;
  if (s.theme === 'light' || s.theme === 'dark') root.dataset.theme = s.theme;
  if (s.textSize) root.style.setProperty('--fs', s.textSize);
  root.dataset.icons = s.icons === 'emoji' ? 'emoji' : 'icons';
  apply(s.seed || DEFAULT_SEED);
})();
