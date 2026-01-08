import React from 'react';
import { useAuth } from '../context/AuthContext';
import { AgencyAuthScreen } from '../pages/AgencyAuth';
import { AgencyDashboard } from '../pages/AgencyDashboard';
import { LogOut } from 'lucide-react';

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
      <div className="flex flex-col items-center justify-center h-screen p-8 text-center bg-zinc-50">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full">
          <h2 className="text-xl font-bold text-slate-900 mb-2">Wrong Portal</h2>
          <p className="text-slate-500 mb-6">
            You are logged in as a <b>{user.role}</b>.
          </p>
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-black transition-colors"
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </div>
    );
  }

  return <AgencyDashboard />;
};

