'use client';

import React, { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode; fallback?: ReactNode };
type State = { hasError: boolean; error: Error | null; retryCount: number };

/** Maximum retries before showing a persistent "contact support" message. */
const MAX_RETRIES = 3;

/**
 * Global React error boundary.
 * Catches unhandled render errors so the entire app doesn't crash.
 * Tracks retry count - after MAX_RETRIES, forces a hard page reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught render error:', error, info.componentStack);
  }

  private handleReload = () => {
    const nextCount = this.state.retryCount + 1;
    if (nextCount >= MAX_RETRIES) {
      // After repeated failures, hard-reload to get fresh JS bundles
      window.location.reload();
      return;
    }
    this.setState({ hasError: false, error: null, retryCount: nextCount });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const exhausted = this.state.retryCount >= MAX_RETRIES - 1;

      return (
        <div
          style={{
            minHeight: '100dvh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'center',
            background: '#f8fafc',
          }}
        >
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
          <h1
            style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              color: '#0f172a',
              margin: '0 0 0.5rem',
            }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              color: '#64748b',
              fontSize: '0.875rem',
              margin: '0 0 1.5rem',
              maxWidth: '24rem',
            }}
          >
            {exhausted
              ? 'This error keeps occurring. Please try refreshing the page or contact support if it persists.'
              : 'An unexpected error occurred. Please reload to continue.'}
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              padding: '0.75rem 2rem',
              borderRadius: '0.75rem',
              border: 'none',
              background: '#a3e635',
              color: '#1a2e05',
              fontWeight: 700,
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            {exhausted ? 'Force Reload' : 'Reload'}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}