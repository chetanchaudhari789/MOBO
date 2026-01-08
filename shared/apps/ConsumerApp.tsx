import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { CartProvider } from '../context/CartContext';
import { ChatProvider } from '../context/ChatContext';
import { NotificationProvider } from '../context/NotificationContext';
import { AuthScreen } from '../pages/Auth';
import { Home } from '../pages/Home';
import { Orders } from '../pages/Orders';
import { Profile } from '../pages/Profile';
import { Explore } from '../pages/Explore';
import { Home as HomeIcon, Package, User, LogOut, Zap, Search } from 'lucide-react';

interface ConsumerAppProps {
  onBack?: () => void;
}

export const ConsumerApp: React.FC<ConsumerAppProps> = ({ onBack }) => {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'home' | 'explore' | 'orders' | 'profile'>('home');

  if (!user) return <AuthScreen onBack={onBack} />;

  if (user.role === 'agency' || user.role === 'mediator') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-zinc-950 text-white">
        <div className="p-4 rounded-full bg-white/10 mb-6 animate-pulse">
          <Zap size={40} className="text-lime-400" />
        </div>
        <h2 className="text-2xl font-extrabold mb-2">Wrong Portal</h2>
        <p className="text-zinc-400 mb-8 max-w-xs leading-relaxed">
          You are logged in as a <b>{user.role}</b>.
        </p>
        <button
          onClick={logout}
          className="px-8 py-4 bg-lime-400 text-black rounded-2xl font-bold text-sm shadow-glow transition-transform active:scale-95"
        >
          Logout
        </button>
      </div>
    );
  }

  if (user.isVerifiedByMediator === false) {
    return (
      <div className="flex flex-col h-full bg-slate-50 relative p-8 items-center justify-center text-center overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-indigo-50 to-transparent pointer-events-none"></div>
        <div className="relative z-10 bg-white p-8 rounded-[2.5rem] shadow-xl border border-indigo-50 w-full max-w-sm">
          <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mb-6 mx-auto">
            <div className="w-3 h-3 bg-indigo-600 rounded-full animate-ping"></div>
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 mb-2 tracking-tight">
            Hang Tight!
          </h1>
          <p className="text-slate-500 mb-8 font-medium">
            Your request is with Mediator{' '}
            <span className="text-indigo-600 font-bold font-mono bg-indigo-50 px-2 py-0.5 rounded">
              {user.mediatorCode}
            </span>
            .
          </p>
          <div className="space-y-3">
            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 w-[60%]"></div>
            </div>
            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">
              Verification in Progress
            </p>
          </div>
        </div>
        <button
          onClick={logout}
          className="mt-12 flex items-center gap-2 text-slate-400 font-bold text-xs hover:text-slate-800 transition-colors uppercase tracking-widest"
        >
          <LogOut size={14} /> Cancel Request
        </button>
      </div>
    );
  }

  return (
    <CartProvider>
      <ChatProvider>
        <NotificationProvider>
          <div className="flex flex-col h-full bg-[#F2F2F7] relative overflow-hidden font-sans">
            <div className="flex-1 overflow-hidden">
              {activeTab === 'home' && <Home onVoiceNavigate={setActiveTab} />}
              {activeTab === 'explore' && <Explore />}
              {activeTab === 'orders' && <Orders />}
              {activeTab === 'profile' && <Profile />}
            </div>

            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40">
              <div className="glass px-6 py-3 rounded-full flex items-center gap-6 shadow-2xl border border-white/40">
                <NavButton
                  icon={<HomeIcon size={22} strokeWidth={2.5} />}
                  active={activeTab === 'home'}
                  onClick={() => setActiveTab('home')}
                  ariaLabel="Home"
                />
                <NavButton
                  icon={<Search size={22} strokeWidth={2.5} />}
                  active={activeTab === 'explore'}
                  onClick={() => setActiveTab('explore')}
                  ariaLabel="Explore"
                />
                <NavButton
                  icon={<Package size={22} strokeWidth={2.5} />}
                  active={activeTab === 'orders'}
                  onClick={() => setActiveTab('orders')}
                  ariaLabel="Orders"
                />
                <NavButton
                  icon={<User size={22} strokeWidth={2.5} />}
                  active={activeTab === 'profile'}
                  onClick={() => setActiveTab('profile')}
                  ariaLabel="Profile"
                />
              </div>
            </div>
          </div>
        </NotificationProvider>
      </ChatProvider>
    </CartProvider>
  );
};


const NavButton: React.FC<{
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  alert?: boolean;
  ariaLabel: string;
}> = ({ icon, active, onClick, alert, ariaLabel }) => (
  <button
    onClick={onClick}
    aria-label={ariaLabel}
    className={`relative p-3 rounded-full transition-all duration-300 ${
      active
        ? 'bg-black text-lime-400 shadow-lg -translate-y-2 scale-110'
        : 'text-slate-400 hover:text-slate-600 hover:-translate-y-1'
    }`}
  >
    {icon}
    {alert && (
      <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
    )}
  </button>
);
