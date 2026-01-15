import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../services/api';
import { subscribeRealtime } from '../services/realtime';
import {
  Camera,
  QrCode,
  CreditCard,
  Save,
  Edit2,
  LogOut,
  TrendingUp,
  ShieldCheck,
  Plus,
  CheckCircle,
  RefreshCcw,
} from 'lucide-react';
import { Order } from '../types';

export const Profile: React.FC = () => {
  const { user, updateUser, logout } = useAuth();
  const { toast } = useToast();

  // Form State
  const [name, setName] = useState(user?.name || '');
  const [mobile, _setMobile] = useState(user?.mobile || '');
  const [upiId, setUpiId] = useState(user?.upiId || '');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Images
  const [avatar, setAvatar] = useState<string | undefined>(user?.avatar);
  const [qrCode, setQrCode] = useState<string | undefined>(user?.qrCode);

  // Stats
  const [orders, setOrders] = useState<Order[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [isStatsLoading, setIsStatsLoading] = useState(false);

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const qrInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) refreshStats();
  }, [user]);

  // Realtime: keep buyer stats in sync across sessions.
  useEffect(() => {
    if (!user) return;
    if (user.role !== 'user') return;

    let timer: any = null;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        refreshStats({ silent: true });
      }, 600);
    };

    const unsub = subscribeRealtime((msg) => {
      if (msg.type === 'orders.changed') schedule();
    });

    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [user]);

  const refreshStats = async (opts?: { silent?: boolean }) => {
    if (!user) return;
    if (isStatsLoading) return;
    setIsStatsLoading(true);
    try {
      const userOrders = await api.orders.getUserOrders(user.id);
      setOrders(userOrders);
      const spent = userOrders
        .filter((o: Order) => o.paymentStatus === 'Paid')
        .reduce((acc: number, o: Order) => acc + o.total, 0);
      setTotalSpent(spent);
    } catch (e) {
      console.error(e);
      if (!opts?.silent) {
        const msg = (e as any)?.message ? String((e as any).message) : 'Failed to refresh wallet stats.';
        toast.error(msg);
      }
    } finally {
      setIsStatsLoading(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'qr') => {
    const file = e.target.files?.[0];
    if (file) {
      if (!isEditing) {
        setIsEditing(true);
        toast.info('Editing enabled — make changes, then tap Save.');
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        if (type === 'avatar') setAvatar(base64);
        else setQrCode(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isSaving) return;
    setIsSaving(true);

    try {
      // Backend profile update does not allow changing mobile via this endpoint.
      await updateUser({ name, upiId, avatar, qrCode });
      toast.success('Profile updated');
      setIsEditing(false);
    } catch (e) {
      toast.error(String((e as any)?.message || 'Failed to update profile'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#F4F4F5] relative overflow-y-auto scrollbar-hide">
      <div className="max-w-xl mx-auto w-full p-6 pb-32 space-y-6">
        {/* Identity Card */}
        <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-zinc-100 relative overflow-hidden animate-enter">
          <div className="flex justify-between items-center mb-8">
            <h3 className="font-extrabold text-xl text-zinc-900">Identity</h3>
            <button
              type="button"
              aria-label={isEditing ? 'Save profile' : 'Edit profile'}
              disabled={isSaving}
              onClick={() => (isEditing ? handleSave() : setIsEditing(true))}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${isEditing ? 'bg-green-100 text-green-600' : 'bg-zinc-50 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900'}`}
            >
              {isEditing ? (
                isSaving ? (
                  <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin motion-reduce:animate-none" />
                ) : (
                  <Save size={18} />
                )
              ) : (
                <Edit2 size={18} />
              )}
            </button>
          </div>

          {/* Avatar Row */}
          <div className="flex items-center gap-6 mb-8">
            <button
              type="button"
              className="relative group cursor-pointer"
              aria-label="Change avatar"
              onClick={() => avatarInputRef.current?.click()}
            >
              <div className="w-24 h-24 rounded-[1.5rem] bg-zinc-100 flex items-center justify-center text-4xl font-black text-zinc-300 shadow-inner overflow-hidden border-4 border-white">
                {avatar ? (
                  <img src={avatar} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  name.charAt(0)
                )}
              </div>
              {isEditing && (
                <div className="absolute inset-0 bg-black/20 flex items-center justify-center rounded-[1.5rem] backdrop-blur-sm">
                  <Camera className="text-white" />
                </div>
              )}
              <input
                type="file"
                ref={avatarInputRef}
                className="hidden"
                accept="image/*"
                onChange={(e) => handleImageUpload(e, 'avatar')}
              />
            </button>
            <div className="flex-1 min-w-0">
              <h2 className="text-2xl font-black text-zinc-900 leading-tight truncate">{name}</h2>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className="px-3 py-1 bg-blue-50 text-blue-600 rounded-lg text-[10px] font-bold border border-blue-100 uppercase tracking-wide">
                  {user?.role}
                </span>
                {user?.isVerifiedByMediator && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-100">
                    <ShieldCheck size={12} /> Verified
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div className="group">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest ml-1 mb-1.5 block">
                Full Name
              </label>
              <input
                type="text"
                disabled={!isEditing}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full p-4 bg-zinc-50 border-none rounded-2xl font-bold text-zinc-900 outline-none focus:ring-2 focus:ring-lime-400 disabled:bg-zinc-50/50 disabled:text-zinc-500 transition-all"
              />
            </div>
            <div className="group">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest ml-1 mb-1.5 block">
                Mobile Number
              </label>
              <input
                type="tel"
                disabled
                value={mobile}
                onChange={() => {}}
                className="w-full p-4 bg-zinc-50 border-none rounded-2xl font-bold text-zinc-900 outline-none focus:ring-2 focus:ring-lime-400 disabled:bg-zinc-50/50 disabled:text-zinc-500 transition-all font-mono"
              />
            </div>
            <div className="group">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest ml-1 mb-1.5 block">
                UPI Address
              </label>
              <div className="relative">
                <input
                  type="text"
                  disabled={!isEditing}
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  className="w-full p-4 bg-zinc-50 border-none rounded-2xl font-bold text-zinc-900 outline-none focus:ring-2 focus:ring-lime-400 disabled:bg-zinc-50/50 disabled:text-zinc-500 transition-all"
                  placeholder="user@upi"
                />
                {!isEditing && upiId && (
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-green-500">
                    <CheckCircle size={16} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Wallet / Treasury Card */}
        <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-zinc-100 flex flex-col animate-slide-up">
          <div className="flex items-center justify-between mb-8">
            <h3 className="font-extrabold text-xl text-zinc-900 flex items-center gap-2">
              <CreditCard size={24} className="text-zinc-300" /> Wallet
            </h3>
            <button
              type="button"
              onClick={() => refreshStats()}
              disabled={isStatsLoading}
              aria-label="Refresh wallet stats"
              className="w-10 h-10 rounded-full bg-zinc-50 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 flex items-center justify-center transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              title={isStatsLoading ? 'Refreshing…' : 'Refresh'}
            >
              <RefreshCcw size={18} className={isStatsLoading ? 'animate-spin motion-reduce:animate-none' : undefined} />
            </button>
          </div>

          <div className="flex-1 flex flex-col justify-center items-center text-center mb-8">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">
              Total Spent
            </p>
            <h2 className="text-5xl font-black text-zinc-900 tracking-tighter">
              {isStatsLoading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block w-5 h-5 border-2 border-current/20 border-t-current rounded-full animate-spin motion-reduce:animate-none" />
                  <span className="text-2xl font-black text-zinc-400">Loading…</span>
                </span>
              ) : (
                `₹${totalSpent.toLocaleString()}`
              )}
            </h2>
            <div className="flex items-center gap-2 mt-4 bg-green-50 text-green-700 px-3 py-1.5 rounded-full text-xs font-bold border border-green-100">
              <TrendingUp size={14} /> +{orders.length} lifetime orders
            </div>
          </div>

          <div className="space-y-3">
            {qrCode ? (
              <button
                type="button"
                className="w-full flex justify-between items-center p-4 bg-zinc-50 rounded-2xl border border-zinc-100 cursor-pointer hover:bg-zinc-100 transition-colors"
                onClick={() => qrInputRef.current?.click()}
                aria-label="Change payment QR"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-zinc-400 shadow-sm">
                    <QrCode size={20} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-900">Payment QR</p>
                    <p className="text-[10px] font-mono text-zinc-400">Linked</p>
                  </div>
                </div>
                {isEditing && (
                  <span className="text-[10px] font-bold text-zinc-400 uppercase">Change</span>
                )}
              </button>
            ) : (
              <button
                type="button"
                className="w-full flex justify-between items-center p-4 bg-zinc-50 rounded-2xl cursor-pointer hover:bg-zinc-100 border border-zinc-100"
                onClick={() => qrInputRef.current?.click()}
                aria-label="Add payment QR"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-zinc-400 shadow-sm">
                    <QrCode size={20} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-900">Add QR Code</p>
                    <p className="text-[10px] text-zinc-400">For refunds</p>
                  </div>
                </div>
                <div className="w-8 h-8 rounded-full bg-white border border-zinc-200 flex items-center justify-center shadow-sm">
                  <Plus size={14} className="text-zinc-500" />
                </div>
              </button>
            )}
            <input
              type="file"
              ref={qrInputRef}
              className="hidden"
              accept="image/*"
              onChange={(e) => handleImageUpload(e, 'qr')}
            />

            {/* Stats Row */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 text-center">
                <p className="text-xl font-black text-zinc-900">
                  {orders.filter((o) => o.paymentStatus === 'Paid').length}
                </p>
                <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">
                  Settled
                </p>
              </div>
              <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 text-center">
                <p className="text-xl font-black text-zinc-900">
                  {orders.filter((o) => o.paymentStatus === 'Pending').length}
                </p>
                <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">
                  Pending
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-zinc-100 animate-slide-up">
          <button
            type="button"
            onClick={logout}
            className="w-full py-4 border-2 border-red-50 text-red-500 font-bold rounded-2xl text-sm hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
          >
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </div>
    </div>
  );
};
