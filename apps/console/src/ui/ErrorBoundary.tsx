import { Component, type ReactNode } from "react";

/** If a page throws while rendering, say what happened and offer a reload instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="card card-pad max-w-md text-center">
          <h1 className="text-title-3">This page hit an error</h1>
          <p className="mt-2 text-footnote text-label-2">The server and the guard are unaffected. Reload to pick up the live state again.</p>
          <p className="mt-3 break-words font-mono text-caption text-label-2">{this.state.error.message}</p>
          <button type="button" className="btn btn-prominent mt-5" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
