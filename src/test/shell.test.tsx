// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../App';
import { cx } from '../lib/cx';

afterEach(cleanup);

describe('shell', () => {
  it('renders the wordmark and the placeholder screen', () => {
    render(<App />);
    expect(screen.getByText('FitNotes')).toBeTruthy();
    expect(screen.getByText(/train hard/i)).toBeTruthy();
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
