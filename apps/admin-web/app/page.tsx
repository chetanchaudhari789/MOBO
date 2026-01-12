'use client';

import React from 'react';
import { AuthProvider } from '../../../shared/context/AuthContext';
import { ToastProvider } from '../../../shared/context/ToastContext';
import { AdminPortal } from '../../../shared/pages/AdminPortal';

export default function Page() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AdminPortal onBack={() => {}} />
      </ToastProvider>
    </AuthProvider>
  );
}

