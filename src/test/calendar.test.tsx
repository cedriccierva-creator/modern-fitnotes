// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import MonthCalendar from '../components/MonthCalendar';
import type { PlannedDay } from '../types';

const DAWN = 1_700_000_000_000;

function planFor(date: string): PlannedDay {
  return { id: date, date, presetId: 'ppl-flow', label: 'Push', category: 'push', createdAt: DAWN, updatedAt: DAWN };
}

function setup() {
  const onSelect = vi.fn();
  const onNavigate = vi.fn();
  const user = userEvent.setup();

  render(
    <MonthCalendar
      year={2026}
      month={11}
      selected="2026-11-10"
      today="2026-11-10"
      planned={new Map([['2026-11-12', planFor('2026-11-12')]])}
      logged={new Set(['2026-11-13'])}
      onSelect={onSelect}
      onNavigate={onNavigate}
    />,
  );

  return { onSelect, onNavigate, user };
}

describe('month calendar', () => {
  it('navigates between months', async () => {
    const { onNavigate, user } = setup();

    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(onNavigate).toHaveBeenCalledWith(-1);

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(onNavigate).toHaveBeenCalledWith(1);
  });

  it('selects a date inside the month and outside it', async () => {
    const { onSelect, user } = setup();

    expect(screen.getByText('November 2026')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Friday, November 13, 2026' }));
    expect(onSelect).toHaveBeenCalledWith('2026-11-13');

    // 26 October 2026 and 6 December 2026 are leading/trailing spill days.
    await user.click(screen.getByRole('button', { name: 'Monday, October 26, 2026' }));
    expect(onSelect).toHaveBeenCalledWith('2026-10-26');

    await user.click(screen.getByRole('button', { name: 'Sunday, December 6, 2026' }));
    expect(onSelect).toHaveBeenCalledWith('2026-12-06');
  });

  it('marks the selected day and the planned day', async () => {
    setup();

    const selected = screen.getByRole('button', { name: 'Tuesday, November 10, 2026' });
    expect(selected.getAttribute('aria-pressed')).toBe('true');

    const planned = screen.getByRole('button', { name: 'Thursday, November 12, 2026' });
    expect(planned.textContent).toContain('Push');
    expect(planned.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('logged indicator', () => {
  it('marks a logged day without a plan', () => {
    setup();

    const logged = screen.getByRole('button', { name: 'Friday, November 13, 2026' });
    expect(logged.getAttribute('data-logged')).toBe('true');
    expect(logged.getAttribute('data-planned')).toBeNull();
  });

  it('keeps planned and logged as independent signals on the same day', () => {
    render(
      <MonthCalendar
        year={2026}
        month={11}
        selected="2026-11-12"
        today="2026-11-10"
        planned={new Map([['2026-11-12', planFor('2026-11-12')]])}
        logged={new Set(['2026-11-12'])}
        onSelect={() => {}}
        onNavigate={() => {}}
      />,
    );

    const both = screen.getByRole('button', { name: 'Thursday, November 12, 2026' });
    expect(both.getAttribute('data-planned')).toBe('true');
    expect(both.getAttribute('data-logged')).toBe('true');
    expect(both.textContent).toContain('Push');

    // The selected/today styling is untouched by either indicator.
    expect(both.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders no indicator when the logged set is omitted', () => {
    render(
      <MonthCalendar
        year={2026}
        month={11}
        selected="2026-11-10"
        today="2026-11-10"
        planned={new Map()}
        onSelect={() => {}}
        onNavigate={() => {}}
      />,
    );

    const cell = screen.getByRole('button', { name: 'Friday, November 13, 2026' });
    expect(cell.getAttribute('data-logged')).toBeNull();
  });
});
