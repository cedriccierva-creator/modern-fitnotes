# FitNotes

Offline-first workout tracker: React 19 + TypeScript (strict) + Vite 7, Tailwind
3.4, Dexie 4 + IndexedDB, packaged as an Android app with Capacitor 8. Dark
Slate & Cyber-Emerald theme.

Work happens one phase at a time — each phase is a single local commit, then it
stops for review. `src/db/README.md` tracks where the persistence layer lands.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server on `0.0.0.0:5173` |
| `npm run build` | `tsc --noEmit` then `vite build` |
| `npm run typecheck` | Type check only |
| `npm run lint` | ESLint |
| `npm test` | Vitest |
| `npm run cap:sync` | Build, then copy `dist/` into `android/` |

## Current state

Phase 1 — project foundation only: toolchain, folder structure, theme and app
shell. No calendar, logging, routines or database yet.
