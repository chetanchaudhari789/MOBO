'use client';

import { FullPageError } from '../../../../shared/components/ui';

export default function OfflinePage() {
  return (
    <FullPageError
      title="You’re offline"
      description="This app needs an internet connection for live data and secure actions. Reconnect and try again."
      actionLabel="Retry"
      onAction={() => window.location.reload()}
    />
  );
}
