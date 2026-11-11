/**
 * Built-in exercise catalog.
 *
 * Static application data — it is never inserted into Dexie. A fresh install can
 * browse the whole catalog with zero database writes; a row is created only when
 * the user adopts an entry or logs it against a day.
 *
 * Source: "Complete Workout Library: Exercises and Routines (Gym + Home)"
 * (Nov 11, 2026 · @Cedric), library sections only. Every name, equipment,
 * targets, level and progression string below is reproduced verbatim from that
 * document; nothing was invented or reworded. Routines and influencer programs
 * are deliberately excluded — they are not exercises.
 *
 * The three libraries are kept distinct (`gym`, `home`, `minimal`) exactly as the
 * source separates them. Where the same movement appears in more than one
 * library only the first occurrence is kept, which is why the counts below are
 * lower than the raw table rows: 340 rows became 318 entries (21 repeats plus
 * one malformed combined row, see DROPPED_ENTRIES).
 *
 * `id` is derived from library + category + name and is stable across releases,
 * so an adopted exercise keeps pointing at the same catalog entry after a
 * rename. It is a catalog key, *not* the row primary key: adopted rows get their
 * own generated id, so a user's renamed row can never collide with a re-adopt.
 */

/** Where an entry came from in the source document. */
export type CatalogLibrary = 'gym' | 'home' | 'minimal';

/** Source difficulty tag: B beginner, I intermediate, A advanced. */
export type CatalogLevel = 'B' | 'I' | 'A';

export interface CatalogExercise {
  /** Stable catalog key. Never reused, never renumbered. */
  id: string;
  /** Verbatim name from the source document. */
  name: string;
  library: CatalogLibrary;
  /** Verbatim section heading, minus its parenthetical qualifier. */
  category: string;
  /** Only where the source lists it. */
  equipment?: string;
  /** Only where the source lists it. Cardio rows carry a `type` instead. */
  targets?: string;
  /**
   * The source's "Type" column, cardio rows only (e.g. "Low-impact cardio").
   * Kept separate from `targets` so the two are never conflated.
   */
  type?: string;
  /** Absent for the mobility section, which the source does not grade. */
  level?: CatalogLevel;
  /** Home library only: the source's easier/harder regressions. */
  easier?: string;
  harder?: string;
  /** Mobility section only: the source's "Hold or reps" prescription. */
  holdOrReps?: string;
}

