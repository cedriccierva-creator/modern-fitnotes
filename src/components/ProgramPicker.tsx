import { ALL_CATEGORIES, CATEGORY_LABELS, ROUTINE_PRESETS } from '../lib/routines';
import { formatDateLabel } from '../lib/month';
import type { WorkoutCategory } from '../types';

interface Props {
  date: string;
  onPick: (presetId: string, category: WorkoutCategory) => void;
  onClose: () => void;
}

/**
 * Choose what one date is for.
 *
 * Routines are offered as *templates*: picking "PPLUL: Push" writes a single
 * Push day carrying `presetId: 'ppl-flow'`. Nothing is spread across a week and
 * nothing is scheduled — the picker only ever describes the one date it was
 * opened for. Category-only picks use `presetId: 'custom'`.
 */
export default function ProgramPicker({ date, onPick, onClose }: Props) {
  return (
    <section
      role="dialog"
      aria-label={`Assign a program for ${formatDateLabel(date)}`}
      className="flex flex-col gap-3 rounded-2xl bg-slate-900/80 p-3 ring-1 ring-inset ring-slate-800"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          Assign a program
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-[11px] text-slate-400 ring-1 ring-slate-800 hover:text-rose-300"
        >
          Cancel
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[11px] text-slate-500">From a routine</p>
        {ROUTINE_PRESETS.map((preset) => {
          const templates = [...new Set(preset.templates)];
          return (
            <div key={preset.id} className="flex flex-col gap-1">
              <p className="text-[11px] font-semibold text-slate-300">{preset.name}</p>
              <div className="flex flex-wrap gap-1">
                {templates.map((category) => (
                  <button
                    key={`${preset.id}-${category}`}
                    type="button"
                    aria-label={`${preset.name}: ${CATEGORY_LABELS[category]}`}
                    onClick={() => onPick(preset.id, category)}
                    className="min-h-[36px] rounded-lg bg-slate-800/70 px-2.5 text-[11px] font-semibold text-slate-300 ring-1 ring-inset ring-slate-700 hover:ring-emerald-500/40"
                  >
                    {CATEGORY_LABELS[category]}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-[11px] text-slate-500">Any category</p>
        <div className="flex flex-wrap gap-1">
          {ALL_CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              aria-label={`Any category: ${CATEGORY_LABELS[category]}`}
              onClick={() => onPick('custom', category)}
              className="min-h-[36px] rounded-lg bg-slate-800/70 px-2.5 text-[11px] font-semibold text-slate-300 ring-1 ring-inset ring-slate-700 hover:ring-emerald-500/40"
            >
              {CATEGORY_LABELS[category]}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
