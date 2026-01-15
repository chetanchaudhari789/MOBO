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
      title="Brand Portal error"
      description="Something went wrong while loading this page."
      details={error?.message}
      actionLabel="Reload"
      onAction={reset}
    />
  );
}