export const CATALOG: readonly CatalogExercise[] = [
  { id: 'gym-chest-flat-barbell-bench-press', name: 'Flat barbell bench press', library: 'gym', category: 'Chest', equipment: 'Barbell, bench', targets: 'Mid chest, triceps, front delts', level: 'B' },
  { id: 'gym-chest-incline-barbell-bench-press', name: 'Incline barbell bench press', library: 'gym', category: 'Chest', equipment: 'Barbell, incline bench', targets: 'Upper chest', level: 'I' },
  { id: 'gym-chest-close-grip-incline-barbell-press', name: 'Close-grip incline barbell press', library: 'gym', category: 'Chest', equipment: 'Barbell, incline bench', targets: 'Upper chest, triceps', level: 'I' },
  { id: 'gym-chest-decline-barbell-press', name: 'Decline barbell press', library: 'gym', category: 'Chest', equipment: 'Barbell, decline bench', targets: 'Lower chest', level: 'I' },
  { id: 'gym-chest-flat-dumbbell-press', name: 'Flat dumbbell press', library: 'gym', category: 'Chest', equipment: 'Dumbbells, bench', targets: 'Mid chest', level: 'B' },
  { id: 'gym-chest-incline-dumbbell-press', name: 'Incline dumbbell press', library: 'gym', category: 'Chest', equipment: 'Dumbbells, incline bench', targets: 'Upper chest', level: 'B' },
  { id: 'gym-chest-neutral-grip-dumbbell-press', name: 'Neutral-grip dumbbell press', library: 'gym', category: 'Chest', equipment: 'Dumbbells, bench', targets: 'Chest, shoulder-friendly', level: 'B' },
  { id: 'gym-chest-smith-machine-bench-press', name: 'Smith machine bench press', library: 'gym', category: 'Chest', equipment: 'Smith machine', targets: 'Chest', level: 'B' },
  { id: 'gym-chest-smith-machine-incline-press', name: 'Smith machine incline press', library: 'gym', category: 'Chest', equipment: 'Smith machine', targets: 'Upper chest', level: 'B' },
  { id: 'gym-chest-machine-chest-press', name: 'Machine chest press', library: 'gym', category: 'Chest', equipment: 'Chest press machine', targets: 'Chest', level: 'B' },
  { id: 'gym-chest-hammer-strength-incline-press', name: 'Hammer Strength incline press', library: 'gym', category: 'Chest', equipment: 'Plate-loaded machine', targets: 'Upper chest', level: 'B' },
  { id: 'gym-chest-pec-deck-machine-fly', name: 'Pec deck / machine fly', library: 'gym', category: 'Chest', equipment: 'Pec deck', targets: 'Chest (stretch and squeeze)', level: 'B' },
  { id: 'gym-chest-cable-crossover-high-to-low', name: 'Cable crossover (high to low)', library: 'gym', category: 'Chest', equipment: 'Cable station', targets: 'Lower chest', level: 'I' },
  { id: 'gym-chest-cable-crossover-low-to-high', name: 'Cable crossover (low to high)', library: 'gym', category: 'Chest', equipment: 'Cable station', targets: 'Upper chest', level: 'I' },
  { id: 'gym-chest-bent-over-cable-fly', name: 'Bent-over cable fly', library: 'gym', category: 'Chest', equipment: 'Cable station', targets: 'Mid chest', level: 'I' },
  { id: 'gym-chest-dumbbell-fly', name: 'Dumbbell fly', library: 'gym', category: 'Chest', equipment: 'Dumbbells, bench', targets: 'Chest stretch', level: 'I' },
  { id: 'gym-chest-incline-dumbbell-fly', name: 'Incline dumbbell fly', library: 'gym', category: 'Chest', equipment: 'Dumbbells, incline bench', targets: 'Upper chest', level: 'I' },
  { id: 'gym-chest-parallel-bar-dip-chest-lean', name: 'Parallel-bar dip (chest lean)', library: 'gym', category: 'Chest', equipment: 'Dip station', targets: 'Lower chest, triceps', level: 'I' },
  { id: 'gym-chest-weighted-dip', name: 'Weighted dip', library: 'gym', category: 'Chest', equipment: 'Dip station, belt', targets: 'Chest, triceps', level: 'A' },
  { id: 'gym-chest-deficit-push-up', name: 'Deficit push-up', library: 'gym', category: 'Chest', equipment: 'Plates or handles', targets: 'Chest, deeper stretch', level: 'I' },
  { id: 'gym-chest-floor-press', name: 'Floor press', library: 'gym', category: 'Chest', equipment: 'Barbell or DB', targets: 'Chest, triceps lockout', level: 'B' },
  { id: 'gym-chest-landmine-press', name: 'Landmine press', library: 'gym', category: 'Chest', equipment: 'Landmine', targets: 'Upper chest, front delts', level: 'I' },
  { id: 'gym-chest-svend-press', name: 'Svend press', library: 'gym', category: 'Chest', equipment: 'Plate', targets: 'Inner chest, pump finisher', level: 'B' },
  { id: 'gym-back-conventional-deadlift', name: 'Conventional deadlift', library: 'gym', category: 'Back', equipment: 'Barbell', targets: 'Whole posterior chain, back', level: 'I' },
  { id: 'gym-back-rack-pull', name: 'Rack pull', library: 'gym', category: 'Back', equipment: 'Barbell, rack', targets: 'Upper back, traps', level: 'I' },
  { id: 'gym-back-barbell-bent-over-row', name: 'Barbell bent-over row', library: 'gym', category: 'Back', equipment: 'Barbell', targets: 'Mid back, lats', level: 'I' },
  { id: 'gym-back-pendlay-row', name: 'Pendlay row', library: 'gym', category: 'Back', equipment: 'Barbell', targets: 'Upper back, explosive pull', level: 'A' },
  { id: 'gym-back-chest-supported-t-bar-row', name: 'Chest-supported T-bar row', library: 'gym', category: 'Back', equipment: 'T-bar, chest pad', targets: 'Mid back', level: 'B' },
  { id: 'gym-back-seal-row', name: 'Seal row', library: 'gym', category: 'Back', equipment: 'Barbell, raised bench', targets: 'Mid back, no lower-back load', level: 'I' },
  { id: 'gym-back-one-arm-dumbbell-row', name: 'One-arm dumbbell row', library: 'gym', category: 'Back', equipment: 'Dumbbell, bench', targets: 'Lats', level: 'B' },
  { id: 'gym-back-chest-supported-dumbbell-row', name: 'Chest-supported dumbbell row', library: 'gym', category: 'Back', equipment: 'Dumbbells, incline bench', targets: 'Upper back', level: 'B' },
  { id: 'gym-back-meadows-row', name: 'Meadows row', library: 'gym', category: 'Back', equipment: 'Landmine', targets: 'Lats, rear delts', level: 'I' },
  { id: 'gym-back-seated-cable-row-neutral-grip', name: 'Seated cable row (neutral grip)', library: 'gym', category: 'Back', equipment: 'Cable', targets: 'Mid back, lats', level: 'B' },
  { id: 'gym-back-wide-grip-seated-cable-row', name: 'Wide-grip seated cable row', library: 'gym', category: 'Back', equipment: 'Cable', targets: 'Upper back, rear delts', level: 'B' },
  { id: 'gym-back-machine-row-chest-supported', name: 'Machine row (chest supported)', library: 'gym', category: 'Back', equipment: 'Row machine', targets: 'Mid back', level: 'B' },
  { id: 'gym-back-pull-up', name: 'Pull-up', library: 'gym', category: 'Back', equipment: 'Bar', targets: 'Lats, biceps', level: 'I' },
  { id: 'gym-back-chin-up', name: 'Chin-up', library: 'gym', category: 'Back', equipment: 'Bar', targets: 'Lats, biceps', level: 'I' },
  { id: 'gym-back-weighted-pull-up', name: 'Weighted pull-up', library: 'gym', category: 'Back', equipment: 'Bar, belt', targets: 'Lats', level: 'A' },
  { id: 'gym-back-neutral-grip-pulldown', name: 'Neutral-grip pulldown', library: 'gym', category: 'Back', equipment: 'Cable', targets: 'Lats', level: 'B' },
  { id: 'gym-back-wide-grip-lat-pulldown', name: 'Wide-grip lat pulldown', library: 'gym', category: 'Back', equipment: 'Cable', targets: 'Lats (width)', level: 'B' },
  { id: 'gym-back-close-grip-lat-pulldown', name: 'Close-grip lat pulldown', library: 'gym', category: 'Back', equipment: 'Cable', targets: 'Lats, lower fibers', level: 'B' },
  { id: 'gym-back-single-arm-cable-pulldown', name: 'Single-arm cable pulldown', library: 'gym', category: 'Back', equipment: 'Cable', targets: 'Lats, long stretch', level: 'I' },
  { id: 'gym-back-straight-arm-cable-pulldown', name: 'Straight-arm cable pulldown', library: 'gym', category: 'Back', equipment: 'Cable', targets: 'Lats isolation', level: 'B' },
  { id: 'gym-back-dumbbell-pullover', name: 'Dumbbell pullover', library: 'gym', category: 'Back', equipment: 'Dumbbell', targets: 'Lats, serratus', level: 'I' },
  { id: 'gym-back-machine-pullover', name: 'Machine pullover', library: 'gym', category: 'Back', equipment: 'Pullover machine', targets: 'Lats', level: 'B' },
  { id: 'gym-back-inverted-row', name: 'Inverted row', library: 'gym', category: 'Back', equipment: 'Smith bar or low bar', targets: 'Mid back', level: 'B' },
  { id: 'gym-back-reverse-pec-deck', name: 'Reverse pec deck', library: 'gym', category: 'Back', equipment: 'Pec deck', targets: 'Rear delts, upper back', level: 'B' },
  { id: 'gym-back-cable-face-pull', name: 'Cable face pull', library: 'gym', category: 'Back', equipment: 'Cable, rope', targets: 'Rear delts, rotator cuff', level: 'B' },
  { id: 'gym-back-cable-reverse-fly', name: 'Cable reverse fly', library: 'gym', category: 'Back', equipment: 'Cable', targets: 'Rear delts', level: 'I' },
  { id: 'gym-back-barbell-shrug', name: 'Barbell shrug', library: 'gym', category: 'Back', equipment: 'Barbell', targets: 'Upper traps', level: 'B' },
  { id: 'gym-back-dumbbell-shrug', name: 'Dumbbell shrug', library: 'gym', category: 'Back', equipment: 'Dumbbells', targets: 'Upper traps', level: 'B' },
  { id: 'gym-back-back-extension-45-degrees', name: 'Back extension (45 degrees)', library: 'gym', category: 'Back', equipment: 'Hyperextension bench', targets: 'Lower back, glutes', level: 'B' },
  { id: 'gym-shoulders-standing-barbell-overhead-press', name: 'Standing barbell overhead press', library: 'gym', category: 'Shoulders', equipment: 'Barbell', targets: 'Front and side delts, triceps', level: 'I' },
  { id: 'gym-shoulders-seated-dumbbell-shoulder-press', name: 'Seated dumbbell shoulder press', library: 'gym', category: 'Shoulders', equipment: 'Dumbbells, bench', targets: 'Delts', level: 'B' },
  { id: 'gym-shoulders-arnold-press', name: 'Arnold press', library: 'gym', category: 'Shoulders', equipment: 'Dumbbells', targets: 'All delt heads', level: 'I' },
  { id: 'gym-shoulders-machine-shoulder-press', name: 'Machine shoulder press', library: 'gym', category: 'Shoulders', equipment: 'Machine', targets: 'Delts', level: 'B' },
  { id: 'gym-shoulders-smith-machine-shoulder-press', name: 'Smith machine shoulder press', library: 'gym', category: 'Shoulders', equipment: 'Smith machine', targets: 'Delts', level: 'B' },
  { id: 'gym-shoulders-push-press', name: 'Push press', library: 'gym', category: 'Shoulders', equipment: 'Barbell', targets: 'Delts, leg drive', level: 'A' },
  { id: 'gym-shoulders-landmine-press-half-kneeling', name: 'Landmine press (half-kneeling)', library: 'gym', category: 'Shoulders', equipment: 'Landmine', targets: 'Front delts, scap health', level: 'I' },
  { id: 'gym-shoulders-dumbbell-lateral-raise', name: 'Dumbbell lateral raise', library: 'gym', category: 'Shoulders', equipment: 'Dumbbells', targets: 'Side delts', level: 'B' },
  { id: 'gym-shoulders-cable-lateral-raise', name: 'Cable lateral raise', library: 'gym', category: 'Shoulders', equipment: 'Cable', targets: 'Side delts (constant tension)', level: 'I' },
  { id: 'gym-shoulders-machine-lateral-raise', name: 'Machine lateral raise', library: 'gym', category: 'Shoulders', equipment: 'Machine', targets: 'Side delts', level: 'B' },
  { id: 'gym-shoulders-leaning-cable-lateral-raise', name: 'Leaning cable lateral raise', library: 'gym', category: 'Shoulders', equipment: 'Cable', targets: 'Side delts, long stretch', level: 'I' },
  { id: 'gym-shoulders-dumbbell-front-raise', name: 'Dumbbell front raise', library: 'gym', category: 'Shoulders', equipment: 'Dumbbells', targets: 'Front delts', level: 'B' },
  { id: 'gym-shoulders-plate-front-raise', name: 'Plate front raise', library: 'gym', category: 'Shoulders', equipment: 'Plate', targets: 'Front delts', level: 'B' },
  { id: 'gym-shoulders-bent-over-dumbbell-reverse-fly', name: 'Bent-over dumbbell reverse fly', library: 'gym', category: 'Shoulders', equipment: 'Dumbbells', targets: 'Rear delts', level: 'B' },
  { id: 'gym-shoulders-upright-row-wide-grip', name: 'Upright row (wide grip)', library: 'gym', category: 'Shoulders', equipment: 'Barbell or cable', targets: 'Side delts, traps', level: 'I' },
  { id: 'gym-shoulders-cable-external-rotation', name: 'Cable external rotation', library: 'gym', category: 'Shoulders', equipment: 'Cable', targets: 'Rotator cuff', level: 'B' },
  { id: 'gym-shoulders-dumbbell-external-rotation', name: 'Dumbbell external rotation', library: 'gym', category: 'Shoulders', equipment: 'Light dumbbell', targets: 'Rotator cuff', level: 'B' },
  { id: 'gym-shoulders-y-raise', name: 'Y-raise', library: 'gym', category: 'Shoulders', equipment: 'Cable or light DB', targets: 'Lower traps, rear delts', level: 'B' },
  { id: 'gym-shoulders-face-pull-to-external-rotation', name: 'Face pull to external rotation', library: 'gym', category: 'Shoulders', equipment: 'Cable, rope', targets: 'Rear delts, cuff', level: 'B' },
  { id: 'gym-biceps-barbell-curl', name: 'Barbell curl', library: 'gym', category: 'Biceps', equipment: 'Barbell', targets: 'Biceps', level: 'B' },
  { id: 'gym-biceps-ez-bar-curl', name: 'EZ-bar curl', library: 'gym', category: 'Biceps', equipment: 'EZ-bar', targets: 'Biceps', level: 'B' },
  { id: 'gym-biceps-standing-dumbbell-curl', name: 'Standing dumbbell curl', library: 'gym', category: 'Biceps', equipment: 'Dumbbells', targets: 'Biceps', level: 'B' },
  { id: 'gym-biceps-incline-dumbbell-curl', name: 'Incline dumbbell curl', library: 'gym', category: 'Biceps', equipment: 'Dumbbells, incline bench', targets: 'Biceps long head', level: 'I' },
  { id: 'gym-biceps-preacher-curl', name: 'Preacher curl', library: 'gym', category: 'Biceps', equipment: 'EZ-bar, preacher bench', targets: 'Biceps short head', level: 'B' },
  { id: 'gym-biceps-machine-preacher-curl', name: 'Machine preacher curl', library: 'gym', category: 'Biceps', equipment: 'Machine', targets: 'Biceps', level: 'B' },
  { id: 'gym-biceps-spider-curl', name: 'Spider curl', library: 'gym', category: 'Biceps', equipment: 'Dumbbells, incline bench', targets: 'Biceps short head', level: 'I' },
  { id: 'gym-biceps-bayesian-cable-curl', name: 'Bayesian cable curl', library: 'gym', category: 'Biceps', equipment: 'Cable', targets: 'Biceps, stretch position', level: 'I' },
  { id: 'gym-biceps-cable-curl', name: 'Cable curl', library: 'gym', category: 'Biceps', equipment: 'Cable', targets: 'Biceps', level: 'B' },
  { id: 'gym-biceps-hammer-curl', name: 'Hammer curl', library: 'gym', category: 'Biceps', equipment: 'Dumbbells', targets: 'Brachialis, forearms', level: 'B' },
  { id: 'gym-biceps-cross-body-hammer-curl', name: 'Cross-body hammer curl', library: 'gym', category: 'Biceps', equipment: 'Dumbbells', targets: 'Brachialis', level: 'B' },
  { id: 'gym-biceps-concentration-curl', name: 'Concentration curl', library: 'gym', category: 'Biceps', equipment: 'Dumbbell', targets: 'Biceps peak', level: 'B' },
  { id: 'gym-biceps-pronated-supinated-curl', name: 'Pronated / supinated curl', library: 'gym', category: 'Biceps', equipment: 'Dumbbells', targets: 'Biceps, forearms', level: 'I' },
  { id: 'gym-biceps-reverse-curl', name: 'Reverse curl', library: 'gym', category: 'Biceps', equipment: 'EZ-bar', targets: 'Brachioradialis, forearms', level: 'B' },
  { id: 'gym-biceps-zottman-curl', name: 'Zottman curl', library: 'gym', category: 'Biceps', equipment: 'Dumbbells', targets: 'Biceps and forearms', level: 'I' },
  { id: 'gym-biceps-waiter-curl', name: 'Waiter curl', library: 'gym', category: 'Biceps', equipment: 'Dumbbell', targets: 'Biceps peak', level: 'I' },
  { id: 'gym-triceps-close-grip-bench-press', name: 'Close-grip bench press', library: 'gym', category: 'Triceps', equipment: 'Barbell', targets: 'Triceps, chest', level: 'I' },
  { id: 'gym-triceps-cable-pushdown-rope', name: 'Cable pushdown (rope)', library: 'gym', category: 'Triceps', equipment: 'Cable', targets: 'Lateral and medial head', level: 'B' },
  { id: 'gym-triceps-cable-pushdown-straight-bar', name: 'Cable pushdown (straight bar)', library: 'gym', category: 'Triceps', equipment: 'Cable', targets: 'Triceps', level: 'B' },
  { id: 'gym-triceps-single-arm-cable-pushdown', name: 'Single-arm cable pushdown', library: 'gym', category: 'Triceps', equipment: 'Cable', targets: 'Triceps', level: 'B' },
  { id: 'gym-triceps-overhead-cable-triceps-extension', name: 'Overhead cable triceps extension', library: 'gym', category: 'Triceps', equipment: 'Cable, rope', targets: 'Long head', level: 'I' },
  { id: 'gym-triceps-overhead-dumbbell-extension', name: 'Overhead dumbbell extension', library: 'gym', category: 'Triceps', equipment: 'Dumbbell', targets: 'Long head', level: 'B' },
  { id: 'gym-triceps-skullcrusher-ez-bar', name: 'Skullcrusher (EZ-bar)', library: 'gym', category: 'Triceps', equipment: 'EZ-bar, bench', targets: 'Long and lateral head', level: 'I' },
  { id: 'gym-triceps-dumbbell-skullcrusher', name: 'Dumbbell skullcrusher', library: 'gym', category: 'Triceps', equipment: 'Dumbbells', targets: 'Triceps', level: 'I' },
  { id: 'gym-triceps-jm-press', name: 'JM press', library: 'gym', category: 'Triceps', equipment: 'Barbell or Smith', targets: 'Triceps', level: 'A' },
  { id: 'gym-triceps-triceps-dip-upright-torso', name: 'Triceps dip (upright torso)', library: 'gym', category: 'Triceps', equipment: 'Dip station', targets: 'Triceps', level: 'I' },
  { id: 'gym-triceps-bench-dip', name: 'Bench dip', library: 'gym', category: 'Triceps', equipment: 'Bench', targets: 'Triceps', level: 'B' },
  { id: 'gym-triceps-machine-triceps-extension', name: 'Machine triceps extension', library: 'gym', category: 'Triceps', equipment: 'Machine', targets: 'Triceps', level: 'B' },
  { id: 'gym-triceps-triceps-kickback', name: 'Triceps kickback', library: 'gym', category: 'Triceps', equipment: 'Dumbbell or cable', targets: 'Lateral head', level: 'B' },
  { id: 'gym-triceps-diamond-push-up', name: 'Diamond push-up', library: 'gym', category: 'Triceps', equipment: 'Floor', targets: 'Triceps, inner chest', level: 'B' },
  { id: 'gym-forearms-and-grip-wrist-curl', name: 'Wrist curl', library: 'gym', category: 'Forearms and grip', equipment: 'Barbell or DB', targets: 'Forearm flexors', level: 'B' },
  { id: 'gym-forearms-and-grip-reverse-wrist-curl', name: 'Reverse wrist curl', library: 'gym', category: 'Forearms and grip', equipment: 'Barbell or DB', targets: 'Forearm extensors', level: 'B' },
  { id: 'gym-forearms-and-grip-farmer-s-carry', name: 'Farmer\'s carry', library: 'gym', category: 'Forearms and grip', equipment: 'Dumbbells or trap bar', targets: 'Grip, traps, core', level: 'B' },
  { id: 'gym-forearms-and-grip-dead-hang', name: 'Dead hang', library: 'gym', category: 'Forearms and grip', equipment: 'Bar', targets: 'Grip, shoulder decompression', level: 'B' },
  { id: 'gym-forearms-and-grip-plate-pinch', name: 'Plate pinch', library: 'gym', category: 'Forearms and grip', equipment: 'Plates', targets: 'Pinch grip', level: 'B' },
  { id: 'gym-quads-high-bar-back-squat', name: 'High-bar back squat', library: 'gym', category: 'Quads', equipment: 'Barbell, rack', targets: 'Quads, glutes', level: 'I' },
  { id: 'gym-quads-low-bar-back-squat', name: 'Low-bar back squat', library: 'gym', category: 'Quads', equipment: 'Barbell, rack', targets: 'Glutes, hamstrings, quads', level: 'I' },
  { id: 'gym-quads-front-squat', name: 'Front squat', library: 'gym', category: 'Quads', equipment: 'Barbell, rack', targets: 'Quads, upper back', level: 'A' },
  { id: 'gym-quads-pause-squat', name: 'Pause squat', library: 'gym', category: 'Quads', equipment: 'Barbell, rack', targets: 'Quads, strength out of the hole', level: 'I' },
  { id: 'gym-quads-box-squat', name: 'Box squat', library: 'gym', category: 'Quads', equipment: 'Barbell, box', targets: 'Glutes, hamstrings', level: 'I' },
  { id: 'gym-quads-goblet-squat', name: 'Goblet squat', library: 'gym', category: 'Quads', equipment: 'Dumbbell or KB', targets: 'Quads, core', level: 'B' },
  { id: 'gym-quads-safety-bar-squat', name: 'Safety-bar squat', library: 'gym', category: 'Quads', equipment: 'Safety squat bar', targets: 'Quads, upper-back friendly', level: 'I' },
  { id: 'gym-quads-smith-machine-squat', name: 'Smith machine squat', library: 'gym', category: 'Quads', equipment: 'Smith machine', targets: 'Quads', level: 'B' },
  { id: 'gym-quads-hack-squat', name: 'Hack squat', library: 'gym', category: 'Quads', equipment: 'Hack squat machine', targets: 'Quads', level: 'B' },
  { id: 'gym-quads-pendulum-squat', name: 'Pendulum squat', library: 'gym', category: 'Quads', equipment: 'Pendulum machine', targets: 'Quads', level: 'I' },
  { id: 'gym-quads-leg-press-feet-low', name: 'Leg press (feet low)', library: 'gym', category: 'Quads', equipment: 'Leg press', targets: 'Quads', level: 'B' },
  { id: 'gym-quads-leg-press-feet-high-and-wide', name: 'Leg press (feet high and wide)', library: 'gym', category: 'Quads', equipment: 'Leg press', targets: 'Glutes, hamstrings', level: 'B' },
  { id: 'gym-quads-leg-extension', name: 'Leg extension', library: 'gym', category: 'Quads', equipment: 'Machine', targets: 'Quads (rectus femoris)', level: 'B' },
  { id: 'gym-quads-bulgarian-split-squat', name: 'Bulgarian split squat', library: 'gym', category: 'Quads', equipment: 'DB, bench', targets: 'Quads, glutes', level: 'I' },
  { id: 'gym-quads-walking-lunge', name: 'Walking lunge', library: 'gym', category: 'Quads', equipment: 'Dumbbells', targets: 'Quads, glutes', level: 'B' },
  { id: 'gym-quads-reverse-lunge', name: 'Reverse lunge', library: 'gym', category: 'Quads', equipment: 'Dumbbells or barbell', targets: 'Quads, glutes, knee-friendly', level: 'B' },
  { id: 'gym-quads-step-up', name: 'Step-up', library: 'gym', category: 'Quads', equipment: 'Dumbbells, box', targets: 'Quads, glutes', level: 'B' },
  { id: 'gym-quads-sissy-squat', name: 'Sissy squat', library: 'gym', category: 'Quads', equipment: 'Bodyweight or machine', targets: 'Quads isolation', level: 'A' },
  { id: 'gym-quads-heel-elevated-squat', name: 'Heel-elevated squat', library: 'gym', category: 'Quads', equipment: 'Plates or wedge, barbell', targets: 'Quads', level: 'I' },
  { id: 'gym-hamstrings-and-glutes-romanian-deadlift-rdl', name: 'Romanian deadlift (RDL)', library: 'gym', category: 'Hamstrings and glutes', equipment: 'Barbell or DB', targets: 'Hamstrings, glutes', level: 'B' },
  { id: 'gym-hamstrings-and-glutes-stiff-leg-deadlift', name: 'Stiff-leg deadlift', library: 'gym', category: 'Hamstrings and glutes', equipment: 'Barbell', targets: 'Hamstrings', level: 'I' },
  { id: 'gym-hamstrings-and-glutes-sumo-deadlift', name: 'Sumo deadlift', library: 'gym', category: 'Hamstrings and glutes', equipment: 'Barbell', targets: 'Glutes, adductors, quads', level: 'I' },
  { id: 'gym-hamstrings-and-glutes-trap-bar-deadlift', name: 'Trap-bar deadlift', library: 'gym', category: 'Hamstrings and glutes', equipment: 'Trap bar', targets: 'Quads, glutes, back', level: 'B' },
  { id: 'gym-hamstrings-and-glutes-good-morning', name: 'Good morning', library: 'gym', category: 'Hamstrings and glutes', equipment: 'Barbell', targets: 'Hamstrings, lower back', level: 'A' },
  { id: 'gym-hamstrings-and-glutes-seated-leg-curl', name: 'Seated leg curl', library: 'gym', category: 'Hamstrings and glutes', equipment: 'Machine', targets: 'Hamstrings (stretched position)', level: 'B' },
  { id: 'gym-hamstrings-and-glutes-lying-leg-curl', name: 'Lying leg curl', library: 'gym', category: 'Hamstrings and glutes', equipment: 'Machine', targets: 'Hamstrings', level: 'B' },
  { id: 'gym-hamstrings-and-glutes-standing-single-leg-curl', name: 'Standing single-leg curl', library: 'gym', category: 'Hamstrings and glutes', equipment: 'Machine', targets: 'Hamstrings', level: 'B' },
  { id: 'gym-hamstrings-and-glutes-nordic-hamstring-curl', name: 'Nordic hamstring curl', library: 'gym', category: 'Hamstrings and glutes', equipment: 'Bench or partner', targets: 'Hamstrings (eccentric)', level: 'A' },
  { id: 'gym-hamstrings-and-glutes-glute-ham-raise', name: 'Glute-ham raise', library: 'gym', category: 'Hamstrings and glutes', equipment: 'GHD', targets: 'Hamstrings, glutes', level: 'A' },
  { id: 'gym-hamstrings-and-glutes-barbell-hip-thrust', name: 'Barbell hip thrust', library: 'gym', category: 'Hamstrings and glutes', equipment: 'Barbell, bench', targets: 'Glutes', level: 'I' },
  { id: 'gym-hamstrings-and-glutes-smith-machine-hip-thrust', name: 'Smith machine hip thrust', library: 'gym', category: 'Hamstrings and glutes', equipment: 'Smith machine', targets: 'Glutes', level: 'B' },
  { id: 'gym-hamstrings-and-glutes-machine-hip-thrust', name: 'Machine hip thrust', library: 'gym', category: 'Hamstrings and glutes', equipment: 'Hip thrust machine', targets: 'Glutes', level: 'B' },
  { id: 'gym-hamstrings-and-glutes-glute-bridge', name: 'Glute bridge', library: 'gym', category: 'Hamstrings and glutes', equipment: 'Barbell or bodyweight', targets: 'Glutes', level: 'B' },
  { id: 'gym-hamstrings-and-glutes-single-leg-hip-thrust', name: 'Single-leg hip thrust', library: 'gym', category: 'Hamstrings and glutes', equipment: 'Bench', targets: 'Glutes', level: 'I' },
  { id: 'gym-hamstrings-and-glutes-cable-pull-through', name: 'Cable pull-through', library: 'gym', category: 'Hamstrings and glutes', equipment: 'Cable, rope', targets: 'Glutes, hamstrings', level: 'B' },
  { id: 'gym-hamstrings-and-glutes-cable-kickback', name: 'Cable kickback', library: 'gym', category: 'Hamstrings and glutes', equipment: 'Cable, ankle strap', targets: 'Glutes', level: 'B' },
  { id: 'gym-hamstrings-and-glutes-hip-abduction-machine', name: 'Hip abduction machine', library: 'gym', category: 'Hamstrings and glutes', equipment: 'Machine', targets: 'Glute medius', level: 'B' },
  { id: 'gym-hamstrings-and-glutes-hip-adduction-machine', name: 'Hip adduction machine', library: 'gym', category: 'Hamstrings and glutes', equipment: 'Machine', targets: 'Adductors', level: 'B' },
  { id: 'gym-hamstrings-and-glutes-curtsy-lunge', name: 'Curtsy lunge', library: 'gym', category: 'Hamstrings and glutes', equipment: 'Dumbbells', targets: 'Glute medius, quads', level: 'I' },
  { id: 'gym-hamstrings-and-glutes-kettlebell-swing', name: 'Kettlebell swing', library: 'gym', category: 'Hamstrings and glutes', equipment: 'Kettlebell', targets: 'Glutes, hamstrings, conditioning', level: 'I' },
  { id: 'gym-hamstrings-and-glutes-45-degree-back-extension-glute-focus', name: '45-degree back extension (glute focus)', library: 'gym', category: 'Hamstrings and glutes', equipment: 'Hyperextension bench', targets: 'Glutes, hamstrings', level: 'B' },
  { id: 'gym-calves-standing-calf-raise', name: 'Standing calf raise', library: 'gym', category: 'Calves', equipment: 'Machine or Smith', targets: 'Gastrocnemius', level: 'B' },
  { id: 'gym-calves-seated-calf-raise', name: 'Seated calf raise', library: 'gym', category: 'Calves', equipment: 'Machine', targets: 'Soleus', level: 'B' },
  { id: 'gym-calves-leg-press-calf-raise', name: 'Leg-press calf raise', library: 'gym', category: 'Calves', equipment: 'Leg press', targets: 'Calves', level: 'B' },
  { id: 'gym-calves-single-leg-calf-raise-deficit', name: 'Single-leg calf raise (deficit)', library: 'gym', category: 'Calves', equipment: 'Step, dumbbell', targets: 'Calves, big stretch', level: 'I' },
  { id: 'gym-calves-donkey-calf-raise', name: 'Donkey calf raise', library: 'gym', category: 'Calves', equipment: 'Machine or partner', targets: 'Gastrocnemius', level: 'I' },
  { id: 'gym-calves-tibialis-raise', name: 'Tibialis raise', library: 'gym', category: 'Calves', equipment: 'Bar or wall', targets: 'Shins', level: 'B' },
  { id: 'gym-core-cable-crunch', name: 'Cable crunch', library: 'gym', category: 'Core', equipment: 'Cable, rope', targets: 'Rectus abdominis', level: 'B' },
  { id: 'gym-core-hanging-knee-raise', name: 'Hanging knee raise', library: 'gym', category: 'Core', equipment: 'Pull-up bar', targets: 'Lower abs, hip flexors', level: 'B' },
  { id: 'gym-core-hanging-leg-raise', name: 'Hanging leg raise', library: 'gym', category: 'Core', equipment: 'Pull-up bar', targets: 'Lower abs', level: 'I' },
  { id: 'gym-core-toes-to-bar', name: 'Toes-to-bar', library: 'gym', category: 'Core', equipment: 'Pull-up bar', targets: 'Abs, grip', level: 'A' },
  { id: 'gym-core-ab-wheel-rollout', name: 'Ab wheel rollout', library: 'gym', category: 'Core', equipment: 'Ab wheel', targets: 'Abs, anti-extension', level: 'I' },
  { id: 'gym-core-decline-sit-up', name: 'Decline sit-up', library: 'gym', category: 'Core', equipment: 'Decline bench', targets: 'Abs', level: 'B' },
  { id: 'gym-core-decline-crunch-weighted', name: 'Decline crunch (weighted)', library: 'gym', category: 'Core', equipment: 'Decline bench', targets: 'Abs', level: 'B' },
  { id: 'gym-core-long-lever-plank', name: 'Long-lever plank', library: 'gym', category: 'Core', equipment: 'Floor', targets: 'Abs, anti-extension', level: 'B' },
  { id: 'gym-core-pallof-press', name: 'Pallof press', library: 'gym', category: 'Core', equipment: 'Cable or band', targets: 'Obliques, anti-rotation', level: 'B' },
  { id: 'gym-core-cable-woodchop', name: 'Cable woodchop', library: 'gym', category: 'Core', equipment: 'Cable', targets: 'Obliques', level: 'B' },
  { id: 'gym-core-suitcase-carry', name: 'Suitcase carry', library: 'gym', category: 'Core', equipment: 'Dumbbell or KB', targets: 'Obliques, grip', level: 'B' },
  { id: 'gym-core-machine-crunch', name: 'Machine crunch', library: 'gym', category: 'Core', equipment: 'Ab machine', targets: 'Abs', level: 'B' },
  { id: 'gym-core-captain-s-chair-leg-raise', name: 'Captain\'s chair leg raise', library: 'gym', category: 'Core', equipment: 'Vertical knee raise station', targets: 'Abs', level: 'B' },
  { id: 'gym-core-landmine-rotation', name: 'Landmine rotation', library: 'gym', category: 'Core', equipment: 'Landmine', targets: 'Obliques', level: 'I' },
  { id: 'gym-core-dragon-flag', name: 'Dragon flag', library: 'gym', category: 'Core', equipment: 'Bench', targets: 'Abs, full core', level: 'A' },
  { id: 'home-push-wall-push-up', name: 'Wall push-up', library: 'home', category: 'Push', targets: 'Chest, triceps', level: 'B', easier: 'Stand farther from wall', harder: 'Incline push-up' },
  { id: 'home-push-incline-push-up-hands-on-couch-or-counter', name: 'Incline push-up (hands on couch or counter)', library: 'home', category: 'Push', targets: 'Chest, triceps', level: 'B', easier: 'Higher surface', harder: 'Standard push-up' },
  { id: 'home-push-knee-push-up', name: 'Knee push-up', library: 'home', category: 'Push', targets: 'Chest, triceps', level: 'B', easier: 'Incline', harder: 'Standard push-up' },
  { id: 'home-push-standard-push-up', name: 'Standard push-up', library: 'home', category: 'Push', targets: 'Chest, triceps, front delts', level: 'B', easier: 'Knee', harder: 'Decline' },
  { id: 'home-push-wide-push-up', name: 'Wide push-up', library: 'home', category: 'Push', targets: 'Chest', level: 'B', easier: 'Knee', harder: 'Archer' },
  { id: 'home-push-decline-push-up-feet-up', name: 'Decline push-up (feet up)', library: 'home', category: 'Push', targets: 'Upper chest, shoulders', level: 'I', easier: 'Standard', harder: 'Pseudo-planche' },
  { id: 'home-push-pike-push-up', name: 'Pike push-up', library: 'home', category: 'Push', targets: 'Shoulders', level: 'I', easier: 'Hands on a ledge', harder: 'Elevated-feet pike' },
  { id: 'home-push-handstand-push-up-wall', name: 'Handstand push-up (wall)', library: 'home', category: 'Push', targets: 'Shoulders, triceps', level: 'A', easier: 'Pike elevated', harder: 'Deficit' },
  { id: 'home-push-archer-push-up', name: 'Archer push-up', library: 'home', category: 'Push', targets: 'Chest, one-sided load', level: 'A', easier: 'Wide push-up', harder: 'One-arm' },
  { id: 'home-push-pseudo-planche-push-up', name: 'Pseudo-planche push-up', library: 'home', category: 'Push', targets: 'Front delts, chest', level: 'A', easier: 'Incline', harder: 'Planche lean' },
  { id: 'home-push-explosive-clap-push-up', name: 'Explosive (clap) push-up', library: 'home', category: 'Push', targets: 'Power', level: 'A', easier: 'Hands-off push-up', harder: 'Clap behind back' },
  { id: 'home-push-one-arm-push-up', name: 'One-arm push-up', library: 'home', category: 'Push', targets: 'Chest, core', level: 'A', easier: 'Elevated', harder: 'Floor, narrow feet' },
  { id: 'home-push-chair-or-bench-dip', name: 'Chair or bench dip', library: 'home', category: 'Push', targets: 'Triceps', level: 'B', easier: 'Knees bent', harder: 'Feet elevated' },
  { id: 'home-push-parallel-bar-or-counter-dip', name: 'Parallel-bar or counter dip', library: 'home', category: 'Push', targets: 'Chest, triceps', level: 'I', easier: 'Assisted', harder: 'Weighted' },
  { id: 'home-push-bear-crawl-push-up', name: 'Bear crawl push-up', library: 'home', category: 'Push', targets: 'Chest, core', level: 'I', easier: 'Standard', harder: 'Slow tempo' },
  { id: 'home-push-spiderman-push-up', name: 'Spiderman push-up', library: 'home', category: 'Push', targets: 'Chest, obliques', level: 'I', easier: 'Standard', harder: 'Decline' },
  { id: 'home-push-hindu-push-up', name: 'Hindu push-up', library: 'home', category: 'Push', targets: 'Shoulders, chest, mobility', level: 'I', easier: 'Pike', harder: 'Dive-bomber' },
  { id: 'home-pull-scapular-pull-up', name: 'Scapular pull-up', library: 'home', category: 'Pull', equipment: 'Pull-up bar', targets: 'Lower traps, lats', level: 'B' },
  { id: 'home-pull-negative-pull-up-5-sec-down', name: 'Negative pull-up (5 sec down)', library: 'home', category: 'Pull', equipment: 'Pull-up bar', targets: 'Lats, biceps', level: 'B' },
  { id: 'home-pull-band-assisted-pull-up', name: 'Band-assisted pull-up', library: 'home', category: 'Pull', equipment: 'Bar, band', targets: 'Lats, biceps', level: 'B' },
  { id: 'home-pull-commando-pull-up', name: 'Commando pull-up', library: 'home', category: 'Pull', equipment: 'Pull-up bar', targets: 'Lats, obliques', level: 'I' },
  { id: 'home-pull-archer-pull-up', name: 'Archer pull-up', library: 'home', category: 'Pull', equipment: 'Pull-up bar', targets: 'Lats, one-sided load', level: 'A' },
  { id: 'home-pull-l-sit-pull-up', name: 'L-sit pull-up', library: 'home', category: 'Pull', equipment: 'Pull-up bar', targets: 'Lats, core', level: 'A' },
  { id: 'home-pull-muscle-up', name: 'Muscle-up', library: 'home', category: 'Pull', equipment: 'Pull-up bar', targets: 'Lats, chest, triceps', level: 'A' },
  { id: 'home-pull-australian-row-table-row', name: 'Australian row (table row)', library: 'home', category: 'Pull', equipment: 'Sturdy table or low bar', targets: 'Mid back', level: 'B' },
  { id: 'home-pull-feet-elevated-inverted-row', name: 'Feet-elevated inverted row', library: 'home', category: 'Pull', equipment: 'Table or bar', targets: 'Mid back', level: 'I' },
  { id: 'home-pull-towel-row-door', name: 'Towel row (door)', library: 'home', category: 'Pull', equipment: 'Towel, door', targets: 'Back, grip', level: 'B' },
  { id: 'home-pull-superman', name: 'Superman', library: 'home', category: 'Pull', equipment: 'None', targets: 'Lower back, glutes', level: 'B' },
  { id: 'home-pull-reverse-snow-angel', name: 'Reverse snow angel', library: 'home', category: 'Pull', equipment: 'None', targets: 'Rear delts, traps', level: 'B' },
  { id: 'home-pull-prone-y-t-w-raise', name: 'Prone Y-T-W raise', library: 'home', category: 'Pull', equipment: 'None', targets: 'Rear delts, lower traps', level: 'B' },
  { id: 'home-pull-bodyweight-bicep-curl-under-a-table', name: 'Bodyweight bicep curl (under a table)', library: 'home', category: 'Pull', equipment: 'Sturdy table', targets: 'Biceps', level: 'I' },
  { id: 'home-legs-and-glutes-bodyweight-squat', name: 'Bodyweight squat', library: 'home', category: 'Legs and glutes', targets: 'Quads, glutes', level: 'B', easier: 'Box squat', harder: 'Pause squat' },
  { id: 'home-legs-and-glutes-sit-to-stand-chair', name: 'Sit-to-stand (chair)', library: 'home', category: 'Legs and glutes', targets: 'Quads, glutes', level: 'B', easier: 'Higher chair', harder: 'Single leg' },
  { id: 'home-legs-and-glutes-tempo-squat-3-sec-down', name: 'Tempo squat (3 sec down)', library: 'home', category: 'Legs and glutes', targets: 'Quads', level: 'B', easier: 'Bodyweight', harder: 'Pause tempo' },
  { id: 'home-legs-and-glutes-jump-squat', name: 'Jump squat', library: 'home', category: 'Legs and glutes', targets: 'Power, quads', level: 'I', easier: 'Squat', harder: 'Tuck jump' },
  { id: 'home-legs-and-glutes-split-squat', name: 'Split squat', library: 'home', category: 'Legs and glutes', targets: 'Quads, glutes', level: 'B', easier: 'Hold support', harder: 'Bulgarian' },
  { id: 'home-legs-and-glutes-lateral-lunge', name: 'Lateral lunge', library: 'home', category: 'Legs and glutes', targets: 'Adductors, glutes', level: 'B', easier: 'Shallow', harder: 'Cossack squat' },
  { id: 'home-legs-and-glutes-cossack-squat', name: 'Cossack squat', library: 'home', category: 'Legs and glutes', targets: 'Adductors, glutes', level: 'I', easier: 'Lateral lunge', harder: 'Weighted' },
  { id: 'home-legs-and-glutes-step-up-stairs-or-chair', name: 'Step-up (stairs or chair)', library: 'home', category: 'Legs and glutes', targets: 'Quads, glutes', level: 'B', easier: 'Low step', harder: 'High step' },
  { id: 'home-legs-and-glutes-single-leg-box-squat-to-chair', name: 'Single-leg box squat (to chair)', library: 'home', category: 'Legs and glutes', targets: 'Quads, glutes', level: 'I', easier: 'Two legs', harder: 'Pistol squat' },
  { id: 'home-legs-and-glutes-pistol-squat', name: 'Pistol squat', library: 'home', category: 'Legs and glutes', targets: 'Quads, balance', level: 'A', easier: 'Box pistol', harder: 'Weighted' },
  { id: 'home-legs-and-glutes-shrimp-squat', name: 'Shrimp squat', library: 'home', category: 'Legs and glutes', targets: 'Quads', level: 'A', easier: 'Assisted', harder: 'Full' },
  { id: 'home-legs-and-glutes-wall-sit', name: 'Wall sit', library: 'home', category: 'Legs and glutes', targets: 'Quads endurance', level: 'B', easier: '30 sec', harder: '90 sec' },
  { id: 'home-legs-and-glutes-single-leg-glute-bridge', name: 'Single-leg glute bridge', library: 'home', category: 'Legs and glutes', targets: 'Glutes', level: 'B', easier: 'Glute bridge', harder: 'Feet-elevated' },
  { id: 'home-legs-and-glutes-hip-thrust-couch', name: 'Hip thrust (couch)', library: 'home', category: 'Legs and glutes', targets: 'Glutes', level: 'B', easier: 'Bridge', harder: 'Single leg' },
  { id: 'home-legs-and-glutes-frog-pump', name: 'Frog pump', library: 'home', category: 'Legs and glutes', targets: 'Glutes', level: 'B', easier: 'None', harder: 'Slow tempo' },
  { id: 'home-legs-and-glutes-donkey-kick', name: 'Donkey kick', library: 'home', category: 'Legs and glutes', targets: 'Glutes', level: 'B', easier: 'None', harder: 'Resistance band' },
  { id: 'home-legs-and-glutes-fire-hydrant', name: 'Fire hydrant', library: 'home', category: 'Legs and glutes', targets: 'Glute medius', level: 'B', easier: 'None', harder: 'Band' },
  { id: 'home-legs-and-glutes-single-leg-romanian-deadlift', name: 'Single-leg Romanian deadlift', library: 'home', category: 'Legs and glutes', targets: 'Hamstrings, balance', level: 'I', easier: 'Support hand', harder: 'Weighted' },
  { id: 'home-legs-and-glutes-hamstring-walkout', name: 'Hamstring walkout', library: 'home', category: 'Legs and glutes', targets: 'Hamstrings', level: 'I', easier: 'Short range', harder: 'Full' },
  { id: 'home-legs-and-glutes-slider-or-towel-leg-curl', name: 'Slider or towel leg curl', library: 'home', category: 'Legs and glutes', targets: 'Hamstrings', level: 'I', easier: 'Bridge', harder: 'Single leg' },
  { id: 'home-legs-and-glutes-nordic-curl-anchored', name: 'Nordic curl (anchored)', library: 'home', category: 'Legs and glutes', targets: 'Hamstrings', level: 'A', easier: 'Band-assisted', harder: 'Full' },
  { id: 'home-legs-and-glutes-single-leg-calf-raise-stairs', name: 'Single-leg calf raise (stairs)', library: 'home', category: 'Legs and glutes', targets: 'Calves', level: 'B', easier: 'Two legs', harder: 'Slow 3 sec' },
  { id: 'home-legs-and-glutes-skater-hop', name: 'Skater hop', library: 'home', category: 'Legs and glutes', targets: 'Glutes, power', level: 'I', easier: 'Lateral step', harder: 'Hold landing' },
  { id: 'home-legs-and-glutes-broad-jump', name: 'Broad jump', library: 'home', category: 'Legs and glutes', targets: 'Power', level: 'I', easier: 'Squat jump', harder: 'Triple jump' },
  { id: 'home-core-plank-forearm', name: 'Plank (forearm)', library: 'home', category: 'Core', targets: 'Abs, anti-extension', level: 'B' },
  { id: 'home-core-side-plank', name: 'Side plank', library: 'home', category: 'Core', targets: 'Obliques', level: 'B' },
  { id: 'home-core-side-plank-with-hip-dip', name: 'Side plank with hip dip', library: 'home', category: 'Core', targets: 'Obliques', level: 'I' },
  { id: 'home-core-dead-bug', name: 'Dead bug', library: 'home', category: 'Core', targets: 'Deep core', level: 'B' },
  { id: 'home-core-bird-dog', name: 'Bird dog', library: 'home', category: 'Core', targets: 'Core, glutes, lower back', level: 'B' },
  { id: 'home-core-hollow-body-hold', name: 'Hollow-body hold', library: 'home', category: 'Core', targets: 'Abs', level: 'I' },
  { id: 'home-core-hollow-rock', name: 'Hollow rock', library: 'home', category: 'Core', targets: 'Abs', level: 'I' },
  { id: 'home-core-crunch', name: 'Crunch', library: 'home', category: 'Core', targets: 'Upper abs', level: 'B' },
  { id: 'home-core-reverse-crunch', name: 'Reverse crunch', library: 'home', category: 'Core', targets: 'Lower abs', level: 'B' },
  { id: 'home-core-bicycle-crunch', name: 'Bicycle crunch', library: 'home', category: 'Core', targets: 'Abs, obliques', level: 'B' },
  { id: 'home-core-russian-twist', name: 'Russian twist', library: 'home', category: 'Core', targets: 'Obliques', level: 'B' },
  { id: 'home-core-leg-raise', name: 'Leg raise', library: 'home', category: 'Core', targets: 'Lower abs', level: 'B' },
  { id: 'home-core-flutter-kick', name: 'Flutter kick', library: 'home', category: 'Core', targets: 'Lower abs', level: 'B' },
  { id: 'home-core-scissor-kick', name: 'Scissor kick', library: 'home', category: 'Core', targets: 'Lower abs', level: 'B' },
  { id: 'home-core-v-up', name: 'V-up', library: 'home', category: 'Core', targets: 'Abs', level: 'I' },
  { id: 'home-core-toe-touch-lying', name: 'Toe touch (lying)', library: 'home', category: 'Core', targets: 'Upper abs', level: 'B' },
  { id: 'home-core-mountain-climber', name: 'Mountain climber', library: 'home', category: 'Core', targets: 'Abs, conditioning', level: 'B' },
  { id: 'home-core-plank-shoulder-tap', name: 'Plank shoulder tap', library: 'home', category: 'Core', targets: 'Anti-rotation', level: 'B' },
  { id: 'home-core-body-saw-on-sliders-or-towel', name: 'Body saw (on sliders or towel)', library: 'home', category: 'Core', targets: 'Abs', level: 'I' },
  { id: 'home-core-stomach-vacuum', name: 'Stomach vacuum', library: 'home', category: 'Core', targets: 'Transverse abdominis', level: 'B' },
  { id: 'home-core-sit-up', name: 'Sit-up', library: 'home', category: 'Core', targets: 'Abs, hip flexors', level: 'B' },
  { id: 'home-core-l-sit-floor-or-parallettes', name: 'L-sit (floor or parallettes)', library: 'home', category: 'Core', targets: 'Abs, triceps', level: 'A' },
  { id: 'home-core-hanging-windshield-wiper', name: 'Hanging windshield wiper', library: 'home', category: 'Core', targets: 'Obliques', level: 'A' },
  { id: 'home-cardio-and-conditioning-jumping-jack', name: 'Jumping jack', library: 'home', category: 'Cardio and conditioning', type: 'Low-impact cardio', level: 'B' },
  { id: 'home-cardio-and-conditioning-high-knees', name: 'High knees', library: 'home', category: 'Cardio and conditioning', type: 'Cardio', level: 'B' },
  { id: 'home-cardio-and-conditioning-butt-kicks', name: 'Butt kicks', library: 'home', category: 'Cardio and conditioning', type: 'Cardio', level: 'B' },
  { id: 'home-cardio-and-conditioning-burpee', name: 'Burpee', library: 'home', category: 'Cardio and conditioning', type: 'Full-body HIIT', level: 'I' },
  { id: 'home-cardio-and-conditioning-low-impact-burpee-step-back', name: 'Low-impact burpee (step back)', library: 'home', category: 'Cardio and conditioning', type: 'Full-body, joint-friendly', level: 'B' },
  { id: 'home-cardio-and-conditioning-squat-thrust', name: 'Squat thrust', library: 'home', category: 'Cardio and conditioning', type: 'Full-body HIIT', level: 'B' },
  { id: 'home-cardio-and-conditioning-skater', name: 'Skater', library: 'home', category: 'Cardio and conditioning', type: 'Lateral cardio', level: 'B' },
  { id: 'home-cardio-and-conditioning-shadow-boxing', name: 'Shadow boxing', library: 'home', category: 'Cardio and conditioning', type: 'Cardio, shoulders', level: 'B' },
  { id: 'home-cardio-and-conditioning-stair-running', name: 'Stair running', library: 'home', category: 'Cardio and conditioning', type: 'Cardio, legs', level: 'B' },
  { id: 'home-cardio-and-conditioning-jump-rope-or-imaginary-rope', name: 'Jump rope (or imaginary rope)', library: 'home', category: 'Cardio and conditioning', type: 'Cardio, calves', level: 'B' },
  { id: 'home-cardio-and-conditioning-tuck-jump', name: 'Tuck jump', library: 'home', category: 'Cardio and conditioning', type: 'Plyometric', level: 'I' },
  { id: 'home-cardio-and-conditioning-star-jump', name: 'Star jump', library: 'home', category: 'Cardio and conditioning', type: 'Plyometric', level: 'I' },
  { id: 'home-cardio-and-conditioning-plank-jack', name: 'Plank jack', library: 'home', category: 'Cardio and conditioning', type: 'Core, cardio', level: 'B' },
  { id: 'home-cardio-and-conditioning-inchworm', name: 'Inchworm', library: 'home', category: 'Cardio and conditioning', type: 'Mobility, core', level: 'B' },
  { id: 'home-cardio-and-conditioning-bear-crawl', name: 'Bear crawl', library: 'home', category: 'Cardio and conditioning', type: 'Full body', level: 'B' },
  { id: 'home-cardio-and-conditioning-crab-walk', name: 'Crab walk', library: 'home', category: 'Cardio and conditioning', type: 'Shoulders, core', level: 'B' },
  { id: 'home-mobility-and-cool-down-cat-cow', name: 'Cat-cow', library: 'home', category: 'Mobility and cool-down', targets: 'Spine', holdOrReps: '10 slow reps' },
  { id: 'home-mobility-and-cool-down-world-s-greatest-stretch', name: 'World\'s greatest stretch', library: 'home', category: 'Mobility and cool-down', targets: 'Hips, thoracic spine, hamstrings', holdOrReps: '5 E/S' },
  { id: 'home-mobility-and-cool-down-90-90-hip-switch', name: '90/90 hip switch', library: 'home', category: 'Mobility and cool-down', targets: 'Hip rotation', holdOrReps: '10 reps' },
  { id: 'home-mobility-and-cool-down-couch-stretch', name: 'Couch stretch', library: 'home', category: 'Mobility and cool-down', targets: 'Hip flexors, quads', holdOrReps: '60 sec E/S' },
  { id: 'home-mobility-and-cool-down-pigeon-pose', name: 'Pigeon pose', library: 'home', category: 'Mobility and cool-down', targets: 'Glutes', holdOrReps: '60 sec E/S' },
  { id: 'home-mobility-and-cool-down-child-s-pose', name: 'Child\'s pose', library: 'home', category: 'Mobility and cool-down', targets: 'Lats, lower back', holdOrReps: '60 sec' },
  { id: 'home-mobility-and-cool-down-thread-the-needle', name: 'Thread the needle', library: 'home', category: 'Mobility and cool-down', targets: 'Thoracic spine', holdOrReps: '8 E/S' },
  { id: 'home-mobility-and-cool-down-doorway-chest-stretch', name: 'Doorway chest stretch', library: 'home', category: 'Mobility and cool-down', targets: 'Chest', holdOrReps: '45 sec E/S' },
  { id: 'home-mobility-and-cool-down-cross-body-shoulder-stretch', name: 'Cross-body shoulder stretch', library: 'home', category: 'Mobility and cool-down', targets: 'Rear delts', holdOrReps: '30 sec E/S' },
  { id: 'home-mobility-and-cool-down-standing-hamstring-stretch', name: 'Standing hamstring stretch', library: 'home', category: 'Mobility and cool-down', targets: 'Hamstrings', holdOrReps: '45 sec E/S' },
  { id: 'home-mobility-and-cool-down-deep-squat-hold', name: 'Deep squat hold', library: 'home', category: 'Mobility and cool-down', targets: 'Hips, ankles', holdOrReps: '60 sec' },
  { id: 'home-mobility-and-cool-down-wall-slide', name: 'Wall slide', library: 'home', category: 'Mobility and cool-down', targets: 'Scapula, shoulders', holdOrReps: '10 reps' },
  { id: 'minimal-dumbbells-or-kettlebell-dumbbell-romanian-deadlift', name: 'DB Romanian deadlift', library: 'minimal', category: 'Dumbbells or kettlebell', targets: 'Hamstrings, glutes', level: 'B' },
  { id: 'minimal-dumbbells-or-kettlebell-dumbbell-bulgarian-split-squat', name: 'DB Bulgarian split squat', library: 'minimal', category: 'Dumbbells or kettlebell', targets: 'Quads, glutes', level: 'I' },
  { id: 'minimal-dumbbells-or-kettlebell-dumbbell-reverse-lunge', name: 'DB reverse lunge', library: 'minimal', category: 'Dumbbells or kettlebell', targets: 'Quads, glutes', level: 'B' },
  { id: 'minimal-dumbbells-or-kettlebell-dumbbell-step-up', name: 'DB step-up', library: 'minimal', category: 'Dumbbells or kettlebell', targets: 'Quads, glutes', level: 'B' },
  { id: 'minimal-dumbbells-or-kettlebell-dumbbell-hip-thrust-back-on-couch', name: 'DB hip thrust (back on couch)', library: 'minimal', category: 'Dumbbells or kettlebell', targets: 'Glutes', level: 'B' },
  { id: 'minimal-dumbbells-or-kettlebell-single-leg-dumbbell-rdl', name: 'Single-leg DB RDL', library: 'minimal', category: 'Dumbbells or kettlebell', targets: 'Hamstrings, balance', level: 'I' },
  { id: 'minimal-dumbbells-or-kettlebell-dumbbell-sumo-squat', name: 'DB sumo squat', library: 'minimal', category: 'Dumbbells or kettlebell', targets: 'Adductors, glutes', level: 'B' },
  { id: 'minimal-dumbbells-or-kettlebell-dumbbell-bench-or-floor-fly', name: 'DB bench or floor fly', library: 'minimal', category: 'Dumbbells or kettlebell', targets: 'Chest', level: 'B' },
  { id: 'minimal-dumbbells-or-kettlebell-dumbbell-incline-press-on-pillow-stack-or-adjustable-bench', name: 'DB incline press (on pillow-stack or adjustable bench)', library: 'minimal', category: 'Dumbbells or kettlebell', targets: 'Upper chest', level: 'B' },
  { id: 'minimal-dumbbells-or-kettlebell-chest-supported-dumbbell-row-incline', name: 'Chest-supported DB row (incline)', library: 'minimal', category: 'Dumbbells or kettlebell', targets: 'Upper back', level: 'B' },
  { id: 'minimal-dumbbells-or-kettlebell-renegade-row', name: 'Renegade row', library: 'minimal', category: 'Dumbbells or kettlebell', targets: 'Back, core', level: 'I' },
  { id: 'minimal-dumbbells-or-kettlebell-dumbbell-shoulder-press', name: 'DB shoulder press', library: 'minimal', category: 'Dumbbells or kettlebell', targets: 'Shoulders', level: 'B' },
  { id: 'minimal-dumbbells-or-kettlebell-dumbbell-arnold-press', name: 'DB Arnold press', library: 'minimal', category: 'Dumbbells or kettlebell', targets: 'Shoulders', level: 'I' },
  { id: 'minimal-dumbbells-or-kettlebell-dumbbell-rear-delt-fly', name: 'DB rear-delt fly', library: 'minimal', category: 'Dumbbells or kettlebell', targets: 'Rear delts', level: 'B' },
  { id: 'minimal-dumbbells-or-kettlebell-dumbbell-curl', name: 'DB curl', library: 'minimal', category: 'Dumbbells or kettlebell', targets: 'Biceps', level: 'B' },
  { id: 'minimal-dumbbells-or-kettlebell-dumbbell-hammer-curl', name: 'DB hammer curl', library: 'minimal', category: 'Dumbbells or kettlebell', targets: 'Biceps, forearms', level: 'B' },
  { id: 'minimal-dumbbells-or-kettlebell-dumbbell-overhead-triceps-extension', name: 'DB overhead triceps extension', library: 'minimal', category: 'Dumbbells or kettlebell', targets: 'Triceps', level: 'B' },
  { id: 'minimal-dumbbells-or-kettlebell-dumbbell-kickback', name: 'DB kickback', library: 'minimal', category: 'Dumbbells or kettlebell', targets: 'Triceps', level: 'B' },
  { id: 'minimal-dumbbells-or-kettlebell-turkish-get-up', name: 'Turkish get-up', library: 'minimal', category: 'Dumbbells or kettlebell', targets: 'Full body', level: 'A' },
  { id: 'minimal-dumbbells-or-kettlebell-dumbbell-thruster', name: 'DB thruster', library: 'minimal', category: 'Dumbbells or kettlebell', targets: 'Full-body conditioning', level: 'I' },
  { id: 'minimal-resistance-bands-banded-squat', name: 'Banded squat', library: 'minimal', category: 'Resistance bands', targets: 'Quads, glutes', level: 'B' },
  { id: 'minimal-resistance-bands-banded-glute-bridge', name: 'Banded glute bridge', library: 'minimal', category: 'Resistance bands', targets: 'Glutes', level: 'B' },
  { id: 'minimal-resistance-bands-banded-lateral-walk', name: 'Banded lateral walk', library: 'minimal', category: 'Resistance bands', targets: 'Glute medius', level: 'B' },
  { id: 'minimal-resistance-bands-banded-good-morning', name: 'Banded good morning', library: 'minimal', category: 'Resistance bands', targets: 'Hamstrings', level: 'B' },
  { id: 'minimal-resistance-bands-banded-pull-apart', name: 'Banded pull-apart', library: 'minimal', category: 'Resistance bands', targets: 'Rear delts, upper back', level: 'B' },
  { id: 'minimal-resistance-bands-banded-face-pull', name: 'Banded face pull', library: 'minimal', category: 'Resistance bands', targets: 'Rear delts, cuff', level: 'B' },
  { id: 'minimal-resistance-bands-banded-row-door-anchor', name: 'Banded row (door anchor)', library: 'minimal', category: 'Resistance bands', targets: 'Back', level: 'B' },
  { id: 'minimal-resistance-bands-banded-lat-pulldown', name: 'Banded lat pulldown', library: 'minimal', category: 'Resistance bands', targets: 'Lats', level: 'B' },
  { id: 'minimal-resistance-bands-banded-chest-press', name: 'Banded chest press', library: 'minimal', category: 'Resistance bands', targets: 'Chest', level: 'B' },
  { id: 'minimal-resistance-bands-banded-push-up-band-across-back', name: 'Banded push-up (band across back)', library: 'minimal', category: 'Resistance bands', targets: 'Chest, triceps', level: 'I' },
  { id: 'minimal-resistance-bands-banded-overhead-press', name: 'Banded overhead press', library: 'minimal', category: 'Resistance bands', targets: 'Shoulders', level: 'B' },
  { id: 'minimal-resistance-bands-banded-lateral-raise', name: 'Banded lateral raise', library: 'minimal', category: 'Resistance bands', targets: 'Side delts', level: 'B' },
  { id: 'minimal-resistance-bands-banded-biceps-curl', name: 'Banded biceps curl', library: 'minimal', category: 'Resistance bands', targets: 'Biceps', level: 'B' },
  { id: 'minimal-resistance-bands-banded-triceps-pushdown', name: 'Banded triceps pushdown', library: 'minimal', category: 'Resistance bands', targets: 'Triceps', level: 'B' },
  { id: 'minimal-resistance-bands-banded-pallof-press', name: 'Banded pallof press', library: 'minimal', category: 'Resistance bands', targets: 'Obliques', level: 'B' },
  { id: 'minimal-resistance-bands-banded-woodchop', name: 'Banded woodchop', library: 'minimal', category: 'Resistance bands', targets: 'Obliques', level: 'B' },
  { id: 'minimal-resistance-bands-banded-assisted-pull-up', name: 'Banded assisted pull-up', library: 'minimal', category: 'Resistance bands', targets: 'Lats', level: 'B' },
  { id: 'minimal-resistance-bands-banded-leg-curl-lying', name: 'Banded leg curl (lying)', library: 'minimal', category: 'Resistance bands', targets: 'Hamstrings', level: 'I' },
  { id: 'minimal-pull-up-bar-and-rings-ring-row', name: 'Ring row', library: 'minimal', category: 'Pull-up bar and rings', targets: 'Back, biceps', level: 'B' },
  { id: 'minimal-pull-up-bar-and-rings-ring-push-up', name: 'Ring push-up', library: 'minimal', category: 'Pull-up bar and rings', targets: 'Chest, stabilizers', level: 'I' },
  { id: 'minimal-pull-up-bar-and-rings-ring-dip', name: 'Ring dip', library: 'minimal', category: 'Pull-up bar and rings', targets: 'Chest, triceps', level: 'A' },
  { id: 'minimal-pull-up-bar-and-rings-hanging-knee-or-leg-raise', name: 'Hanging knee or leg raise', library: 'minimal', category: 'Pull-up bar and rings', targets: 'Abs', level: 'I' },
  { id: 'minimal-pull-up-bar-and-rings-front-lever-tuck', name: 'Front lever tuck', library: 'minimal', category: 'Pull-up bar and rings', targets: 'Lats, abs', level: 'A' },
  { id: 'minimal-pull-up-bar-and-rings-skin-the-cat', name: 'Skin the cat', library: 'minimal', category: 'Pull-up bar and rings', targets: 'Shoulder mobility, lats', level: 'A' },
];

