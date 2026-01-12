import React from 'react';
import { useAuth } from '../context/AuthContext';
import { NotificationProvider } from '../context/NotificationContext';
import { ToastProvider } from '../context/ToastContext';
import { PortalGuard } from '../components/PortalGuard';
import { MediatorAuthScreen } from '../pages/MediatorAuth';
import { MediatorDashboard } from '../pages/MediatorDashboard';

interface MediatorAppProps {
  onBack?: () => void;
}

export const MediatorApp: React.FC<MediatorAppProps> = ({ onBack }) => {
  const { user, logout } = useAuth();

  if (!user) {
    return <MediatorAuthScreen onBack={onBack} />;
  }

  // Ensure only Mediators access
  if (user.role !== 'mediator') {
    return (
      <PortalGuard
        actualRole={user.role}
        expectedRoleLabel="Mediator App"
        onLogout={logout}
        onBack={onBack}
        title="Access Denied"
      />
    );
  }

  return (
    <ToastProvider>
      <NotificationProvider>
        <MediatorDashboard />
      </NotificationProvider>
    </ToastProvider>
  );
};

