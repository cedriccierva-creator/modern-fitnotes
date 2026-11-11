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

Phase 3 — interactive monthly calendar (Monday-first, 6-row grid) and the routine
planner: PPLUL, ULUL, PPLPPL and Full Body ×3, applied to the current Monday-first
week. Presets only ever fill days without a logged workout, and re-applying is
idempotent.

Phase 4 adds exercise management and logging: an exercise library with rename,
delete and reorder, three intensity presets that generate editable set rows, and
per-set weight/reps entry with an lbs/kg toggle. Weights are stored in kilograms
and converted only for display; reps are integers. Past workouts keep the
exercise name they were performed under. No PR calculations or backup yet.

Phase 5 adds weight-only personal records — a view over the stored sets, never a
persisted row — shown in the exercise header with a trophy on the record set.

Phase 5c adds a built-in exercise catalog of 318 entries (168 gym, 106 home
bodyweight, 44 minimal equipment), transcribed from the reference library. It is
**static application data** (`src/lib/exerciseCatalog.ts`) and is never inserted
into IndexedDB: a fresh install browses the whole catalog with zero writes. The
picker keeps two actions separate — *Add to today* logs a suggestion without
adopting it, *Add to library* adopts it for future use. Adoption is idempotent
and recorded as `Exercise.catalogId`; there are no deletion tombstones, so a
deleted entry simply becomes a suggestion again.
