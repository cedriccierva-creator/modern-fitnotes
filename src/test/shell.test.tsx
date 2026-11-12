// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { cx } from '../lib/cx';
import { settleDatabaseReads, trackDatabaseReads } from './db-quiescence';

/**
 * `<App />` renders the calendar screen, which loads its data without awaiting
 * it. Those reads have to be counted and allowed to finish before teardown,
 * otherwise one can re-open the database after this file's environment is gone
 * and Dexie's on('ready') event throws `dispatchEvent is not defined`. See
 * `db-quiescence.ts`.
 */
trackDatabaseReads(await import('../db/planned'), ['loadPlannedDays', 'loadLoggedDates']);

afterEach(async () => {
  cleanup();
  // Drain before restoring: the tracking itself is implemented with spies.
  // Nothing here deletes the database — these tests never write, and deleting
  // it was only ever a way of racing the reads this drain now waits for.
  await settleDatabaseReads();
  vi.restoreAllMocks();
});

describe('shell', () => {
  it('renders the calendar screen', async () => {
    render(<App />);
    expect(screen.getByText('FitNotes')).toBeTruthy();
    expect(screen.getByText(/plan your/i)).toBeTruthy();
  });

  it('renders on a dark slate root', async () => {
    const { container } = render(<App />);
    expect(container.querySelector('.bg-slate-950')).not.toBeNull();
  });
});

describe('cx', () => {
  it('drops falsy parts', () => {
    expect(cx('a', false, null, undefined, 'b')).toBe('a b');
  });
});
