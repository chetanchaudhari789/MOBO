'use client';

import React from 'react';
import { AuthProvider } from '../../../shared/context/AuthContext';
import { ToastProvider } from '../../../shared/context/ToastContext';
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary';
import { AdminPortal } from '../../../shared/pages/AdminPortal';

export default function Page() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <AdminPortal onBack={() => {}} />
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

