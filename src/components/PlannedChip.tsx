import type { WorkoutCategory } from '../types';
import { CATEGORY_CHIP } from '../lib/categoryStyles';

/** Compact category pill shown under a calendar date. */
export default function PlannedChip({ category, label }: { category: WorkoutCategory; label: string }) {
  return (
    <span
      className={`block truncate rounded-md px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${CATEGORY_CHIP[category]}`}
      title={label}
    >
      {label}
    </span>
  );
}
