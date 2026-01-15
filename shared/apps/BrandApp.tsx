import React from 'react';
import { useAuth } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { PortalGuard } from '../components/PortalGuard';
import { BrandAuthScreen } from '../pages/BrandAuth';
import { BrandDashboard } from '../pages/BrandDashboard';

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
    <ToastProvider>
      <div className="relative">
        <BrandDashboard />
      </div>
    </ToastProvider>
  );
};

