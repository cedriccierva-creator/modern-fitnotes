import { db } from './db';
import type { Settings } from '../types';
import { SETTINGS_ID } from '../types';

/** The settings table is a single row; absent means the default of kilograms. */
export async function loadWeightUnit(): Promise<'kg' | 'lb'> {
  await db.open();
  const row = await db.settings.get(SETTINGS_ID);
  return row?.weightUnit === 'lb' ? 'lb' : 'kg';
}

export async function setWeightUnit(weightUnit: 'kg' | 'lb'): Promise<void> {
  const now = Date.now();
  const existing = await db.settings.get(SETTINGS_ID);
  const row: Settings =
    existing === undefined
      ? { id: SETTINGS_ID, weightUnit, createdAt: now, updatedAt: now }
      : { ...existing, weightUnit, updatedAt: now };

  await db.settings.put(row);
}
