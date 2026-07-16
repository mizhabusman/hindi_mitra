import { Component, type ReactNode } from "react";

// App-wide safety net. A render/runtime error anywhere below this boundary is
// caught and shown as a recoverable message instead of a blank white screen.
// Reloading re-initializes the app; the session cookie is untouched, so the
// user is NOT logged out.
interface State { error: Error | null }

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // Surfaced in the console for diagnosis; not shown to the user.
    console.error("Unhandled UI error:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="center">
          <div className="errorCard">
            <h2>Something went wrong</h2>
            <p>The page hit an unexpected error. Your session is safe — reloading should fix it.</p>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload the page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
