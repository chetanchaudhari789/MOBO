import React from 'react';
import { useAuth } from '../context/AuthContext';
import { MediatorAuthScreen } from '../pages/MediatorAuth';
import { MediatorDashboard } from '../pages/MediatorDashboard';
import { LogOut } from 'lucide-react';

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
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-zinc-950 text-white">
        <h2 className="text-xl font-bold mb-2">Access Denied</h2>
        <p className="text-zinc-400 mb-6">
          You are logged in as a <b>{user.role}</b>.
        </p>
        <button
          onClick={logout}
          className="flex items-center gap-2 px-6 py-3 bg-white text-black rounded-xl font-bold text-sm hover:bg-gray-200 transition-colors"
        >
          <LogOut size={16} /> Logout
        </button>
      </div>
    );
  }

  return <MediatorDashboard />;
};

