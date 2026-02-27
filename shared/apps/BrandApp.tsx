import React, { lazy, Suspense } from 'react';
import { useAuth } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { PortalGuard } from '../components/PortalGuard';
import { BrandAuthScreen } from '../pages/BrandAuth';

// Lazy-load the 127KB BrandDashboard — only fetched after auth succeeds
const BrandDashboard = lazy(() => import('../pages/BrandDashboard').then(m => ({ default: m.BrandDashboard })));

interface BrandAppProps {
  onBack?: () => void;
}

export const BrandApp: React.FC<BrandAppProps> = ({ onBack }) => {
  const { user, logout } = useAuth();

  if (!user) {
    return <BrandAuthScreen onBack={onBack} />;
  }

  // Ensure only Brands can access
  if (user.role !== 'brand') {
    return (
      <PortalGuard
        actualRole={user.role}
        expectedRoleLabel="Brand Portal"
        onLogout={logout}
        onBack={onBack}
        title="Access Restricted"
      />
    );
  }

  return (
    <ErrorBoundary>
      <ToastProvider>
        <div className="relative">
          <Suspense fallback={<div className="flex-1 flex items-center justify-center min-h-[100dvh]"><div className="w-8 h-8 border-3 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" /></div>}>
            <BrandDashboard />
          </Suspense>
        </div>
      </ToastProvider>
    </ErrorBoundary>
  );
};

