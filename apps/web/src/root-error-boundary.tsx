import { Component, type ReactNode } from "react";
import { browserBuild, reportBrowserEvent, serverReference } from "@/lib/browser-diagnostics";

type State = { failed: boolean; reference: string };

/**
 * Local root error boundary (G07). Shows a safe message with a copyable
 * reference and build identity; the only sink is the local console.
 * Raw render errors are never displayed or forwarded.
 */
export class RootErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false, reference: "" };
  static getDerivedStateFromError(): State {
    const { release } = browserBuild();
    return {
      failed: true,
      reference: serverReference("app.root", 500, null) + ` · ${release}`,
    };
  }
  componentDidCatch(): void {
    reportBrowserEvent({
      component: "web",
      operation: "app.root",
      phase: "render",
      reason: "react-error-boundary",
      status: 500,
    });
  }
  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="min-h-svh bg-background text-foreground">
        <main className="mx-auto max-w-xl px-6 py-24 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            The page could not be shown. Reload to try again. Diagnostic details stay in your
            browser console.
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            Reference: <code>{this.state.reference}</code>
          </p>
          <button
            type="button"
            className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            Reload the page
          </button>
        </main>
      </div>
    );
  }
}
