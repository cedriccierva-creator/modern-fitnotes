import { useEffect, useRef, useState } from 'react';
import { formatWeight, parseRepInput, parseWeightInput } from '../lib/units';
import type { WorkoutSet } from '../types';

const NUMBER_INPUT =
  'min-h-[44px] w-full rounded-lg bg-slate-950 px-2 py-1 text-center text-sm text-slate-100 ring-1 ring-inset ring-slate-700 focus:ring-emerald-400 focus:outline-none';

/** The optional weight patch a toggle carries, so one write records both. */
export type TogglePatch = { weightKg?: number | null };

interface Props {
  set: WorkoutSet;
  unit: 'kg' | 'lb';
  /** True when this set holds the exercise's weight PR. Decided outside. */
  isPr?: boolean;
  /**
   * Persist a patch. The returned promise settles when the write has actually
   * happened, which is what lets this row distinguish "saved" from "pending".
   */
  onChange: (patch: { weightKg?: number | null; reps?: number | null }) => void | Promise<void>;
  /**
   * Completion toggle, carrying the draft weight when one was still unsaved.
   * The caller merges it into a single write with the completed flag.
   */
  onToggle: (patch?: TogglePatch) => void | Promise<void>;
  onDelete: () => void;
}

/**
 * One editable set row. Weight is typed in the display unit but converted to
 * kilograms on parse, so nothing is ever stored in pounds.
 */
export default function SetRow({ set, unit, isPr = false, onChange, onToggle, onDelete }: Props) {
  const [weight, setWeight] = useState(() => formatWeight(set.weightKg, unit));
  const [reps, setReps] = useState(() => (set.reps === null ? '' : String(set.reps)));

  /**
   * The last weight *confirmed* persisted. It is only advanced after a write
   * resolves, so a rejected write leaves the draft eligible for a retry.
   */
  const savedWeight = useRef<number | null>(set.weightKg);
  /**
   * The weight of an in-flight write, if any. Kept separate from `savedWeight`
   * so "being written" is never mistaken for "written", and so a second blur or
   * a toggle can wait for it instead of issuing a duplicate write.
   */
  const pendingWeight = useRef<number | null | undefined>(undefined);
  const pendingWrite = useRef<Promise<void> | undefined>(undefined);

  // Re-sync when the underlying row is replaced, e.g. unit or day changes.
  useEffect(() => {
    setWeight(formatWeight(set.weightKg, unit));
    savedWeight.current = set.weightKg;
  }, [set.weightKg, unit]);

  useEffect(() => {
    setReps(set.reps === null ? '' : String(set.reps));
  }, [set.reps]);

  /**
   * The draft as stored kilograms:
   * - `undefined` when the text is not a usable weight, so a typo can never
   *   overwrite a stored value (completion still toggles).
   * - `null` when the field is empty, which is a deliberate clear.
   * - the parsed kilograms otherwise.
   */
  function draftWeight(): number | null | undefined {
    const parsed = parseWeightInput(weight, unit);
    if (parsed === null && weight.trim() !== '') return undefined;
    return parsed;
  }

  /**
   * Blur path: persist the draft once.
   *
   * `savedWeight` advances only when the write resolves. A rejection clears the
   * pending marker and swallows the error (the parent reports its own), leaving
   * the value unsaved so a later blur or toggle retries it. Repeated blurs with
   * the same text, or a blur whose value is already stored, write nothing.
   */
  function commitDraft(): Promise<void> {
    const next = draftWeight();
    if (next === undefined) return Promise.resolve();
    if (next === savedWeight.current) return Promise.resolve();
    const inFlight = pendingWrite.current;
    if (inFlight !== undefined && next === pendingWeight.current) return inFlight;

    pendingWeight.current = next;
    const write = Promise.resolve(onChange({ weightKg: next }))
      .then(() => {
        savedWeight.current = next;
      })
      .catch(() => {
        // Not persisted: leave savedWeight untouched so the value can retry.
      })
      .finally(() => {
        if (pendingWeight.current === next) {
          pendingWeight.current = undefined;
          pendingWrite.current = undefined;
        }
      });

    pendingWrite.current = write;
    return write;
  }

  /**
   * Toggle path: hand the unsaved draft to the caller so weight and completion
   * are written together in one updateSet and one refresh.
   *
   * If a blur write is still in flight the toggle waits for it first, so the
   * database sees one ordered sequence and the same weight is never written
   * twice: once it lands, only completion is sent. If it failed, the retry
   * happens inside the toggle write instead.
   */
  function toggleComplete(): void {
    const commit = (): void => {
      const next = draftWeight();
      if (next === undefined || next === savedWeight.current) {
        void onToggle();
        return;
      }
      void onToggle({ weightKg: next });
    };

    const inFlight = pendingWrite.current;
    if (inFlight === undefined) {
      commit();
      return;
    }
    void inFlight.then(commit);
  }

  return (
    <li
      className={`flex items-center gap-2 rounded-xl px-2 py-2 transition-colors ${
        set.completed
          ? 'bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/40'
          : 'bg-slate-800/50 ring-1 ring-inset ring-slate-700/70'
      }`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={set.completed}
        aria-label={`Set ${set.setNumber} complete`}
        onClick={toggleComplete}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold transition-colors ${
          set.completed
            ? 'bg-emerald-500 text-slate-950'
            : 'bg-slate-900 text-slate-500 ring-1 ring-inset ring-slate-600 hover:text-emerald-300'
        }`}
      >
        {set.setNumber}
      </button>

      <label className="flex-1">
        <span className="sr-only">Weight for set {set.setNumber}</span>
        <input
          inputMode="decimal"
          placeholder={unit}
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
          onBlur={() => void commitDraft()}
          className={NUMBER_INPUT}
        />
      </label>

      {isPr ? (
        // Decoration only, never interactive, so the 44px targets are untouched.
        // The label carries the meaning: a bare tint would rely on colour alone.
        <span
          role="img"
          aria-label="Personal record set"
          title="Personal record"
          className="w-5 shrink-0 text-center text-sm text-amber-300"
        >
          ★
        </span>
      ) : null}

      <label className="w-16">
        <span className="sr-only">Repetitions for set {set.setNumber}</span>
        <input
          inputMode="numeric"
          placeholder="reps"
          value={reps}
          onChange={(event) => setReps(event.target.value)}
          onBlur={() => onChange({ reps: parseRepInput(reps) })}
          className={NUMBER_INPUT}
        />
      </label>

      <button
        type="button"
        aria-label={`Delete set ${set.setNumber}`}
        onClick={onDelete}
        className="flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:text-rose-300"
      >
        ✕
      </button>
    </li>
  );
}
