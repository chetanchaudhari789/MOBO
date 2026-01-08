import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Users, ArrowRight, Lock, User, Phone, CheckCircle, ChevronLeft } from 'lucide-react';

interface MediatorAuthProps {
  onBack?: () => void;
}

export const MediatorAuthScreen: React.FC<MediatorAuthProps> = ({ onBack }) => {
  const [view, setView] = useState<'splash' | 'login' | 'register'>('splash');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [agencyCode, setAgencyCode] = useState('');

  const { login, registerOps } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await login(mobile, password);
    } catch (err: any) {
      setError(err.message || 'Login failed');
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !mobile || !password || !agencyCode) {
      setError('All fields required.');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      await registerOps(name, mobile, password, 'mediator', agencyCode.toUpperCase());
    } catch (err: any) {
      setError(err.message || 'Registration Failed');
      setIsLoading(false);
    }
  };

  if (view === 'splash') {
    return (
      <div className="flex-1 flex flex-col bg-zinc-900 text-white relative overflow-hidden h-full pb-[env(safe-area-inset-bottom)]">
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-800 to-black"></div>
        {onBack && (
          <div className="absolute top-6 left-6 z-50">
            <button
              onClick={onBack}
              className="flex items-center gap-2 text-white/50 hover:text-white font-bold text-xs bg-white/10 px-3 py-1.5 rounded-full backdrop-blur-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              <ChevronLeft size={14} /> Back
            </button>
          </div>
        )}
        <div className="relative z-10 flex-1 flex flex-col items-center justify-between p-8 pt-32 pb-12">
          <div className="flex flex-col items-center">
            <div className="w-24 h-24 bg-lime-400 rounded-[2.5rem] flex items-center justify-center shadow-[0_0_60px_rgba(163,230,53,0.3)] mb-8 rotate-6">
              <Users size={40} className="text-black" />
            </div>
            <h1 className="text-4xl font-extrabold text-center tracking-tight mb-4">
              Mediator <span className="text-lime-400">App</span>
            </h1>
            <p className="text-zinc-400 text-center max-w-[260px] text-sm font-medium">
              Publish deals, verify orders, and earn commissions.
            </p>
          </div>
          <div className="w-full space-y-4">
            <button
              onClick={() => setView('login')}
              className="w-full bg-white text-black font-bold py-5 rounded-[2rem] shadow-xl hover:bg-gray-100 transition-all flex items-center justify-center gap-2 text-lg active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              Login <ArrowRight size={20} />
            </button>
            <button
              onClick={() => setView('register')}
              className="w-full bg-zinc-800 text-white font-bold py-5 rounded-[2rem] border border-white/10 hover:bg-zinc-700 transition-all flex items-center justify-center gap-2 text-lg active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              Join an Agency
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white h-full relative px-8 pt-12">
      <button
        onClick={() => setView('splash')}
        className="mb-8 w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      >
        <ArrowRight className="rotate-180" size={20} />
      </button>
      <h2 className="text-3xl font-extrabold text-zinc-900 mb-2">
        {view === 'login' ? 'Welcome Back' : 'Join Team'}
      </h2>
      <p className="text-zinc-500 mb-8">
        {view === 'login' ? 'Login to your workspace.' : 'Enter details to get started.'}
      </p>

      <form onSubmit={view === 'login' ? handleLogin : handleRegister} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 text-red-600 text-sm rounded-xl font-bold text-center">
            {error}
          </div>
        )}

        {view === 'register' && (
          <div className="bg-gray-50 rounded-2xl p-4 flex items-center gap-3 border border-gray-100 focus-within:bg-white focus-within:ring-2 focus-within:ring-lime-400/50 focus-within:border-lime-300 transition-all">
            <User size={20} className="text-gray-400" />
            <input
              type="text"
              placeholder="Full Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-transparent w-full outline-none font-bold text-gray-900"
            />
          </div>
        )}

        <div className="bg-gray-50 rounded-2xl p-4 flex items-center gap-3 border border-gray-100 focus-within:bg-white focus-within:ring-2 focus-within:ring-lime-400/50 focus-within:border-lime-300 transition-all">
          <Phone size={20} className="text-gray-400" />
          <input
            type="tel"
            placeholder="Mobile Number"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            className="bg-transparent w-full outline-none font-bold text-gray-900"
            required
          />
        </div>

        <div className="bg-gray-50 rounded-2xl p-4 flex items-center gap-3 border border-gray-100 focus-within:bg-white focus-within:ring-2 focus-within:ring-lime-400/50 focus-within:border-lime-300 transition-all">
          <Lock size={20} className="text-gray-400" />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="bg-transparent w-full outline-none font-bold text-gray-900"
            required
          />
        </div>

        {view === 'register' && (
          <div className="bg-gray-50 rounded-2xl p-4 flex items-center gap-3 border border-gray-100 focus-within:bg-white focus-within:ring-2 focus-within:ring-lime-400/50 focus-within:border-lime-300 transition-all">
            <CheckCircle size={20} className="text-gray-400" />
            <input
              type="text"
              placeholder="Agency Invite Code"
              value={agencyCode}
              onChange={(e) => setAgencyCode(e.target.value)}
              className="bg-transparent w-full outline-none font-bold text-gray-900 uppercase"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-black text-white py-5 rounded-[2rem] font-bold text-lg mt-4 shadow-lg flex justify-center active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
        >
          {isLoading ? (
            <span className="animate-spin motion-reduce:animate-none w-6 h-6 border-2 border-white/30 border-t-white rounded-full"></span>
          ) : view === 'login' ? (
            'Login'
          ) : (
            'Register'
          )}
        </button>
      </form>
    </div>
  );
};