/** The categories present in each library, in source order. */
export const CATALOG_CATEGORIES: Record<CatalogLibrary, readonly string[]> = {
  gym: [
    'Chest',
    'Back',
    'Shoulders',
    'Biceps',
    'Triceps',
    'Forearms and grip',
    'Quads',
    'Hamstrings and glutes',
    'Calves',
    'Core',
  ],
  home: ['Push', 'Pull', 'Legs and glutes', 'Core', 'Cardio and conditioning', 'Mobility and cool-down'],
  minimal: ['Dumbbells or kettlebell', 'Resistance bands', 'Pull-up bar and rings'],
};

/** Human labels for the source's single-letter level tags. */
export const LEVEL_LABELS: Record<CatalogLevel, string> = {
  B: 'Beginner',
  I: 'Intermediate',
  A: 'Advanced',
};

/**
 * Rows from the source that are deliberately not imported, recorded so the
 * omissions are auditable rather than invisible.
 *
 * The combined row is malformed — three exercises in one cell — and all three
 * already exist elsewhere in the catalog, so splitting it would have invented an
 * entry. The repeats are the same movement listed a second time under another
 * library; the first occurrence is kept.
 */
export const DROPPED_ENTRIES: readonly { name: string; reason: 'duplicate' | 'malformed' }[] = [
  { name: 'Diamond push-up', reason: 'duplicate' },
  { name: 'Dead hang', reason: 'duplicate' },
  { name: 'Pull-up', reason: 'duplicate' },
  { name: 'Chin-up', reason: 'duplicate' },
  { name: 'Bulgarian split squat', reason: 'duplicate' },
  { name: 'Reverse lunge', reason: 'duplicate' },
  { name: 'Walking lunge', reason: 'duplicate' },
  { name: 'Curtsy lunge', reason: 'duplicate' },
  { name: 'Glute bridge', reason: 'duplicate' },
  { name: 'Standing calf raise', reason: 'duplicate' },
  { name: 'Long-lever plank', reason: 'duplicate' },
  { name: 'Hanging knee raise', reason: 'duplicate' },
  { name: 'Dragon flag', reason: 'duplicate' },
  { name: 'Goblet squat', reason: 'duplicate' },
  { name: 'Floor press', reason: 'duplicate' },
  { name: 'One-arm DB row', reason: 'duplicate' },
  { name: 'DB lateral raise', reason: 'duplicate' },
  { name: 'DB shrug', reason: 'duplicate' },
  { name: 'DB pullover', reason: 'duplicate' },
  { name: 'Kettlebell swing', reason: 'duplicate' },
  { name: 'Farmer\'s carry', reason: 'duplicate' },
  { name: 'Pull-up, chin-up, neutral-grip pull-up', reason: 'malformed' },
];

