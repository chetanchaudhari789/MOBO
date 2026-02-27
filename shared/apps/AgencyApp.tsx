import React, { lazy, Suspense } from 'react';
import { useAuth } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { PortalGuard } from '../components/PortalGuard';
import { AgencyAuthScreen } from '../pages/AgencyAuth';

// Lazy-load the 186KB AgencyDashboard — only fetched after auth succeeds
const AgencyDashboard = lazy(() => import('../pages/AgencyDashboard').then(m => ({ default: m.AgencyDashboard })));

interface AgencyAppProps {
  onBack?: () => void;
}

export const AgencyApp: React.FC<AgencyAppProps> = ({ onBack }) => {
  const { user, logout } = useAuth();

  if (!user) {
    return <AgencyAuthScreen onBack={onBack} />;
  }

  // Ensure only Agencies access
  if (user.role !== 'agency') {
    return (
      <PortalGuard
        actualRole={user.role}
        expectedRoleLabel="Agency Portal"
        onLogout={logout}
        onBack={onBack}
      />
    );
  }

  return (
    <ErrorBoundary>
      <ToastProvider>
        <div className="relative">
          <Suspense fallback={<div className="flex-1 flex items-center justify-center min-h-[100dvh]"><div className="w-8 h-8 border-3 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" /></div>}>
            <AgencyDashboard />
          </Suspense>
        </div>
      </ToastProvider>
    </ErrorBoundary>
  );
};

