import React from 'react';
import { useAuth } from '../context/AuthContext';
import { BrandAuthScreen } from '../pages/BrandAuth';
import { BrandDashboard } from '../pages/BrandDashboard';
import { LogOut, ArrowLeft } from 'lucide-react';

interface BrandAppProps {
  onBack: () => void;
}

export const BrandApp: React.FC<BrandAppProps> = ({ onBack }) => {
  const { user, logout } = useAuth();

  if (!user) {
    return <BrandAuthScreen onBack={onBack} />;
  }

  // Ensure only Brands can access
  if (user.role !== 'brand') {
    return (
      <div className="flex flex-col items-center justify-center h-screen w-full p-8 text-center bg-zinc-50">
        <div className="bg-white p-12 rounded-3xl shadow-xl border border-zinc-100 max-w-md">
          <h2 className="text-2xl font-bold mb-4 text-zinc-900">Access Restricted</h2>
          <p className="text-zinc-500 mb-2">
            You are currently logged in as a <b>{user.role}</b>.
          </p>
          <p className="text-zinc-500 mb-8">This portal is exclusively for Brand Partners.</p>

          <div className="flex flex-col gap-3">
            <button
              onClick={logout}
              className="w-full px-6 py-4 bg-zinc-900 text-white rounded-xl font-bold text-sm shadow-lg hover:bg-zinc-800 transition-colors flex items-center justify-center gap-2"
            >
              <LogOut size={18} /> Logout & Switch Account
            </button>
            <button
              onClick={onBack}
              className="w-full px-6 py-4 bg-white border border-zinc-200 text-zinc-600 rounded-xl font-bold text-sm hover:bg-zinc-50 transition-colors flex items-center justify-center gap-2"
            >
              <ArrowLeft size={18} /> Return to Mobile OS
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <BrandDashboard />;
};

