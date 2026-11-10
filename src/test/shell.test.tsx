// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../App';
import { cx } from '../lib/cx';

afterEach(cleanup);

describe('shell', () => {
  it('renders the calendar screen', async () => {
    render(<App />);
    expect(screen.getByText('FitNotes')).toBeTruthy();
    expect(screen.getByText(/plan the/i)).toBeTruthy();
  });

  it('renders on a dark slate root', () => {
    const { container } = render(<App />);
    expect(container.querySelector('.bg-slate-950')).not.toBeNull();
  });
});

describe('cx', () => {
  it('drops falsy parts', () => {
    expect(cx('a', false, null, undefined, 'b')).toBe('a b');
  });
});
