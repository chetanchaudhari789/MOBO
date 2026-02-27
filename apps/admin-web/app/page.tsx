'use client';

import React, { lazy, Suspense } from 'react';
import { AuthProvider } from '../../../shared/context/AuthContext';
import { ToastProvider } from '../../../shared/context/ToastContext';
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary';

// Lazy-load the 98KB AdminPortal — only fetched after initial render
const AdminPortal = lazy(() => import('../../../shared/pages/AdminPortal').then(m => ({ default: m.AdminPortal })));

export default function Page() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="w-8 h-8 border-3 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" /></div>}>
            <AdminPortal onBack={() => {}} />
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

