'use client';

import { useEffect } from 'react';

export function PwaRuntime({ app }: { app: 'buyer' | 'mediator' }) {
  useEffect(() => {
    (globalThis as any).__MOBO_ENABLE_PWA_GUARDS__ = true;
    (globalThis as any).__MOBO_PWA_APP__ = app;

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((registration) => {
            registration.update?.();

            (registration as any).sync
              ?.register('buzzma-background-sync')
              .catch(() => undefined);

            (registration as any).periodicSync
              ?.register('buzzma-periodic-sync', {
                minInterval: 24 * 60 * 60 * 1000,
              })
              .catch(() => undefined);
          })
          .catch(() => {
            // Ignore registration failures (e.g., unsupported or blocked).
          });
      });
    }
  }, [app]);

  return null;
}
