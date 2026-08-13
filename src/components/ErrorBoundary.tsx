import React from 'react';

/**
 * Catches a render error in its subtree and shows `fallback` instead of letting
 * React unmount everything above it.
 *
 * React has no hook form of this — a class is the only way — so there is exactly
 * one implementation and everything that needs a boundary uses it. The 3D
 * viewport carries its own instances because a GPU/asset failure there should
 * cost you the model and nothing else; App wraps the router so a throw anywhere
 * in a page shows a message instead of a blank window.
 *
 * `label` only ever reaches the console, to say which boundary caught it.
 */
export class ErrorBoundary extends React.Component<
  { fallback: React.ReactNode; label?: string; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    // eslint-disable-next-line no-console
    console.error(`[${this.props.label ?? 'ErrorBoundary'}] caught a render error:`, error, info);
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

/**
 * The app-level fallback. Deliberately plain: it renders when something in the
 * app has already failed, so it depends on nothing but React and a full reload.
 *
 * Reload rather than a router navigation — the router may be part of what broke,
 * and a hard reload is the one recovery that cannot itself throw. Nothing is
 * lost by it: the character sheet autosaves to localStorage continuously.
 */
export function AppCrashFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-900">
      <div className="max-w-md text-center">
        <p className="text-4xl mb-3">🎲</p>
        <h1 className="text-lg font-bold text-white mb-2">Something went wrong</h1>
        <p className="text-sm text-slate-400 mb-5">
          A page in Tavern Sheet crashed. Your characters are saved — reloading should get you back.
          If it keeps happening, the details are in the developer console.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-bold transition-colors"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