const BY_ID = new Map(CATALOG.map((entry) => [entry.id, entry]));

/**
 * Normalise a typed name for comparison only — never for storage or display.
 *
 * The source writes the same implement three ways ("Dumbbell curl", "DB curl",
 * "DB hammer curl"), so "DB"/"BB"/"KB" are expanded and everything that is not a
 * letter or digit is dropped. That is what lets a custom "db curl" be recognised
 * as a collision with the catalog's "DB curl" instead of silently duplicating it.
 */
export function normalizeExerciseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bdb\b/g, 'dumbbell')
    .replace(/\bbb\b/g, 'barbell')
    .replace(/\bkb\b/g, 'kettlebell')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Look up one entry by its stable catalog id. */
export function findCatalogExercise(id: string): CatalogExercise | undefined {
  return BY_ID.get(id);
}

/**
 * Catalog entries that match `name`, used for "you already have this" checks.
 * Returns every match so a caller can show what it found rather than guessing.
 */
export function findCatalogMatchesByName(name: string): readonly CatalogExercise[] {
  const wanted = normalizeExerciseName(name);
  if (wanted === '') return [];
  return CATALOG.filter((entry) => normalizeExerciseName(entry.name) === wanted);
}

export interface CatalogQuery {
  /** Free text, matched against name, targets and category. */
  search?: string;
  library?: CatalogLibrary;
  category?: string;
  level?: CatalogLevel;
}

