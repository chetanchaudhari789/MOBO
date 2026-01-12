'use client';

import React from 'react';
import { AuthProvider } from '../../../shared/context/AuthContext';
<<<<<<< HEAD
import { ToastProvider } from '../../../shared/context/ToastContext';
=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
import { AdminPortal } from '../../../shared/pages/AdminPortal';

export default function Page() {
  return (
    <AuthProvider>
<<<<<<< HEAD
      <ToastProvider>
        <AdminPortal onBack={() => {}} />
      </ToastProvider>
=======
      <AdminPortal onBack={() => {}} />
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
    </AuthProvider>
  );
}

