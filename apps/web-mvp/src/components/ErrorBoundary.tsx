import { Component, type ErrorInfo, type ReactNode } from 'react';
import { clearAll } from '../lib/db';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('brtlb: render error caught by ErrorBoundary', error, info.componentStack);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleWipeAndReload = async (): Promise<void> => {
    try {
      await clearAll();
    } catch (err) {
      console.warn('brtlb: clearAll failed during error-boundary wipe', err);
    }
    try {
      window.localStorage.clear();
    } catch {
      // ignore — Private Browsing / cookie blocking
    }
    window.location.reload();
  };

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen bg-mist px-4 py-12">
        <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow-xl">
          <h1 className="text-lg font-semibold text-graphite">Something broke.</h1>
          <p className="mt-2 text-sm leading-relaxed text-graphite-soft">
            brtlb hit an unexpected error and can&apos;t render. Your audio and notes are saved
            locally — reloading usually fixes it. If it keeps happening, you can wipe brtlb&apos;s
            local data and start fresh.
          </p>
          {this.state.error.message ? (
            <pre className="mt-3 max-h-32 overflow-auto rounded-md bg-mist px-3 py-2 text-xs text-graphite-soft">
              {this.state.error.message}
            </pre>
          ) : null}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={this.handleWipeAndReload}
              className="rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Wipe local data and reload
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-md bg-graphite px-4 py-2 text-sm font-medium text-white hover:bg-graphite-soft"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
