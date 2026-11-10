import { INTENSITY_PRESETS } from '../lib/intensity';
import type { IntensityId } from '../lib/intensity';

/** Three-way intensity selector. The chosen preset drives generated set rows. */
export default function IntensityPicker({
  value,
  onChange,
}: {
  value: IntensityId;
  onChange: (id: IntensityId) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Intensity" className="grid grid-cols-3 gap-2">
      {INTENSITY_PRESETS.map((preset) => {
        const active = preset.id === value;
        return (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(preset.id)}
            className={`min-h-[64px] rounded-xl px-2 py-2 text-center transition-colors ${
              active
                ? `${preset.tone} ring-1 ring-inset`
                : 'bg-slate-800/60 text-slate-400 ring-1 ring-inset ring-slate-700 hover:ring-emerald-500/40'
            }`}
          >
            <span className="block text-xs font-semibold">{preset.name}</span>
            <span className="mt-0.5 block text-[10px] font-normal opacity-80">{preset.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
