// @ts-nocheck
/**
 * @file What shows when a page breaks, in place of a blank screen.
 *
 * React takes the whole tree down when something throws while drawing.
 * Two of these stop that: one round the page inside the app's frame
 * (Layout), so the sidebar stays and another page is one click away, and
 * one round everything (App) for a break in the frame itself.
 *
 * It says what happened in plain words, offers to try again or reload,
 * and tells the server (lib/report-error.js) so the log knows. Going to
 * another page clears it (`resetKey` is the address).
 */
import { Component } from "react";
import { CircleAlert } from "lucide-react";
import { isChunkLoadError } from "@/lib/lazy-page";
import { reportError } from "@/lib/report-error";

const button =
  "inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ink-400";

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    reportError(isChunkLoadError(error) ? "chunk" : "render", error);
  }

  componentDidUpdate(previous) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // The page's code couldn't be fetched: almost always no connection.
    const notFetched = isChunkLoadError(error);
    return (
      <div
        role="alert"
        data-testid="page-broke"
        className={this.props.full ? "fixed inset-0 flex items-center justify-center px-4" : "flex justify-center px-2 pt-[18vh]"}
      >
        <div className="w-full max-w-sm text-center">
          <CircleAlert className="mx-auto h-6 w-6 text-ink-400 dark:text-ink-500" aria-hidden />
          <h1 className="mt-3 text-base font-semibold text-ink-900 dark:text-ink-100">
            {notFetched ? "This page couldn't be loaded" : "This page stopped working"}
          </h1>
          <p className="mt-1.5 text-sm leading-6 text-ink-500 dark:text-ink-400">
            {notFetched
              ? "It isn't on this device yet and couldn't be fetched. Check the connection, then try again."
              : "Something went wrong while showing it. Everything you saved is safe. Try again, or reload Zephyrly."}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              className={`${button} border border-border-strong text-ink-800 hover:bg-selected dark:text-ink-100`}
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
            <button
              type="button"
              className={`${button} bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]`}
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
