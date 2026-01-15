import React from 'react';
import { Badge } from './Badge';
import { cn } from './cn';

export function RealtimeStatusBadge({
  connected,
  className,
  children,
}: {
  connected: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const statusLabel = connected ? 'Realtime connected' : 'Realtime offline (reconnecting)';

  return (
    <Badge
      variant={connected ? 'success' : 'warning'}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={statusLabel}
      title={connected ? 'Realtime connected' : 'Realtime reconnecting'}
      className={cn('gap-2', className)}
    >
      <span
        aria-hidden="true"
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          connected ? 'bg-emerald-500 animate-pulse motion-reduce:animate-none' : 'bg-amber-500'
        )}
      />
      {connected ? 'LIVE' : 'OFFLINE'}
      {children}
    </Badge>
  );
}