/**
 * Filter for the picker. Pure and synchronous: browsing reads this module, never
 * the database, so opening the picker on a fresh install costs no writes.
 */
export function filterCatalog(query: CatalogQuery = {}): readonly CatalogExercise[] {
  const search = (query.search ?? '').trim().toLowerCase();
  // Terms are normalised the same way as the haystack, so typing "db curl"
  // finds "Dumbbell curl": the abbreviation is expanded on both sides rather
  // than only in the data. Every term must match, so "dumbbell press" cannot
  // match through one stray substring.
  const terms = search === '' ? [] : search.split(/\s+/).map(normalizeExerciseName);

  return CATALOG.filter((entry) => {
    if (query.library !== undefined && entry.library !== query.library) return false;
    if (query.category !== undefined && entry.category !== query.category) return false;
    if (query.level !== undefined && entry.level !== query.level) return false;
    if (terms.length === 0) return true;

    const haystack = normalizeExerciseName(
      [entry.name, entry.targets ?? '', entry.category, entry.type ?? ''].join(' '),
    );
    return terms.every((term) => haystack.includes(term));
  });
}

/** Counts per library, for reporting and tests. */
export function catalogCountsByLibrary(): Record<CatalogLibrary, number> {
  return {
    gym: CATALOG.filter((entry) => entry.library === 'gym').length,
    home: CATALOG.filter((entry) => entry.library === 'home').length,
    minimal: CATALOG.filter((entry) => entry.library === 'minimal').length,
  };
}
