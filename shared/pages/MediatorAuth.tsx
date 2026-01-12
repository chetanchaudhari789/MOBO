import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
<<<<<<< HEAD
import { Users, ArrowRight, Lock, User, Phone, CheckCircle, ChevronLeft, Clock } from 'lucide-react';
import { Button, Input, Spinner } from '../components/ui';
import { normalizeMobileTo10Digits } from '../utils/mobiles';
=======
import { api } from '../services/api';
import { Users, ArrowRight, Lock, User, Phone, CheckCircle, ChevronLeft } from 'lucide-react';
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176

interface MediatorAuthProps {
  onBack?: () => void;
}

export const MediatorAuthScreen: React.FC<MediatorAuthProps> = ({ onBack }) => {
<<<<<<< HEAD
  const [view, setView] = useState<'splash' | 'login' | 'register' | 'pending'>('splash');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string>('');
=======
  const [view, setView] = useState<'splash' | 'login' | 'register'>('splash');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176

  // Form State
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [agencyCode, setAgencyCode] = useState('');

<<<<<<< HEAD
  const { login, registerOps, logout } = useAuth();
=======
  const { login, registerOps } = useAuth();
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
<<<<<<< HEAD
      const u = await login(mobile, password);
      if (u?.role !== 'mediator') {
        logout();
        setError(`This account is a ${u?.role}. Please use the correct portal.`);
        setIsLoading(false);
        return;
      }
=======
      await login(mobile, password);
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
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
<<<<<<< HEAD
      const result = await registerOps(name, mobile, password, 'mediator', agencyCode.toUpperCase());
      
      // If account is pending approval, show the pending screen (no auto-login)
      if (result && typeof result === 'object' && 'pendingApproval' in result && result.pendingApproval) {
        const msg = (result as any)?.message;
        setPendingMessage(
          typeof msg === 'string' && msg.trim().length
            ? msg
            : 'Request sent to agency for approval. Your account will be activated after approval.'
        );
        setView('pending');
        setIsLoading(false);
        return;
      }
      
      // Otherwise, registration succeeded and user is auto-logged in (handled by registerOps)
=======
      await registerOps(name, mobile, password, 'mediator', agencyCode.toUpperCase());
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
    } catch (err: any) {
      setError(err.message || 'Registration Failed');
      setIsLoading(false);
    }
  };

<<<<<<< HEAD
  if (view === 'pending') {
    return (
      <div className="flex-1 flex flex-col bg-white h-full relative px-8 pt-12">
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={() => {
            setView('splash');
            setPendingMessage('');
          }}
          aria-label="Back"
          className="mb-8 rounded-full"
        >
          <ArrowRight className="rotate-180" size={18} />
        </Button>

        <div className="flex items-start gap-4 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center border border-blue-100">
            <Clock size={22} className="text-blue-700" />
          </div>
          <div>
            <h2 className="text-3xl font-extrabold text-zinc-900">Approval Pending</h2>
            <p className="text-zinc-500 mt-1 font-medium">
              Your request has been sent to the agency.
            </p>
          </div>
        </div>

        <div className="bg-blue-50/60 border border-blue-100 rounded-2xl p-4 text-sm text-blue-900 font-bold">
          {pendingMessage || 'Request sent to agency for approval. Please wait.'}
        </div>

        <div className="mt-6 space-y-3 text-sm text-zinc-600 font-medium">
          <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4">
            <div className="font-extrabold text-zinc-900 mb-1">What happens next?</div>
            <div>Agency will approve or reject your request from their dashboard.</div>
          </div>
          <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4">
            <div className="font-extrabold text-zinc-900 mb-1">After approval</div>
            <div>You can login using your mobile number and password.</div>
          </div>
        </div>

        <div className="mt-8 space-y-3">
          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={() => {
              setView('login');
              setPendingMessage('');
              setError('');
            }}
          >
            Go to Login
          </Button>

          <Button
            type="button"
            size="lg"
            variant="secondary"
            className="w-full"
            onClick={() => {
              setView('register');
              setPendingMessage('');
              setError('');
              setPassword('');
            }}
          >
            Edit Details
          </Button>
        </div>
      </div>
    );
  }

=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
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
<<<<<<< HEAD
      <Button
        type="button"
        variant="secondary"
        size="icon"
        onClick={() => setView('splash')}
        aria-label="Back"
        className="mb-8 rounded-full"
      >
        <ArrowRight className="rotate-180" size={18} />
      </Button>
=======
      <button
        onClick={() => setView('splash')}
        className="mb-8 w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      >
        <ArrowRight className="rotate-180" size={20} />
      </button>
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
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
<<<<<<< HEAD
          <Input
            label="Full Name"
            placeholder="Full Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            leftIcon={<User size={18} />}
            required
            autoCapitalize="words"
            autoComplete="name"
          />
        )}

        <Input
          label="Mobile"
          type="tel"
          placeholder="Mobile Number"
          value={mobile}
          onChange={(e) => setMobile(normalizeMobileTo10Digits(e.target.value))}
          leftIcon={<Phone size={18} />}
          required
          autoComplete="tel"
          inputMode="numeric"
          maxLength={10}
          pattern="[0-9]{10}"
        />

        <Input
          label="Password"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          leftIcon={<Lock size={18} />}
          required
          autoComplete={view === 'login' ? 'current-password' : 'new-password'}
        />

        {view === 'register' && (
          <Input
            label="Agency Code"
            type="text"
            placeholder="Agency Code"
            value={agencyCode}
            onChange={(e) => setAgencyCode(e.target.value)}
            leftIcon={<CheckCircle size={18} />}
            required
            autoCapitalize="characters"
          />
        )}

        <Button type="submit" disabled={isLoading} size="lg" className="w-full mt-4">
          {isLoading ? (
            <span className="flex items-center gap-2">
              <Spinner className="w-5 h-5 text-white" /> Please wait
            </span>
=======
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
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
          ) : view === 'login' ? (
            'Login'
          ) : (
            'Register'
          )}
<<<<<<< HEAD
        </Button>
=======
        </button>
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
      </form>
    </div>
  );
};
