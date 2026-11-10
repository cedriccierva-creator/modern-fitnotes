import { cx } from '../lib/cx';

const PLANNED: readonly { title: string; blurb: string }[] = [
  { title: 'Calendar', blurb: 'Month grid of every session' },
  { title: 'Routines', blurb: 'PPL, upper/lower, full body' },
  { title: 'Log', blurb: 'Weight, reps, per exercise' },
  { title: 'Records', blurb: 'PRs and set history' },
];

/**
 * Placeholder landing screen for the foundation phase. It exists to prove the
 * shell, the theme and the tile pattern that later screens will reuse; it is
 * replaced by the calendar in the next phase.
 */
export default function HomeScreen() {
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400/80">
          Phase 1 · Foundation
        </p>
        <h1 className="text-3xl font-bold leading-tight text-slate-50">
          Train hard. <span className="text-emerald-400">Log everything.</span>
        </h1>
        <p className="text-sm leading-relaxed text-slate-400">
          An offline-first workout tracker. Everything you enter stays on your
          device.
        </p>
      </div>

      <ul className="grid grid-cols-2 gap-3">
        {PLANNED.map((item) => (
          <li
            key={item.title}
            className={cx(
              'rounded-2xl bg-slate-900/70 p-4 ring-1 ring-inset ring-slate-800',
              'transition-colors hover:ring-emerald-500/40',
            )}
          >
            <p className="text-sm font-semibold text-slate-200">{item.title}</p>
            <p className="mt-1 text-xs leading-snug text-slate-500">{item.blurb}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
