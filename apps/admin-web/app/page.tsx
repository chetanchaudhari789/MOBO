'use client';

import React from 'react';
import { AuthProvider } from '../../../shared/context/AuthContext';
import { AdminPortal } from '../../../shared/pages/AdminPortal';

export default function Page() {
  return (
    <AuthProvider>
      <AdminPortal onBack={() => {}} />
    </AuthProvider>
  );
}

