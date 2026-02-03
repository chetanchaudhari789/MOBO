'use client';

import { useEffect } from 'react';
import { api } from '../../../shared/services/api';

const TOKEN_STORAGE_KEY = 'mobo_tokens_v1';

function hasAuthToken(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return !!parsed?.accessToken;
  } catch {
    return false;
  }
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function ensurePushSubscription(app: 'buyer' | 'mediator') {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (!hasAuthToken()) return;

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') return;

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();

  let subscription = existing;
  if (!subscription) {
    const keyRes = await api.notifications.push.publicKey();
    const publicKey = String(keyRes?.publicKey || '').trim();
    if (!publicKey) return;
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  await api.notifications.push.subscribe({
    app,
    subscription: subscription.toJSON(),
    userAgent: navigator.userAgent,
  });
}

export function PwaRuntime({ app }: { app: 'buyer' | 'mediator' }) {
  useEffect(() => {
    (globalThis as any).__MOBO_ENABLE_PWA_GUARDS__ = true;
    (globalThis as any).__MOBO_PWA_APP__ = app;

    if ('serviceWorker' in navigator) {
      const registerWorker = () => {
        navigator.serviceWorker
          .register('/service-worker.js', { scope: '/' })
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

            ensurePushSubscription(app).catch(() => undefined);
          })
          .catch(() => {
            // Ignore registration failures (e.g., unsupported or blocked).
          });
      };

      if (document.readyState === 'complete') {
        registerWorker();
      } else {
        window.addEventListener('load', registerWorker, { once: true });
      }
    }

    const handleAuthChange = () => {
      ensurePushSubscription(app).catch(() => undefined);
    };
    window.addEventListener('mobo-auth-changed', handleAuthChange as EventListener);

    return () => {
      window.removeEventListener('mobo-auth-changed', handleAuthChange as EventListener);
    };
  }, [app]);

  return null;
}
