import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
<<<<<<< HEAD
import { Button, Input, Spinner } from '../components/ui';
import { normalizeMobileTo10Digits } from '../utils/mobiles';
=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
import {
  Building2,
  ArrowRight,
  Lock,
  Phone,
  User as UserIcon,
  CheckCircle,
  ChevronLeft,
  Globe,
  Zap,
  ShieldCheck,
} from 'lucide-react';

interface AgencyAuthProps {
  onBack?: () => void;
}

export const AgencyAuthScreen: React.FC<AgencyAuthProps> = ({ onBack }) => {
  const [view, setView] = useState<'splash' | 'login' | 'register'>('splash');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [adminCode, setAdminCode] = useState('');

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
      if (u?.role !== 'agency') {
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
    if (!name || !mobile || !password || !adminCode) {
      setError('All fields required.');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      await registerOps(name, mobile, password, 'agency', adminCode.toUpperCase());
    } catch (err: any) {
      setError(err.message || 'Registration Failed');
      setIsLoading(false);
    }
  };

  if (view === 'splash') {
    return (
      <div className="flex h-screen w-full bg-zinc-950 text-white overflow-hidden relative font-sans">
        {/* Abstract Background */}
        <div className="absolute inset-0 z-0">
          <div className="absolute top-[-10%] left-[-10%] w-[60vw] h-[60vw] bg-purple-500/10 rounded-full blur-[150px] animate-pulse motion-reduce:animate-none"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vw] bg-lime-500/10 rounded-full blur-[150px]"></div>
          <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 brightness-100 contrast-150 mix-blend-overlay"></div>
        </div>

        {/* Content Container */}
        <div className="relative z-10 flex flex-col items-center justify-center w-full h-full p-8">
          {onBack && (
            <button
              onClick={onBack}
              className="absolute top-8 left-8 flex items-center gap-2 text-zinc-400 hover:text-white transition-colors text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 rounded"
            >
              <ChevronLeft size={16} /> Return
            </button>
          )}

          <div className="w-24 h-24 bg-gradient-to-tr from-purple-400 to-indigo-500 rounded-3xl flex items-center justify-center shadow-2xl shadow-purple-500/20 mb-10 rotate-3 border-t border-white/20">
            <Building2 size={40} className="text-white" />
          </div>

          <h1 className="text-7xl font-extrabold text-center tracking-tighter mb-6 bg-clip-text text-transparent bg-gradient-to-b from-white to-white/60">
            Mobo<span className="text-purple-400">Ops</span>
          </h1>

          <p className="text-zinc-400 text-center max-w-lg text-lg leading-relaxed mb-12">
            The workforce management engine. Coordinate mediators, distribute inventory, and track
            network performance.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md">
            <button
              onClick={() => setView('login')}
              className="flex-1 bg-white text-black h-14 rounded-2xl font-bold text-sm hover:bg-zinc-200 transition-all active:scale-[0.98] shadow-lg flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              Enter Portal <ArrowRight size={16} />
            </button>
            <button
              onClick={() => setView('register')}
              className="flex-1 bg-zinc-900/50 backdrop-blur-md text-white border border-white/10 h-14 rounded-2xl font-bold text-sm hover:bg-zinc-800 transition-all active:scale-[0.98] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              Register Agency
            </button>
          </div>

          <div className="mt-12 flex gap-8 text-zinc-500">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest">
              <Globe size={14} /> Network Wide
            </div>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest">
              <Zap size={14} /> Instant Sync
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- SPLIT LAYOUT FOR FORMS ---
  return (
    <div className="flex h-screen w-full bg-white font-sans">
      {/* Left Visual Side */}
      <div className="hidden lg:flex lg:w-1/2 bg-zinc-950 relative overflow-hidden flex-col justify-between p-12 text-white">
        <div className="absolute inset-0 z-0">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40vw] h-[40vw] bg-purple-600/20 rounded-full blur-[120px]"></div>
          <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay"></div>
        </div>

        <div className="relative z-10">
          <button
            onClick={() => setView('splash')}
            className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 rounded"
          >
            <ArrowRight className="rotate-180" size={16} /> Back
          </button>
        </div>

        <div className="relative z-10 mb-12">
          <h2 className="text-5xl font-extrabold tracking-tight mb-6">
            Empower your
            <br />
            sales network.
          </h2>
          <div className="flex gap-3">
            <div className="bg-white/10 backdrop-blur-md px-4 py-2 rounded-lg border border-white/5 text-sm font-medium">
              🚀 Fast Distribution
            </div>
            <div className="bg-white/10 backdrop-blur-md px-4 py-2 rounded-lg border border-white/5 text-sm font-medium">
              👥 Team Mgmt
            </div>
          </div>
        </div>
      </div>

      {/* Right Form Side */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-zinc-50">
        <div className="w-full max-w-md bg-white p-10 rounded-[2rem] shadow-xl border border-zinc-100">
          <div className="mb-8">
            <div className="w-12 h-12 bg-purple-600 rounded-xl flex items-center justify-center mb-4 shadow-lg shadow-purple-500/30 text-white">
              <Building2 size={24} />
            </div>
            <h2 className="text-2xl font-extrabold text-zinc-900 tracking-tight">
              {view === 'login' ? 'Agency Login' : 'New Agency'}
            </h2>
            <p className="text-zinc-500 text-sm mt-1">
              {view === 'login'
                ? 'Secure access for operation managers.'
                : 'Register your agency with an admin code.'}
            </p>
          </div>

          <form onSubmit={view === 'login' ? handleLogin : handleRegister} className="space-y-4">
            {error && (
              <div className="p-4 bg-red-50 text-red-600 text-xs font-bold rounded-xl flex items-center gap-2 border border-red-100">
                ⚠️ {error}
              </div>
            )}

            {view === 'register' && (
<<<<<<< HEAD
              <Input
                label="Agency Name"
                placeholder="e.g. Alpha Growth"
                value={name}
                onChange={(e) => setName(e.target.value)}
                leftIcon={<UserIcon size={18} />}
                required
                autoCapitalize="words"
              />
            )}

            <Input
              label="Mobile"
              type="tel"
              inputMode="numeric"
              placeholder="9000000000"
              value={mobile}
              onChange={(e) => setMobile(normalizeMobileTo10Digits(e.target.value))}
              maxLength={10}
              pattern="[0-9]{10}"
              leftIcon={<Phone size={18} />}
              required
              autoComplete="tel"
            />

            <Input
              label="Password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              leftIcon={<Lock size={18} />}
              required
              autoComplete={view === 'login' ? 'current-password' : 'new-password'}
            />

            {view === 'register' && (
              <Input
                label="Admin Invite Code"
                type="text"
                placeholder="ADMIN-XXXX"
                value={adminCode}
                onChange={(e) => setAdminCode(e.target.value.toUpperCase())}
                leftIcon={<ShieldCheck size={18} />}
                className="font-mono tracking-widest uppercase"
                required
                autoCapitalize="characters"
              />
            )}

            <Button
              type="submit"
              disabled={isLoading}
              size="lg"
              className="w-full mt-6 bg-black text-white hover:bg-purple-600 hover:text-white focus-visible:ring-purple-300"
              rightIcon={
                isLoading ? (
                  <Spinner className="w-5 h-5 text-current" />
                ) : view === 'login' ? (
                  <ArrowRight size={16} />
                ) : (
                  <CheckCircle size={16} />
                )
              }
            >
              {view === 'login' ? 'Login to Ops' : 'Initialize Agency'}
            </Button>
=======
              <div className="group">
                <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-1.5 block">
                  Agency Name
                </label>
                <div className="relative">
                  <UserIcon
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400"
                    size={18}
                  />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full pl-11 pr-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-xl font-bold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white transition-all"
                    placeholder="e.g. Alpha Growth"
                  />
                </div>
              </div>
            )}

            <div className="group">
              <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-1.5 block">
                Mobile Access ID
              </label>
              <div className="relative">
                <Phone
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400"
                  size={18}
                />
                <input
                  type="tel"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  className="w-full pl-11 pr-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-xl font-bold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white transition-all"
                  placeholder="9000000000"
                />
              </div>
            </div>

            <div className="group">
              <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-1.5 block">
                Password
              </label>
              <div className="relative">
                <Lock
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400"
                  size={18}
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-xl font-bold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white transition-all"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {view === 'register' && (
              <div className="group pt-2">
                <div className="bg-zinc-900 p-5 rounded-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-20 h-20 bg-purple-500/20 rounded-full -mr-6 -mt-6 blur-xl"></div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">
                    Admin Invite Code
                  </label>
                  <div className="flex items-center gap-3">
                    <ShieldCheck size={20} className="text-purple-400" />
                    <input
                      type="text"
                      placeholder="ADMIN-XXXX"
                      value={adminCode}
                      onChange={(e) => setAdminCode(e.target.value.toUpperCase())}
                      className="bg-transparent w-full outline-none font-mono text-xl font-bold text-white placeholder:text-zinc-700 tracking-widest uppercase"
                    />
                  </div>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-black text-white h-14 rounded-xl font-bold text-sm mt-6 shadow-xl hover:bg-purple-600 hover:text-white transition-all active:scale-[0.98] flex justify-center items-center gap-2 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            >
              {isLoading ? (
                <span className="animate-spin motion-reduce:animate-none w-5 h-5 border-2 border-current border-t-transparent rounded-full"></span>
              ) : view === 'login' ? (
                <>
                  Login to Ops{' '}
                  <ArrowRight
                    size={16}
                    className="group-hover:translate-x-1 transition-transform"
                  />
                </>
              ) : (
                <>
                  Initialize Agency <CheckCircle size={16} />
                </>
              )}
            </button>
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
          </form>

          <p className="text-center mt-6 text-xs text-zinc-400 font-medium">
            {view === 'login' ? 'Need to setup a new agency?' : 'Already verified?'}
            <button
              onClick={() => setView(view === 'login' ? 'register' : 'login')}
              className="text-black font-bold ml-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white rounded"
            >
              {view === 'login' ? 'Register Here' : 'Login Here'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};
