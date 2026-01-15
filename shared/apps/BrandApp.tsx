import React from 'react';
import { useAuth } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { PortalGuard } from '../components/PortalGuard';
import { RealtimeStatusBadge } from '../components/ui';
import { useRealtimeConnection } from '../hooks/useRealtimeConnection';
import { BrandAuthScreen } from '../pages/BrandAuth';
import { BrandDashboard } from '../pages/BrandDashboard';

interface BrandAppProps {
  onBack?: () => void;
}

export const BrandApp: React.FC<BrandAppProps> = ({ onBack }) => {
  const { user, logout } = useAuth();
  const { connected } = useRealtimeConnection();

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
    <ToastProvider>
      <div className="relative">
        <div className="absolute top-[calc(1rem+env(safe-area-inset-top))] right-4 z-50 pointer-events-none">
          <RealtimeStatusBadge connected={connected} />
        </div>
        <BrandDashboard />
      </div>
    </ToastProvider>
  );
};

