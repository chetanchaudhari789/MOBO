import React from 'react';
import { useAuth } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { PortalGuard } from '../components/PortalGuard';
import { RealtimeStatusBadge } from '../components/ui';
import { useRealtimeConnection } from '../hooks/useRealtimeConnection';
import { AgencyAuthScreen } from '../pages/AgencyAuth';
import { AgencyDashboard } from '../pages/AgencyDashboard';

interface AgencyAppProps {
  onBack?: () => void;
}

export const AgencyApp: React.FC<AgencyAppProps> = ({ onBack }) => {
  const { user, logout } = useAuth();
  const { connected } = useRealtimeConnection();

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
    <ToastProvider>
      <div className="relative">
        <div className="absolute top-[calc(1rem+env(safe-area-inset-top))] right-4 z-50 pointer-events-none">
          <RealtimeStatusBadge connected={connected} />
        </div>
        <AgencyDashboard />
      </div>
    </ToastProvider>
  );
};

