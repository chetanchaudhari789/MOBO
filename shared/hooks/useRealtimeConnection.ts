import { useEffect, useMemo, useState } from 'react';
import { subscribeRealtime } from '../services/realtime';

export type RealtimeConnectionStatus = {
  connected: boolean;
  lastEventAt: number | null;
  lastAuthErrorAt: number | null;
  lastAuthErrorStatus: number | null;
};

// Heuristic: backend sends ping every 25s. Consider disconnected if we haven't
// seen anything for ~45s.
const STALE_AFTER_MS = 45_000;

export function useRealtimeConnection(): RealtimeConnectionStatus {
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [lastAuthErrorAt, setLastAuthErrorAt] = useState<number | null>(null);
  const [lastAuthErrorStatus, setLastAuthErrorStatus] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const unsub = subscribeRealtime((msg) => {
      const now = Date.now();

      // Any event implies the stream is alive.
      if (msg.type === 'ping' || msg.type === 'ready' || msg.type === 'message') {
        setLastEventAt(now);
        return;
      }

      if (msg.type === 'auth.error') {
        setLastAuthErrorAt(now);
        const status = msg.payload?.status;
        setLastAuthErrorStatus(typeof status === 'number' ? status : null);
        return;
      }

      // Domain events (orders.changed, etc) also imply liveness.
      setLastEventAt(now);
    });

    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      // Force periodic re-render so `connected` updates.
      setTick((x) => (x + 1) % 1_000_000);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  return useMemo(() => {
    const connected = lastEventAt ? Date.now() - lastEventAt < STALE_AFTER_MS : false;
    return {
      connected,
      lastEventAt,
      lastAuthErrorAt,
      lastAuthErrorStatus,
    };
  }, [lastEventAt, lastAuthErrorAt, lastAuthErrorStatus, tick]);
}
