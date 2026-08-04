import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

// Root error boundary. Without this, any render-time throw unmounts the whole
// React tree and leaves a permanently blank window (the same bad record reloads
// from storage on refresh). This keeps the app recoverable.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // No remote telemetry by design — log locally for the dev console only.
    console.error('Almanac crash:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen grid place-items-center p-6 text-ink-1">
        <div className="raised rounded-xl6 p-6 max-w-md text-center">
          <p className="smallcaps text-[11px] text-brick mb-2">Something went wrong</p>
          <p className="text-[13px] text-ink-2 mb-4 leading-relaxed">
            The app hit an unexpected error. Your saved days are safe on disk —
            reloading should bring you right back.
          </p>
          <button
            onClick={() => location.reload()}
            className="smallcaps text-[12px] text-white bg-blue hover:bg-blue-deep px-4 py-2 rounded-md transition-colors"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
