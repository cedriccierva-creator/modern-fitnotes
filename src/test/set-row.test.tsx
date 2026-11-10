// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import IntensityPicker from '../components/IntensityPicker';
import SetRow from '../components/SetRow';
import { findIntensity } from '../lib/intensity';
import type { WorkoutSet } from '../types';

afterEach(cleanup);

const SET: WorkoutSet = {
  id: 'set-1',
  workoutExerciseId: 'session-1',
  workoutDayId: 'day-1',
  setNumber: 1,
  weightKg: 61.2344,
  reps: 8,
  completed: false,
  createdAt: 0,
  updatedAt: 0,
};

function renderRow(overrides: Partial<WorkoutSet> = {}) {
  const onChange = vi.fn();
  const onToggle = vi.fn();
  const onDelete = vi.fn();
  render(
    <SetRow
      set={{ ...SET, ...overrides }}
      unit="lb"
      onChange={onChange}
      onToggle={onToggle}
      onDelete={onDelete}
    />,
  );
  return { onChange, onToggle, onDelete };
}

describe('intensity picker', () => {
  it('offers the three presets with their ranges and exposes selection', () => {
    const onChange = vi.fn();
    render(<IntensityPicker value="universal" onChange={onChange} />);

    const group = screen.getByRole('radiogroup', { name: 'Intensity' });
    const options = group.querySelectorAll('[role="radio"]');
    expect(options).toHaveLength(3);
    expect(screen.getByRole('radio', { name: /High Intensity/ }).textContent).toContain('2 sets · 6–8 reps');
    expect(screen.getByRole('radio', { name: /Power Focus/ }).textContent).toContain('3 sets · 3–5 reps');
    expect(screen.getByRole('radio', { name: /Universal/ }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: /High Intensity/ }));
    expect(onChange).toHaveBeenCalledWith('high');
  });
});

describe('set row', () => {
  it('shows the stored kilogram value in the display unit', () => {
    renderRow();
    // 61.2344 kg ≈ 135.0 lb
    expect((screen.getByPlaceholderText('lb') as HTMLInputElement).value).toBe('135.0');
    expect((screen.getByPlaceholderText('reps') as HTMLInputElement).value).toBe('8');
  });

  it('parses input back into stored kilograms', () => {
    const { onChange } = renderRow();
    const weight = screen.getByPlaceholderText('lb');

    fireEvent.change(weight, { target: { value: '150' } });
    fireEvent.blur(weight);
    expect(onChange).toHaveBeenCalledWith({ weightKg: 68.04 });

    const reps = screen.getByPlaceholderText('reps');
    fireEvent.change(reps, { target: { value: '12' } });
    fireEvent.blur(reps);
    expect(onChange).toHaveBeenCalledWith({ reps: 12 });
  });

  it('ignores a fractional rep entry', () => {
    const { onChange } = renderRow();
    const reps = screen.getByPlaceholderText('reps');
    fireEvent.change(reps, { target: { value: '8.5' } });
    fireEvent.blur(reps);
    expect(onChange).toHaveBeenCalledWith({ reps: null });
  });

  it('styles a completed row in emerald and exposes a checkbox role', () => {
    renderRow({ completed: true });

    const toggle = screen.getByRole('checkbox', { name: 'Set 1 complete' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.className).toContain('bg-emerald-500');
    expect(toggle.closest('li')?.className).toContain('ring-emerald-500/40');
  });

  it('toggles and deletes', () => {
    const { onToggle, onDelete } = renderRow();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Set 1 complete' }));
    expect(onToggle).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete set 1' }));
    expect(onDelete).toHaveBeenCalled();
  });

  it('keeps the rep range honest', () => {
    expect(findIntensity('high').hint).toBe('2 sets · 6–8 reps');
  });
});
