import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

/**
 * The single-column phone frame every screen renders inside: a fixed max
 * width keeps the layout from stretching on tablets, plus a sticky header for
 * the wordmark. Mirrors the shell shape KainLog settled on.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-aura min-h-dvh bg-slate-950">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
        <header className="sticky top-0 z-10 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur">
          <div className="flex items-center gap-2 px-5 py-3">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rotate-45 rounded-sm bg-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.45)]"
            />
            <span className="text-sm font-semibold tracking-wide text-slate-100">
              FitNotes
            </span>
          </div>
        </header>

        <main className={cx('flex-1 px-5 pb-10 pt-6')}>{children}</main>
      </div>
    </div>
  );
}
