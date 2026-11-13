import { memo, useEffect, useState } from 'react';
import SetRow from './SetRow';
import { findIntensity, intensityFromNote } from '../lib/intensity';
import { formatWeight } from '../lib/units';
import type { IntensityId } from '../lib/intensity';
import type { SessionExercise } from '../db/workout';
import type { TogglePatch } from './SetRow';
import { REP_RANGE_MAX, setRecords } from '../lib/pr';
import type { ExercisePR } from '../lib/pr';

interface Props {
  session: SessionExercise;
  index: number;
  total: number;
  unit: 'kg' | 'lb';
  intensity: IntensityId;
  /**
   * Already-computed PRs for this exercise, from `getPRsForExercise`.
   * Absent while loading, on failure, or when the exercise has no PR. This
   * component only formats what it is given; it never computes a record.
   */
  pr?: ExercisePR | null;
  onMove: (direction: -1 | 1) => void;
  /** Renames this day's row only; the library row is left alone. */
  onRename: (name: string) => void;
  onDeleteExercise: () => void;
  onAddSet: () => void;
  /** Resolves once persisted; rejects if the write failed. */
  onChangeSet: (setId: string, patch: { weightKg?: number | null; reps?: number | null }) => void | Promise<void>;
  /** Completion toggle; `patch` carries an unsaved weight draft, if any. */
  onToggleSet: (setId: string, patch?: TogglePatch) => void | Promise<void>;
  onDeleteSet: (setId: string) => void;
  /**
   * Whether the session-volume record belongs to this block.
   *
   * Passed in as a boolean rather than letting the block compare
   * `achievements.volume.workoutExerciseId` itself: that comparison is the only
   * thing that varies per block, and hoisting it to the parent keeps this prop
   * a primitive so memo can bail out on it. Optional so a caller that does not
   * supply it (the component tests) keeps the previous behaviour.
   */
  isVolumeRecordHere?: boolean;
}

