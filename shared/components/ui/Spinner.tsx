import React from 'react';
import { cn } from './cn';

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block w-5 h-5 border-2 border-current/20 border-t-current rounded-full animate-spin motion-reduce:animate-none',
        className
      )}
      aria-label="Loading"
      role="status"
    />
  );
}
