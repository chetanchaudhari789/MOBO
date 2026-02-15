import React from 'react';
import { useAuth } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { PortalGuard } from '../components/PortalGuard';
import { AgencyAuthScreen } from '../pages/AgencyAuth';
import { AgencyDashboard } from '../pages/AgencyDashboard';

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
          <AgencyDashboard />
        </div>
      </ToastProvider>
    </ErrorBoundary>
  );
};

