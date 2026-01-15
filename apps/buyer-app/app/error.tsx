'use client';

import React from 'react';
import { FullPageError } from '../../../shared/components/ui';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <FullPageError
      title="Buyer App error"
      description="Something went wrong while loading this screen."
      details={error?.message}
      actionLabel="Reload"
      onAction={reset}
    />
  );
}
