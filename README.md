# FitNotes

Offline-first workout tracker: React 19 + TypeScript (strict) + Vite 7, Tailwind
3.4, Dexie 4 + IndexedDB, packaged as an Android app with Capacitor 8. Dark
Slate & Cyber-Emerald theme.

Work happens one phase at a time — each phase is a single local commit, then it
stops for review. `src/db/README.md` tracks the persistence layer.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server on `0.0.0.0:5173` |
| `npm run build` | `tsc --noEmit` then `vite build` |
| `npm run typecheck` | Type check only |
| `npm run lint` | ESLint |
| `npm test` | Vitest |
| `npm run cap:sync` | Build, then copy `dist/` into `android/` |

## Implemented capabilities

### Day-by-day planning

The interactive monthly calendar is Monday-first and uses a 6-row grid.
Every date is independent: assign, change or remove a plan for one day at a
time, or leave it as rest. Routine templates (PPLUL, ULUL, PPLPPL, Full Body
×3) are optional and always apply to a *single* day — nothing fills a week, no
routine recurs, and skipping a planned day never shifts or creates an overdue
workout. Assigning a plan creates only a plan; logging starts when the workout
is opened.

### Exercise management and workout logging

The exercise library supports rename, delete and reorder. Three intensity
presets generate editable set rows, with per-set weight/reps entry and an
lbs/kg toggle. Weights are stored in kilograms and converted only for display;
reps are integers. Past workouts keep the exercise name they were performed
under.

### Exercise catalog

The built-in exercise catalog contains 318 entries (168 gym, 106 home
bodyweight, 44 minimal equipment), transcribed from the reference library. It
is **static application data** (`src/lib/exerciseCatalog.ts`) and is never
inserted into IndexedDB: a fresh install browses the whole catalog with zero
writes. The picker keeps two actions separate — *Add to today* logs a
suggestion without adopting it, *Add to library* adopts it for future use.
Adoption is idempotent and recorded as `Exercise.catalogId`; there are no
deletion tombstones, so a deleted entry simply becomes a suggestion again.

### Personal records and Phase 6A metrics

Personal records are derived from stored workout history; they are not
persisted as separate rows. The original heaviest-weight PR remains available,
and Phase 6A adds:

- Independent loaded-weight records for each rep range from 1RM through 10RM.
- Estimated one-rep max (Epley formula), kept distinct from an actual 1RM.
- Maximum-repetition records, including bodyweight sets.
- Best exercise-session volume, calculated as the sum of weight × reps for
  eligible completed sets in a session.
- Per-set achievement badges identifying every record that set established.
  A session-volume record is shown on its session rather than attached to an
  individual set.

Record results are recomputed from workout history when requested. Editing or
deleting a set therefore recalculates the records instead of leaving stale
persisted achievements. Phase 6A adds no IndexedDB schema version or PR table.

## Planning vs logging

`plannedDays` and `workoutDays` are separate tables, and planning code only
ever writes to the former. A planned day is an intention — at most one per
date, held by a `&date` unique index — with no week, cycle or recurrence in
the data. That is why a skipped day cannot move: there is nothing for it to
move within.

Planning an already-logged date warns first and then proceeds; the logged
workout is never modified. The plan for a day is never read when logging, so
an intensity and its sets are always chosen explicitly.
