'use client';

import React from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          margin: 0,
          backgroundColor: '#f9fafb',
          color: '#111827',
        }}
      >
        <div style={{ textAlign: 'center', padding: '2rem', maxWidth: '480px' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Something went wrong</h1>
          <p style={{ color: '#6b7280', marginBottom: '1rem' }}>
            An unexpected error occurred. Please try again.
          </p>
          {process.env.NODE_ENV === 'development' && error?.message && (
            <pre
              style={{
                fontSize: '0.75rem',
                color: '#ef4444',
                background: '#fef2f2',
                padding: '0.75rem',
                borderRadius: '0.375rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                marginBottom: '1rem',
              }}
            >
              {error.message}
            </pre>
          )}
          {error?.digest && (
            <p style={{ fontSize: '0.7rem', color: '#9ca3af', marginBottom: '1rem' }}>
              Error ID: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              padding: '0.5rem 1.5rem',
              borderRadius: '0.375rem',
              border: 'none',
              backgroundColor: '#3b82f6',
              color: '#fff',
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
