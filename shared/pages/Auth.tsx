import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Bot, ArrowRight, Lock, User, Phone, Hash, ChevronLeft } from 'lucide-react';
import { User as UserType } from '../types';

interface AuthScreenProps {
  onBack?: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onBack }) => {
  const [view, setView] = useState<'splash' | 'login' | 'register'>('splash');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [mediatorCode, setMediatorCode] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { login, register } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Basic validation
    if (mobile.length < 10) {
      setError('Please enter a valid mobile number (10 digits).');
      return;
    }

    if (view === 'register') {
      if (!name.trim()) {
        setError('Please enter your full name.');
        return;
      }
      if (!mediatorCode.trim()) {
        setError('Invite Code is required to create an account.');
        return;
      }
    }

    setIsLoading(true);

    try {
      if (view === 'login') {
        // Pre-check role to ensure only Consumers login here
        const userCheck = await api.auth.login(mobile, password);
        const typedUser = userCheck as UserType;
        if (typedUser.role !== 'user') {
          const portal = typedUser.role === 'brand' ? 'Brand Portal' : 'Partner Ops Portal';
          setError(`You are a ${typedUser.role}. Please use the ${portal}.`);
          setIsLoading(false);
          return;
        }
        await login(mobile, password);
      } else {
        await register(name, mobile, password, mediatorCode);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
      setIsLoading(false);
    }
  };

  // 1. Splash Screen (Dark Theme)
  if (view === 'splash') {
    return (
      <div className="flex-1 flex flex-col bg-black text-white relative overflow-hidden h-full pb-[env(safe-area-inset-bottom)]">
        {/* Background Effects */}
        <div className="absolute top-[-20%] right-[-20%] w-[500px] h-[500px] bg-lime-500/20 rounded-full blur-[120px] pointer-events-none animate-pulse motion-reduce:animate-none"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-[300px] h-[300px] bg-indigo-600/20 rounded-full blur-[100px] pointer-events-none"></div>

        {/* Back Navigation */}
        {onBack && (
          <div className="absolute top-6 left-6 z-50">
            <button
              onClick={onBack}
              className="flex items-center gap-2 text-white/50 hover:text-white font-bold text-sm bg-white/10 px-4 py-2 rounded-full backdrop-blur-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              <ChevronLeft size={16} /> Home
            </button>
          </div>
        )}

        {/* Content */}
        <div className="relative z-10 flex-1 flex flex-col items-center justify-between p-8 pt-24 pb-12">
          <div className="flex flex-col items-center">
            <div className="w-24 h-24 bg-gradient-to-br from-lime-300 to-lime-500 rounded-[2.5rem] flex items-center justify-center shadow-[0_0_60px_rgba(132,204,22,0.3)] mb-12 rotate-6 border-t border-white/30 animate-[bounce_3s_infinite_ease-in-out] motion-reduce:animate-none">
              <Bot size={48} className="text-black" />
            </div>

            <h1 className="text-5xl font-extrabold leading-[1] text-center tracking-tight mb-6 drop-shadow-lg">
              Your AI <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-lime-300 to-lime-500">
                Deal Genius
              </span>
            </h1>

            <p className="text-gray-400 text-center max-w-[280px] leading-relaxed text-sm font-medium">
              Smarter shopping starts here. Track orders, find loot deals, and save money.
            </p>
          </div>

          <div className="w-full space-y-5">
            <button
              onClick={() => setView('login')}
              className="w-full bg-white text-black font-bold py-5 rounded-[2rem] shadow-[0_10px_40px_rgba(255,255,255,0.1)] hover:bg-gray-100 transition-all active:scale-[0.98] flex items-center justify-center gap-2 text-lg group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              Get Started
              <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
            </button>
            <p className="text-center text-[10px] text-gray-600 font-bold uppercase tracking-widest">
              Powered by Gemini AI
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 2. Login / Register Form
  return (
    <div className="flex-1 flex flex-col bg-white h-full relative px-8 pt-12 pb-[env(safe-area-inset-bottom)] overflow-y-auto scrollbar-hide">
      <div className="mb-8">
        <button
          onClick={() => setView('splash')}
          className="mb-8 w-12 h-12 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-900 hover:bg-black hover:text-white transition-all active:scale-90 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
        >
          <ArrowRight className="rotate-180" size={24} />
        </button>
        <h2 className="text-4xl font-extrabold text-gray-900 mb-2 tracking-tight">
          {view === 'login' ? 'Welcome Back' : 'Join Mobo'}
        </h2>
        <p className="text-gray-500 text-lg font-medium">
          {view === 'login' ? 'Enter your mobile to sign in.' : 'Create your free account.'}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 fade-in" noValidate>
        {error && (
          <div className="p-4 bg-red-50 text-red-600 text-sm rounded-2xl text-center font-bold border border-red-100">
            {error}
          </div>
        )}

        {view === 'register' && (
          <div className="relative group">
            <div className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-lime-600 transition-colors">
              <User size={20} />
            </div>
            <input
              type="text"
              placeholder="Full Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full pl-12 pr-6 py-4 bg-gray-50 border border-gray-100 rounded-[1.5rem] text-[15px] font-semibold focus:outline-none focus:bg-white focus:ring-2 focus:ring-lime-400/50 focus:border-lime-400 transition-all placeholder:text-gray-400 text-gray-900"
              required
              autoCapitalize="words"
              autoComplete="name"
            />
          </div>
        )}

        <div className="relative group">
          <div className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-lime-600 transition-colors">
            <Phone size={20} />
          </div>
          <input
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="Mobile Number"
            value={mobile}
            onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))} // Only allow numbers
            className="w-full pl-12 pr-6 py-4 bg-gray-50 border border-gray-100 rounded-[1.5rem] text-[15px] font-semibold focus:outline-none focus:bg-white focus:ring-2 focus:ring-lime-400/50 focus:border-lime-400 transition-all placeholder:text-gray-400 text-gray-900"
            required
            autoComplete="tel"
          />
        </div>

        <div className="relative group">
          <div className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-lime-600 transition-colors">
            <Lock size={20} />
          </div>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full pl-12 pr-6 py-4 bg-gray-50 border border-gray-100 rounded-[1.5rem] text-[15px] font-semibold focus:outline-none focus:bg-white focus:ring-2 focus:ring-lime-400/50 focus:border-lime-400 transition-all placeholder:text-gray-400 text-gray-900"
            required
            autoComplete="current-password"
          />
        </div>

        {view === 'register' && (
          <div className="relative group">
            <div className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-lime-600 transition-colors">
              <Hash size={20} />
            </div>
            <input
              type="text"
              placeholder="Invite Code (from Mediator)"
              value={mediatorCode}
              onChange={(e) => setMediatorCode(e.target.value)}
              className="w-full pl-12 pr-6 py-4 bg-gray-50 border border-gray-100 rounded-[1.5rem] text-[15px] font-semibold focus:outline-none focus:bg-white focus:ring-2 focus:ring-lime-400/50 focus:border-lime-400 transition-all placeholder:text-gray-400 text-gray-900"
              autoCapitalize="characters"
              required
            />
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-black text-white font-bold py-5 rounded-[2rem] shadow-xl hover:bg-lime-400 hover:text-black transition-all active:scale-[0.98] mt-6 flex items-center justify-center gap-3 text-[16px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
        >
          {isLoading ? (
            <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin motion-reduce:animate-none"></span>
          ) : (
            <>
              {view === 'login' ? 'Sign In' : 'Create Account'}
              <div className="bg-white/20 rounded-full p-1">
                <ArrowRight size={14} />
              </div>
            </>
          )}
        </button>
      </form>

      <div className="mt-auto text-center pb-8 pt-4">
        <p className="text-gray-400 font-medium text-sm">
          {view === 'login' ? 'New here? ' : 'Have an account? '}
          <button
            onClick={() => {
              setView(view === 'login' ? 'register' : 'login');
              setError('');
              setMobile('');
              setPassword('');
              setMediatorCode('');
            }}
            className="text-black font-bold hover:underline ml-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white rounded"
          >
            {view === 'login' ? 'Create Account' : 'Login'}
          </button>
        </p>
      </div>
    </div>
  );
};