function ExerciseBlockComponent({
  session,
  index,
  total,
  unit,
  intensity,
  pr,
  onMove,
  onRename,
  onDeleteExercise,
  onAddSet,
  onChangeSet,
  onToggleSet,
  onDeleteSet,
  isVolumeRecordHere,
}: Props) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(session.exerciseName);

  useEffect(() => setDraft(session.exerciseName), [session.exerciseName]);

  const createdUnder = intensityFromNote(session.note);
  const shown = intensity ?? createdUnder;
  const preset = findIntensity(shown);
  const done = session.sets.filter((set) => set.completed).length;

  // Formatting only: the stored kilograms decide the record, `unit` decides how
  // it reads. Re-derived on every render, so a unit switch needs no new query.
  const currentPr = pr?.current ?? null;
  const trophySetIds = pr?.trophySetIds ?? [];
  const achievements = pr?.achievements;
  /*
   * Only the session that holds the volume record displays it; a second block
   * for the same exercise on another day stays clean.
   *
   * The parent hoists the decision into `isVolumeRecordHere`, so this file does
   * not compare ids while rendering. When the prop is omitted the original
   * comparison is used, which keeps a direct caller (such as a component test
   * that passes only the older props) behaving exactly as before.
   */
  const volumeAchievement = achievements?.volume ?? null;
  const volumeRecordHere =
    isVolumeRecordHere === undefined
      ? volumeAchievement !== null && volumeAchievement.workoutExerciseId === session.id
        ? volumeAchievement
        : null
      : isVolumeRecordHere
        ? volumeAchievement
        : null;

  /*
   * The trophy means "this set holds the record *now*", not "this set set a
   * record once". The record engine now answers that directly, so a set that
   * was surpassed keeps its badge but loses the trophy: the two indicators can
   * never contradict each other. `trophySetIds` is the fallback for an
   * `ExercisePR` built without achievements, which keeps older callers and
   * fixtures working exactly as before.
   */
  const currentWeightSetId =
    achievements === undefined ? null : (achievements.weight?.setId ?? null);
  const holdsWeightRecord = (setId: string): boolean =>
    currentWeightSetId === null
      ? trophySetIds.includes(setId)
      : currentWeightSetId === setId;

  /*
   * Current bests for the metrics that have no per-set indicator of their own.
   * Every one of these comes from the achievements block that was already
   * derived from history, so the summary costs no extra query.
   */
  const bestEstimate = achievements?.estimatedOneRepMax ?? null;
  const bestReps = achievements?.maxReps ?? null;
  // Heaviest weight is deliberately absent: the Phase 5b `★ PR` line above
  // already reports it, and showing it again here would duplicate that figure.
  const hasRecordSummary =
    bestEstimate !== null || bestReps !== null || volumeRecordHere !== null;

  function commit(): void {
    if (draft.trim() !== '' && draft.trim() !== session.exerciseName) onRename(draft.trim());
    setRenaming(false);
  }

  return (
    <article className="flex flex-col gap-2 rounded-2xl bg-slate-900/70 p-3 ring-1 ring-inset ring-slate-800">
      <header className="flex items-start gap-1">
        <div className="flex flex-col">
          <button
            type="button"
            aria-label={`Move ${session.exerciseName} up`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
            className="h-9 w-7 rounded text-[10px] text-slate-500 enabled:hover:text-emerald-300 disabled:opacity-30"
          >
            ▲
          </button>
          <button
            type="button"
            aria-label={`Move ${session.exerciseName} down`}
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            className="h-9 w-7 rounded text-[10px] text-slate-500 enabled:hover:text-emerald-300 disabled:opacity-30"
          >
            ▼
          </button>
        </div>

        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              value={draft}
              autoFocus
              aria-label={`Rename ${session.exerciseName}`}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commit();
                if (event.key === 'Escape') {
                  setDraft(session.exerciseName);
                  setRenaming(false);
                }
              }}
              className="min-h-[44px] w-full rounded-lg bg-slate-950 px-2 text-sm text-slate-100 ring-1 ring-slate-700 focus:ring-emerald-400 focus:outline-none"
            />
          ) : (
            <h3 className="truncate text-sm font-semibold text-slate-100">{session.exerciseName}</h3>
          )}
          <p className="mt-0.5 text-[11px] text-slate-500">
            {preset.name} · {preset.repMin}–{preset.repMax} reps ·{' '}
            <span className="text-emerald-400/80">{done}/{session.sets.length} done</span>
          </p>
          {currentPr === null ? null : (
            <p className="mt-0.5 text-[11px] font-semibold text-amber-300">
              <span aria-hidden="true">★ </span>
              <span aria-live="polite">
                PR {formatWeight(currentPr.weightKg, unit)} {unit}
              </span>
            </p>
          )}
          {/*
            Current record summary: the best values this exercise has ever
            reached, for every 6A metric that has no line of its own. It answers
            "what am I chasing today?" without opening the workout that holds
            the record.

            Heaviest weight is not repeated here -- the `★ PR` line above is its
            single home. Every remaining figure is optional and independently
            omitted, so a bodyweight exercise shows no e1RM entry rather than an
            invented load, and the block disappears entirely when nothing
            qualifies.
          */}
          {hasRecordSummary ? (
            <ul
              aria-label={`Current records for ${session.exerciseName}`}
              className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]"
            >
              {bestEstimate === null ? null : (
                <li
                  aria-label={`Current estimated 1RM: ${formatWeight(bestEstimate.estimatedKg, unit)} ${unit}`}
                  className="text-violet-300"
                >
                  <span aria-hidden="true">e1RM </span>
                  {formatWeight(bestEstimate.estimatedKg, unit)} {unit}
                </li>
              )}
              {bestReps === null ? null : (
                <li aria-label={`Current maximum reps: ${bestReps.reps}`} className="text-sky-300">
                  <span aria-hidden="true">Reps </span>
                  {bestReps.reps}
                </li>
              )}
              {bestReps === null || bestReps.reps >= REP_RANGE_MAX ? null : (
                // The current best rep count, named as the record it holds.
                <li
                  aria-label={`Current ${bestReps.reps}RM: ${bestReps.weightKg === null ? 'bodyweight' : `${formatWeight(bestReps.weightKg, unit)} ${unit}`}`}
                  className="text-amber-200/90"
                >
                  <span aria-hidden="true">{bestReps.reps}RM </span>
                  {bestReps.weightKg === null
                    ? 'bodyweight'
                    : `${formatWeight(bestReps.weightKg, unit)} ${unit}`}
                </li>
              )}
              {volumeRecordHere === null ? null : (
                // Volume belongs to the session, not to a set, so only the
                // session that holds it shows it -- same rule as before, now
                // listed with the other current bests rather than on its own.
                <li className="font-semibold text-teal-300">
                  <span aria-label="Best session volume record" role="img">
                    <span aria-hidden="true">◆ </span>
                  </span>
                  <span aria-live="polite">
                    Best volume {formatWeight(volumeRecordHere.volumeKg, unit)} {unit}·reps
                  </span>
                </li>
              )}
            </ul>
          ) : null}
        </div>

        <button
          type="button"
          aria-label={`Rename ${session.exerciseName} in workout`}
          onClick={() => setRenaming(true)}
          className="h-11 px-2 text-[11px] font-semibold uppercase text-slate-500 hover:text-emerald-300"
        >
          rename
        </button>
        <button
          type="button"
          aria-label={`Delete ${session.exerciseName} from workout`}
          onClick={onDeleteExercise}
          className="h-11 px-2 text-[11px] font-semibold uppercase text-slate-500 hover:text-rose-300"
        >
          delete
        </button>
      </header>

      <ul className="flex flex-col gap-1.5">
        {session.sets.map((set) => (
          <SetRow
            key={set.id}
            set={set}
            unit={unit}
            isPr={holdsWeightRecord(set.id)}
            records={achievements === undefined ? undefined : setRecords(achievements, set.id)}
            currentRecords={
              achievements === undefined ? undefined : (achievements.currentBySetId.get(set.id) ?? [])
            }
            onChange={(patch) => onChangeSet(set.id, patch)}
            onToggle={(patch) => onToggleSet(set.id, patch)}
            onDelete={() => onDeleteSet(set.id)}
          />
        ))}
      </ul>

      <button
        type="button"
        onClick={onAddSet}
        className="min-h-[40px] rounded-xl text-xs font-semibold text-slate-400 ring-1 ring-inset ring-slate-700 hover:text-emerald-300 hover:ring-emerald-500/40"
      >
        + set
      </button>
    </article>
  );
}

