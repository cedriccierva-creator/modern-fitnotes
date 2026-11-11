import { useMemo, useState } from 'react';
import {
  CATALOG_CATEGORIES,
  LEVEL_LABELS,
  filterCatalog,
  type CatalogExercise,
  type CatalogLevel,
  type CatalogLibrary,
} from '../lib/exerciseCatalog';
import type { Exercise } from '../types';

const NUMBER_INPUT =
  'min-h-[44px] w-full rounded-xl bg-slate-900/70 px-3 text-sm text-slate-100 ring-1 ring-inset ring-slate-800 focus:ring-emerald-400 focus:outline-none';

const LIBRARY_TABS: { id: CatalogLibrary; label: string }[] = [
  { id: 'gym', label: 'Gym' },
  { id: 'home', label: 'Home' },
  { id: 'minimal', label: 'Minimal kit' },
];

const LEVELS: CatalogLevel[] = ['B', 'I', 'A'];

interface Props {
  /** The user's own library, used for search and duplicate badges. */
  library: readonly Exercise[];
  /** Catalog ids already present in the library, directly or by name. */
  adoptedCatalogIds: ReadonlySet<string>;
  /** Attach an existing library row to today (the pre-5c behaviour). */
  onAddLibraryExercise: (exercise: Exercise) => void;
  /** Attach a catalog suggestion to today without adopting it. */
  onAddToToday: (entry: CatalogExercise) => void;
  /** Add a catalog suggestion to the library only. */
  onAdopt: (entry: CatalogExercise) => void;
  onCreate: (name: string, muscleGroup: string) => void;
}

/**
 * Searchable exercise picker: the built-in catalog on one side of the glass, the
 * personal library on the other.
 *
 * "Add to today" and "Adopt" are deliberately separate controls — adopting fills
 * the library for future use, while adding to today touches only this workout.
 * Browsing here reads `lib/exerciseCatalog` and nothing else, so opening the
 * picker performs no database writes at all.
 */
