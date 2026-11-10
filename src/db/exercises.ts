import { db } from './db';
import { newId } from '../lib/id';
import type { Exercise } from '../types';

export async function loadExercises(): Promise<Exercise[]> {
  await db.open();
  return db.exercises.orderBy('name').toArray();
}

export async function createExercise(name: string, muscleGroup?: string): Promise<Exercise> {
  const now = Date.now();
  const exercise: Exercise = {
    id: newId(),
    name: name.trim(),
    muscleGroup: muscleGroup?.trim() ? muscleGroup.trim() : undefined,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.exercises.add(exercise);
  return exercise;
}

/**
 * Rename the library row only.
 *
 * WorkoutExercise.exerciseName is a *snapshot* taken at logging time, so past
 * sessions keep the name they were performed under and are never rewritten.
 */
export async function renameExercise(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed === '') throw new Error('Exercise name cannot be empty');
  await db.exercises.update(id, { name: trimmed, updatedAt: Date.now() });
}

/**
 * Delete from the library.
 *
 * Historical session rows keep their exerciseId and their frozen name, so
 * deleting an exercise does not corrupt or rewrite any past workout.
 */
export async function deleteExercise(id: string): Promise<void> {
  await db.exercises.delete(id);
}

export async function findExerciseById(id: string): Promise<Exercise | undefined> {
  return db.exercises.get(id);
}
