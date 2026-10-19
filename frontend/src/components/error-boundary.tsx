"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportClientError } from "@/lib/report-client-error";

type Props = { name: string; children: ReactNode; fallback: (reset: () => void) => ReactNode; onError?: () => void };

/**
 * Isola um pedaço da tela: se ele quebrar, só ele mostra o fallback — o resto
 * da página continua funcionando — e o erro vai para o log do servidor.
 */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError(this.props.name, error, info.componentStack ?? undefined);
    this.props.onError?.();
  }

  reset = () => this.setState({ failed: false });

  render() {
    return this.state.failed ? this.props.fallback(this.reset) : this.props.children;
  }
}