export default function AddExercise({
  library,
  adoptedCatalogIds,
  onAddLibraryExercise,
  onAddToToday,
  onAdopt,
  onCreate,
}: Props) {
  const [libraryTab, setLibraryTab] = useState<CatalogLibrary | 'mine'>('gym');
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [level, setLevel] = useState<CatalogLevel | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | undefined>(undefined);

  const [name, setName] = useState('');
  const [muscleGroup, setMuscleGroup] = useState('');

  const mineMatches = useMemo(
    () =>
      library.filter((exercise) => !exercise.archived).filter((exercise) =>
        exercise.name.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [library, query],
  );

  const catalogMatches = useMemo(
    () =>
      libraryTab === 'mine'
        ? []
        : filterCatalog({
            search: query,
            library: libraryTab,
            category,
            level,
          }),
    [libraryTab, query, category, level],
  );

  function chooseTab(next: CatalogLibrary | 'mine'): void {
    setLibraryTab(next);
    // Categories differ per library, so a stale chip would silently empty the
    // list; clear both filters when the library changes.
    setCategory(undefined);
    setLevel(undefined);
  }

  const categories = libraryTab === 'mine' ? [] : CATALOG_CATEGORIES[libraryTab];

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        Add exercise
      </h3>

      <div className="flex rounded-xl ring-1 ring-inset ring-slate-800">
        {[...LIBRARY_TABS.map((tab) => ({ id: tab.id as CatalogLibrary | 'mine', label: tab.label })), { id: 'mine' as const, label: 'My library' }].map(
          (tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={libraryTab === tab.id}
              onClick={() => chooseTab(tab.id)}
              className={`min-h-[44px] flex-1 px-2 text-xs font-semibold first:rounded-l-xl last:rounded-r-xl ${
                libraryTab === tab.id ? 'bg-emerald-500/20 text-emerald-200' : 'text-slate-500'
              }`}
            >
              {tab.label}
            </button>
          ),
        )}
      </div>

      <input
        value={query}
        placeholder="Search exercises"
        aria-label="Search exercises"
        onChange={(event) => setQuery(event.target.value)}
        className={NUMBER_INPUT}
      />

      {categories.length > 0 ? (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            aria-pressed={category === undefined}
            onClick={() => setCategory(undefined)}
            className={`min-h-[44px] shrink-0 rounded-full px-3 text-[11px] font-semibold ring-1 ring-inset ${
              category === undefined
                ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-500/40'
                : 'bg-slate-800/70 text-slate-400 ring-slate-700'
            }`}
          >
            All
          </button>
          {categories.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={category === value}
              onClick={() => setCategory(category === value ? undefined : value)}
              className={`min-h-[44px] shrink-0 rounded-full px-3 text-[11px] font-semibold ring-1 ring-inset ${
                category === value
                  ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-500/40'
                  : 'bg-slate-800/70 text-slate-400 ring-slate-700'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      ) : null}

      {libraryTab === 'mine' ? null : (
        <div className="flex gap-1.5">
          {LEVELS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={level === value}
              onClick={() => setLevel(level === value ? undefined : value)}
              className={`min-h-[44px] shrink-0 rounded-full px-3 text-[11px] font-semibold ring-1 ring-inset ${
                level === value
                  ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-500/40'
                  : 'bg-slate-800/70 text-slate-400 ring-slate-700'
              }`}
            >
              {LEVEL_LABELS[value]}
            </button>
          ))}
        </div>
      )}

      {libraryTab === 'mine' ? (
        mineMatches.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {mineMatches.map((exercise) => (
              <li key={exercise.id}>
                <button
                  type="button"
                  onClick={() => onAddLibraryExercise(exercise)}
                  className="min-h-[44px] rounded-full bg-slate-800/70 px-3 text-xs font-semibold text-slate-300 ring-1 ring-inset ring-slate-700 hover:text-emerald-200 hover:ring-emerald-500/40"
                >
                  + {exercise.name}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-slate-500">No library exercise matches — create one below.</p>
        )
      ) : catalogMatches.length === 0 ? (
        <p className="text-[11px] text-slate-500">No exercise matches — create one below.</p>
      ) : (
        <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto pr-1">
          {catalogMatches.map((entry) => {
            const adopted = adoptedCatalogIds.has(entry.id);
            const isOpen = expanded === entry.id;

            return (
              <li
                key={entry.id}
                className="flex flex-col gap-1 rounded-xl bg-slate-900/50 p-2 ring-1 ring-inset ring-slate-800"
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? undefined : entry.id)}
                  className="flex min-h-[44px] w-full items-center gap-2 text-left"
                >
                  <span className="flex-1 truncate text-xs font-semibold text-slate-200">
                    {entry.name}
                  </span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-500">
                    {entry.category}
                  </span>
                  {entry.level === undefined ? null : (
                    <span
                      aria-label={`Level ${LEVEL_LABELS[entry.level]}`}
                      className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-400"
                    >
                      {entry.level}
                    </span>
                  )}
                </button>

                <p className="text-[10px] text-slate-500">
                  {[
                    entry.equipment === undefined ? null : `Equipment: ${entry.equipment}`,
                    entry.targets === undefined ? null : `Targets: ${entry.targets}`,
                    entry.type === undefined ? null : `Type: ${entry.type}`,
                    entry.holdOrReps === undefined ? null : `Hold: ${entry.holdOrReps}`,
                  ]
                    .filter((part): part is string => part !== null)
                    .join(' · ')}
                </p>

                {isOpen ? (
                  <p className="text-[10px] text-slate-400">
                    {[
                      entry.easier === undefined ? null : `Easier: ${entry.easier}`,
                      entry.harder === undefined ? null : `Harder: ${entry.harder}`,
                    ]
                      .filter((part): part is string => part !== null)
                      .join(' · ') || 'No progression listed in the source.'}
                  </p>
                ) : null}

                <div className="flex gap-1.5">
                  <button
                    type="button"
                    aria-label={`Add ${entry.name} to today`}
                    onClick={() => onAddToToday(entry)}
                    className="min-h-[44px] flex-1 rounded-lg bg-emerald-500/15 px-2 text-[11px] font-bold text-emerald-200 ring-1 ring-inset ring-emerald-500/40"
                  >
                    + Today
                  </button>
                  <button
                    type="button"
                    aria-label={adopted ? `${entry.name} is in your library` : `Add ${entry.name} to library`}
                    disabled={adopted}
                    onClick={() => onAdopt(entry)}
                    className="min-h-[44px] flex-1 rounded-lg px-2 text-[11px] font-semibold text-slate-300 ring-1 ring-inset ring-slate-700 disabled:text-emerald-300/70"
                  >
                    {adopted ? '✓ In library' : '+ Library'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-1 flex gap-2">
        <input
          value={name}
          placeholder="New exercise"
          aria-label="New exercise name"
          onChange={(event) => setName(event.target.value)}
          className="min-h-[44px] flex-1 rounded-xl bg-slate-900/70 px-3 text-sm text-slate-100 ring-1 ring-inset ring-slate-800 focus:ring-emerald-400 focus:outline-none"
        />
        <input
          value={muscleGroup}
          placeholder="Group"
          aria-label="New exercise group"
          onChange={(event) => setMuscleGroup(event.target.value)}
          className="min-h-[44px] w-24 rounded-xl bg-slate-900/70 px-3 text-sm text-slate-100 ring-1 ring-inset ring-slate-800 focus:ring-emerald-400 focus:outline-none"
        />
        <button
          type="button"
          disabled={name.trim() === ''}
          onClick={() => {
            onCreate(name.trim(), muscleGroup.trim());
            setName('');
            setMuscleGroup('');
          }}
          className="min-h-[44px] rounded-xl bg-emerald-500 px-3 text-xs font-bold text-slate-950 disabled:opacity-40"
        >
          Create
        </button>
      </div>
    </section>
  );
}
