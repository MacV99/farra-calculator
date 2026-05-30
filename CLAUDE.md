# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm run dev      # dev server at http://localhost:4321
npm run build    # static build to ./dist
npm run preview  # serve the production build locally
```

No tests, no linter configured. Language/UI is Spanish; currency is Colombian Peso (`es-CO` / COP).

**Deploy:** primary target is Vercel (`vercel.json` — Astro preset, builds `astro build` → `dist/`, plus `Cache-Control: must-revalidate` headers on `/sw.js` and `/manifest.webmanifest` so PWA updates propagate). `netlify.toml` is kept as a rollback fallback (same build → `dist/`); remove it once Vercel is confirmed stable.

## Architecture

Astro 5 static site (no framework integrations, no SSR). Everything renders from a single page, `src/pages/index.astro`, which composes the section components under `src/components/`.

### Client logic lives in inline scripts, not bundled modules

Every component's behavior is a `<script type="module" is:inline>` block inside its `.astro` file. **`is:inline` means Astro does NOT bundle, transpile, or type-check these scripts** — they are plain browser JS sharing the global scope. There are no `import`s between them; they coordinate through globals and DOM events.

### Shared globals (the contract between scripts)

- `window.App` — defined in `index.astro`. The single source of truth for **persistence + domain calc**: localStorage getters/setters, `uuid()`, `calcularResumen()`, `fmtCOP`, and `autoSaveCurrent()`. All other components call into this; do not read/write localStorage directly elsewhere.
- `window.toast(msg)` — defined in `Toast.astro`. Transient notification.
- `window.dialogOpen({title, message, confirmText, extraText})` — defined in `DialogOverlay.astro`. Returns a Promise resolving to `"confirm" | "cancel" | "extra"`. Used for all confirmations (e.g. deletes).

### Cross-component communication = custom events on `window`

Components re-render by listening for these events (dispatched after any mutation):

- `app:state` — current event's data (personas/productos) changed → Results, Products, EventHeader re-render.
- `app:event` — the active event changed (created/opened) → title + events list refresh.
- `event:list` — events list itself changed (rename/delete) → list re-renders.
- `create-event:force` — request to force-open the "create event" modal (used when an action needs an active event but none exists).

After mutating state via `window.App`, dispatch the matching event(s) — nothing updates reactively on its own.

### Data model (localStorage, keys under `fiesta.*`)

- `fiesta.eventos` — array of events: `{ id, nombreEvento, personas, productos[], resumen }`.
- `fiesta.eventoActivoId` — id of the open event.
- `fiesta.personas`, `fiesta.productos` — the working copy of the *active* event. `autoSaveCurrent()` mirrors these back into the active event in `fiesta.eventos` on every change.

A `producto` is `{ id, nombre, precioUnidadCOP, cantidad, abv, mlUnidad }`. `calcularResumen()` derives totals: cost total/per-person, volume, and **pure alcohol** (`cantidad * mlUnidad * abv/100`) total and per person.

### Styling & external libs

- One global stylesheet: `src/styles/main.css`, imported once in `index.astro`.
- Loaded via CDN `<link>` in `index.astro`'s `<head>`: Bootstrap Icons (`bi bi-*` classes). No other runtime deps.
- The "export" button in `ResultsSection.astro` renders the event summary to a **native `<canvas>` at 2x** and produces a PNG `Blob` (no library). A small modal offers Descargar (anchor download) and Compartir (Web Share API with files, falling back to download).

### PWA (hand-rolled, no plugin)

The app is an installable PWA wired manually (the `@vite-pwa/astro` plugin does NOT emit the manifest in this all-`is:inline` static setup, so we don't use it):

- `public/manifest.webmanifest` — static manifest; icons in `public/img/icon-{192,512}.png` (generated from `public/favicon.png` with `sharp`).
- `public/sw.js` — minimal service worker: precaches the shell, cache-first for same-origin static assets, network-first for navigations (offline fallback to `/`). Bump `CACHE_VERSION` to invalidate after a deploy.
- `index.astro` `<head>` has the manual `<link rel="manifest">` + iOS/theme meta; SW is registered by an inline script before `</body>`.
- `AppHeader.astro` shows an "Instalar app" button driven by the `beforeinstallprompt` event (hidden until Chrome fires it / when already standalone).