/**
 * True when two sessions describe the same exercise with the same sets.
 *
 * A reference check is useless here: every refresh re-reads IndexedDB and Dexie
 * materialises fresh objects, so `<WorkoutScreen>`'s blocks would always look
 * changed. Comparing the fields the render actually reads (plus each set's
 * editable state, by id) is what lets an untouched block bail out.
 */
function sameSession(a: SessionExercise, b: SessionExercise): boolean {
  if (a === b) return true;
  if (
    a.id !== b.id ||
    a.exerciseId !== b.exerciseId ||
    a.exerciseName !== b.exerciseName ||
    a.order !== b.order ||
    a.note !== b.note ||
    a.sets.length !== b.sets.length
  ) {
    return false;
  }
  for (let index = 0; index < a.sets.length; index += 1) {
    const left = a.sets[index];
    const right = b.sets[index];
    if (
      left.id !== right.id ||
      left.setNumber !== right.setNumber ||
      left.weightKg !== right.weightKg ||
      left.reps !== right.reps ||
      left.completed !== right.completed
    ) {
      return false;
    }
  }
  return true;
}

/** True when the two PR values would render identically. */
function samePrValue(a: ExercisePR | null | undefined, b: ExercisePR | null | undefined): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (a.exerciseName !== b.exerciseName) return false;
  if (a.current?.setId !== b.current?.setId) return false;
  if (a.current?.weightKg !== b.current?.weightKg) return false;
  if (a.trophySetIds.length !== b.trophySetIds.length) return false;
  for (let index = 0; index < a.trophySetIds.length; index += 1) {
    if (a.trophySetIds[index] !== b.trophySetIds[index]) return false;
  }
  const left = a.achievements;
  const right = b.achievements;
  if (left === undefined || right === undefined) return left === right;
  return (
    left.weight?.setId === right.weight?.setId &&
    left.weight?.weightKg === right.weight?.weightKg &&
    left.estimatedOneRepMax?.setId === right.estimatedOneRepMax?.setId &&
    left.maxReps?.setId === right.maxReps?.setId &&
    left.volume?.workoutExerciseId === right.volume?.workoutExerciseId &&
    left.volume?.volumeKg === right.volume?.volumeKg &&
    left.setCount === right.setCount
  );
}

/**
 * Memoised so a refresh that leaves this exercise untouched does not re-render
 * it.
 *
 * The comparison is by value for the two data props, because Dexie hands back new
 * objects on every read, and by identity for everything else -- the parent keeps
 * the callbacks and the hoisted `isVolumeRecordHere` primitive stable. `total` is
 * compared too, since it drives the "move down" disabled state.
 */
export const ExerciseBlock = memo(
  ExerciseBlockComponent,
  (prev, next) =>
    prev.index === next.index &&
    prev.total === next.total &&
    prev.unit === next.unit &&
    prev.intensity === next.intensity &&
    prev.isVolumeRecordHere === next.isVolumeRecordHere &&
    prev.onMove === next.onMove &&
    prev.onRename === next.onRename &&
    prev.onDeleteExercise === next.onDeleteExercise &&
    prev.onAddSet === next.onAddSet &&
    /*
     * The set-level callbacks are deliberately *not* compared: this component
     * passes each row a fresh arrow bound to that row's id, so their identity
     * changes every render. What matters is that the row's own data did not
     * change, and `sameSession` already covers every set field.
     */
    samePrValue(prev.pr, next.pr) &&
    sameSession(prev.session, next.session),
);
ExerciseBlock.displayName = 'ExerciseBlock';

export default ExerciseBlock;
