"use client";
import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode; fallback?: (e: Error, reset: () => void) => React.ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ui] uncaught render error", error, info.componentStack);
  }
  reset = () => this.setState({ error: null });
  render() {
    if (this.state.error) {
      return this.props.fallback ? this.props.fallback(this.state.error, this.reset) : <ErrorPanel error={this.state.error} reset={this.reset} />;
    }
    return this.props.children;
  }
}

export function ErrorPanel({ error, reset, title = "This view failed to load" }: { error: Error; reset?: () => void; title?: string }) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex size-10 items-center justify-center rounded-lg bg-danger-soft text-danger">
        <AlertTriangle className="size-5" />
      </div>
      <div>
        <p className="text-[14px] font-semibold">{title}</p>
        <p className="mt-1 max-w-md text-[13px] text-ink-3">{error.message || "An unexpected error occurred."}</p>
      </div>
      {reset ? (
        <Button size="sm" onClick={reset}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
