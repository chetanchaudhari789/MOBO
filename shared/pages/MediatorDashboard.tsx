import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { User, Campaign, Order, Ticket } from '../types';
import {
  LayoutGrid,
  Tag,
  Users,
  Wallet,
  ArrowUpRight,
  X,
  Check,
  Eye,
  Send,
  Copy,
  CheckCircle2,
  ChevronRight,
  Bell,
  TrendingUp,
  Link as LinkIcon,
  Star,
  CreditCard,
  Phone,
  Calendar,
  ShoppingBag,
  FileText,
  ExternalLink,
  ShieldCheck,
  IndianRupee,
  History,
  RefreshCcw,
  ArrowRightLeft,
  Filter,
  Download,
  QrCode,
  User as UserIcon,
  LogOut,
  Save,
  Camera,
  Building,
  CalendarClock,
  AlertTriangle,
  Sparkles,
  Loader2,
} from 'lucide-react';

// --- UTILS ---
const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);

const urlToBase64 = async (url: string): Promise<string> => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    return '';
  }
};

// --- COMPONENTS ---

const TabButton = ({ icon: Icon, label, active, onClick, badge }: any) => (
  <button
    onClick={onClick}
    aria-pressed={!!active}
    className={`flex flex-col items-center gap-1 min-w-[50px] transition-all duration-300 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#CCF381] focus-visible:ring-offset-2 focus-visible:ring-offset-[#18181B] rounded-xl motion-reduce:transition-none motion-reduce:transform-none ${
      active ? '-translate-y-1' : 'hover:-translate-y-0.5'
    }`}
  >
    <div
      className={`p-2.5 rounded-[1rem] transition-all relative ${
        active
          ? 'bg-[#CCF381] text-black shadow-[0_4px_12px_-4px_rgba(204,243,129,0.6)] scale-105'
          : 'bg-transparent text-zinc-500 hover:text-zinc-300'
      }`}
    >
      <Icon size={20} strokeWidth={active ? 2.5 : 2} />
      {badge > 0 && (
        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 text-white text-[9px] font-bold flex items-center justify-center rounded-full border border-[#18181B]">
          {badge}
        </span>
      )}
    </div>
    <span
      className={`text-[9px] font-bold tracking-wide ${active ? 'text-[#CCF381] opacity-100' : 'text-zinc-500 opacity-0 scale-0 group-hover:opacity-100 group-hover:scale-100'} transition-all duration-300`}
    >
      {label}
    </span>
  </button>
);

// --- VIEWS ---

const InboxView = ({ orders, pendingUsers, tickets, onRefresh, onViewProof }: any) => {
  // Only 'Unchecked' require action. 'Pending_Cooling' are just waiting.
  const actionRequiredOrders = orders.filter((o: Order) => o.affiliateStatus === 'Unchecked');
  const coolingOrders = orders.filter((o: Order) => o.affiliateStatus === 'Pending_Cooling');

  // Identify disputed orders
  const disputedOrderIds = new Set(
    tickets.filter((t: Ticket) => t.status === 'Open').map((t: Ticket) => t.orderId)
  );

  const [viewMode, setViewMode] = useState<'todo' | 'cooling'>('todo');

  const todayEarnings = orders
    .filter((o: Order) => new Date(o.createdAt).toDateString() === new Date().toDateString())
    .reduce((acc: number, o: Order) => acc + (o.items[0]?.commission || 0), 0);

  const getDealTypeBadge = (dealType: string) => {
    switch (dealType) {
      case 'Rating':
        return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'Review':
        return 'bg-purple-100 text-purple-700 border-purple-200';
      default:
        return 'bg-blue-100 text-blue-700 border-blue-200';
    }
  };

  return (
    <div className="space-y-6 animate-enter pb-28">
      {/* Header Stats */}
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide px-1 snap-x">
        <div className="min-w-[150px] bg-[#18181B] p-4 rounded-[1.5rem] shadow-xl relative overflow-hidden snap-center flex-1">
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#CCF381]/10 rounded-full blur-2xl -mr-6 -mt-6"></div>
          <div className="relative z-10">
            <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mb-1">
              Today's Profit
            </p>
            <h2 className="text-3xl font-black text-[#CCF381] tracking-tighter leading-none">
              {formatCurrency(todayEarnings).replace('₹', '₹')}
            </h2>
          </div>
        </div>

        <div className="min-w-[130px] bg-white border border-zinc-100 p-4 rounded-[1.5rem] shadow-sm relative overflow-hidden snap-center">
          <p className="text-zinc-400 text-[10px] font-black uppercase tracking-widest mb-1">
            Pending Actions
          </p>
          <h2 className="text-3xl font-black text-zinc-900 tracking-tighter leading-none">
            {actionRequiredOrders.length + pendingUsers.length}
          </h2>
        </div>
      </div>

      {/* New Joiners */}
      {pendingUsers.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3 px-1">
            <h3 className="font-bold text-base text-zinc-900 tracking-tight">New Joiners</h3>
            <span className="bg-orange-100 text-orange-700 text-[9px] font-bold px-2 py-0.5 rounded-full">
              {pendingUsers.length} requests
            </span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide px-1 snap-x">
            {pendingUsers.map((u: User) => (
              <div
                key={u.id}
                className="min-w-[220px] bg-white p-3 rounded-[1.2rem] border border-zinc-100 shadow-sm flex items-center justify-between snap-center"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-100 text-orange-600 rounded-[0.8rem] flex items-center justify-center font-black text-sm shadow-inner">
                    {u.name.charAt(0)}
                  </div>
                  <div>
                    <h4 className="font-bold text-zinc-900 text-xs line-clamp-1">{u.name}</h4>
                    <p className="text-[10px] text-zinc-400 font-mono tracking-wide">{u.mobile}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => api.ops.approveUser(u.id).then(onRefresh)}
                    className="w-8 h-8 rounded-lg bg-zinc-900 text-white flex items-center justify-center hover:bg-[#CCF381] hover:text-black transition-all shadow-md active:scale-90"
                  >
                    <Check size={14} strokeWidth={3} />
                  </button>
                  <button
                    onClick={() => api.ops.rejectUser(u.id).then(onRefresh)}
                    className="w-8 h-8 rounded-lg bg-zinc-50 text-zinc-400 flex items-center justify-center hover:bg-red-50 hover:text-red-500 transition-all active:scale-90"
                  >
                    <X size={14} strokeWidth={3} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Order Verification Section */}
      <section>
        <div className="flex gap-2 mb-4 bg-zinc-100 p-1 rounded-xl">
          <button
            onClick={() => setViewMode('todo')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${viewMode === 'todo' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
          >
            Verify ({actionRequiredOrders.length})
          </button>
          <button
            onClick={() => setViewMode('cooling')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${viewMode === 'cooling' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
          >
            Cooling Period ({coolingOrders.length})
          </button>
        </div>

        {(viewMode === 'todo' ? actionRequiredOrders : coolingOrders).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 bg-white rounded-[1.5rem] border border-dashed border-zinc-200">
            <div className="w-14 h-14 bg-zinc-50 rounded-full flex items-center justify-center mb-3 shadow-inner">
              {viewMode === 'todo' ? (
                <CheckCircle2 size={24} className="text-zinc-300" />
              ) : (
                <CalendarClock size={24} className="text-zinc-300" />
              )}
            </div>
            <p className="text-zinc-400 font-bold text-xs">
              {viewMode === 'todo' ? 'No orders to verify.' : 'No orders in cooling.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {(viewMode === 'todo' ? actionRequiredOrders : coolingOrders).map((o: Order) => {
              const dealType = o.items[0].dealType || 'Discount';
              const settleDate = o.expectedSettlementDate
                ? new Date(o.expectedSettlementDate).toDateString()
                : 'N/A';
              const isDisputed = disputedOrderIds.has(o.id);

              return (
                <div
                  key={o.id}
                  className={`bg-white p-2 rounded-[1.5rem] border shadow-sm relative overflow-hidden group hover:shadow-md transition-all duration-300 ${isDisputed ? 'border-red-200 ring-2 ring-red-100' : 'border-zinc-100'}`}
                >
                  {isDisputed && (
                    <div className="absolute top-0 right-0 bg-red-500 text-white text-[9px] font-bold px-2 py-1 rounded-bl-xl z-20 flex items-center gap-1">
                      <AlertTriangle size={10} /> DISPUTED
                    </div>
                  )}
                  <div className="p-2 pb-0 flex gap-3 mb-3">
                    <div className="w-14 h-14 bg-[#F4F4F5] rounded-[1rem] p-1.5 flex-shrink-0 relative overflow-hidden">
                      <img
                        src={o.items[0].image}
                        className="w-full h-full object-contain mix-blend-multiply relative z-10"
                      />
                    </div>
                    <div className="min-w-0 flex-1 py-0.5">
                      <div className="flex justify-between items-start">
                        <h4 className="font-bold text-zinc-900 text-sm line-clamp-1 pr-2">
                          {o.items[0].title}
                        </h4>
                        <span
                          className={`text-[9px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap uppercase border ${getDealTypeBadge(dealType)}`}
                        >
                          {dealType === 'Discount' ? 'Purchase' : dealType}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <span className="font-semibold text-zinc-400">Buyer:</span>
                          <span className="font-bold text-zinc-900 truncate max-w-[80px]">
                            {o.buyerName}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-[11px]">
                          <span className="font-black text-zinc-900">
                            {formatCurrency(o.total)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {viewMode === 'todo' ? (
                    <div className="grid grid-cols-1 p-1 pt-0">
                      <button
                        onClick={() => !isDisputed && onViewProof(o)}
                        disabled={isDisputed}
                        className={`py-3 rounded-[1rem] font-bold text-xs flex items-center justify-center gap-2 transition-all active:scale-95 ${
                          isDisputed
                            ? 'bg-red-50 text-red-400 cursor-not-allowed'
                            : 'bg-[#18181B] text-white hover:bg-[#CCF381] hover:text-black hover:shadow-md'
                        }`}
                      >
                        {isDisputed ? (
                          <>
                            <ShieldCheck size={16} /> Locked by Dispute
                          </>
                        ) : (
                          <>
                            <ShieldCheck size={16} /> Verify Proofs
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className="bg-zinc-50 p-2 mx-1 mb-1 rounded-xl flex justify-between items-center px-3">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide flex items-center gap-1">
                        <CalendarClock size={12} /> Unlocks
                      </span>
                      <span className="text-xs font-bold text-zinc-900">{settleDate}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

const MarketView = ({ campaigns, user, onRefresh, onPublish }: any) => {
  return (
    <div className="space-y-5 animate-enter pb-28">
      <div className="bg-[#18181B] p-5 rounded-[1.5rem] shadow-xl text-white relative overflow-hidden">
        <div className="absolute top-[-50%] right-[-10%] w-40 h-40 bg-[#CCF381] rounded-full blur-[60px] opacity-20 animate-pulse"></div>
        <div className="relative z-10">
          <h2 className="text-xl font-black mb-1 tracking-tight">Inventory Deck</h2>
          <p className="text-zinc-400 text-xs font-medium">Select a campaign to publish a deal.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {campaigns.length === 0 ? (
          <div className="text-center py-16">
            <Tag size={32} className="mx-auto text-zinc-200 mb-3" />
            <p className="text-zinc-400 text-sm font-bold">No Inventory Assigned</p>
          </div>
        ) : (
          campaigns.map((c: Campaign) => (
            <div
              key={c.id}
              className="bg-white p-4 rounded-[1.5rem] border border-zinc-100 shadow-sm flex flex-col relative overflow-hidden hover:shadow-lg transition-all duration-300"
            >
              <div className="flex gap-4 mb-4">
                <div className="w-16 h-16 bg-[#F4F4F5] rounded-[1rem] p-2 flex-shrink-0">
                  <img src={c.image} className="w-full h-full object-contain mix-blend-multiply" />
                </div>
                <div className="flex-1 min-w-0 py-0.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest border border-zinc-100 px-1.5 py-0.5 rounded-md">
                      {c.platform}
                    </span>
                    <span className="bg-[#CCF381]/20 text-[#5f7a28] text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wide">
                      {c.assignments[user.mediatorCode!] || 0} Slots
                    </span>
                  </div>
                  <h4 className="font-bold text-zinc-900 text-base leading-tight line-clamp-1 mb-2">
                    {c.title}
                  </h4>
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                      Cost
                    </p>
                    <p className="text-sm font-black text-zinc-900">{formatCurrency(c.price)}</p>
                  </div>
                </div>
              </div>

              <button
                onClick={() => onPublish(c)}
                className="w-full py-3 bg-[#18181B] text-white rounded-[1rem] font-bold text-xs hover:bg-[#CCF381] hover:text-black transition-all shadow-md active:scale-95 flex items-center justify-center gap-1.5"
              >
                <ArrowUpRight size={14} strokeWidth={2.5} /> Configure & Publish
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const SquadView = ({ user, pendingUsers, verifiedUsers, orders, onRefresh, onSelectUser }: any) => {
  return (
    <div className="space-y-5 animate-enter pb-28">
      <div
        className="bg-[#4F46E5] p-5 rounded-[1.5rem] shadow-xl shadow-indigo-500/20 text-white relative overflow-hidden group active:scale-[0.98] transition-transform cursor-pointer"
        onClick={() => {
          navigator.clipboard.writeText(user.mediatorCode!);
          alert('Code Copied!');
        }}
      >
        <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white rounded-full blur-[60px] opacity-20 group-hover:opacity-30 transition-opacity"></div>
        <div className="relative z-10 flex flex-col items-center text-center">
          <p className="text-indigo-200 text-[10px] font-black uppercase tracking-widest mb-1">
            Your Invite Code
          </p>
          <h2 className="text-3xl font-black tracking-widest font-mono mb-3">
            {user.mediatorCode}
          </h2>
          <div className="bg-white/10 backdrop-blur-md px-4 py-2 rounded-xl text-[10px] font-bold flex items-center gap-1.5 hover:bg-white/20 transition-colors border border-white/10">
            <Copy size={12} /> Tap to Copy
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white p-4 rounded-[1.2rem] border border-zinc-100 shadow-sm text-center hover:shadow-md transition-shadow">
          <p className="text-2xl font-black text-zinc-900 mb-0.5">{verifiedUsers.length}</p>
          <p className="text-[9px] text-zinc-400 font-black uppercase tracking-widest">
            Active Buyers
          </p>
        </div>
        <div className="bg-white p-4 rounded-[1.2rem] border border-zinc-100 shadow-sm text-center hover:shadow-md transition-shadow">
          <p className="text-2xl font-black text-zinc-900 mb-0.5">{pendingUsers.length}</p>
          <p className="text-[9px] text-zinc-400 font-black uppercase tracking-widest">Pending</p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <h3 className="font-bold text-base text-zinc-900 tracking-tight">Active Roster</h3>
        </div>
        <div className="bg-white rounded-[1.5rem] border border-zinc-100 shadow-sm overflow-hidden min-h-[160px]">
          {verifiedUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-8">
              <Users size={24} className="text-zinc-200 mb-2" />
              <p className="text-zinc-400 font-bold text-xs">No active buyers yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-50">
              {verifiedUsers.map((u: User) => (
                <div
                  key={u.id}
                  onClick={() => onSelectUser(u)}
                  className="p-3 flex items-center justify-between hover:bg-zinc-50 transition-colors cursor-pointer active:bg-zinc-100"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-zinc-100 rounded-[0.8rem] flex items-center justify-center font-black text-zinc-500 text-sm">
                      {u.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-bold text-xs text-zinc-900">{u.name}</p>
                      <p className="text-[10px] text-zinc-400 font-mono">{u.mobile}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-[10px] font-bold text-zinc-400">Wallet</p>
                      <p className="text-xs font-black text-zinc-900">
                        {formatCurrency(u.walletBalance || 0)}
                      </p>
                    </div>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center border border-zinc-100 bg-white text-zinc-400">
                      <ArrowRightLeft size={14} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const MediatorProfileView = () => {
  const { user, updateUser, logout } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [mobile, setMobile] = useState(user?.mobile || '');
  const [upiId, setUpiId] = useState(user?.upiId || '');
  const [bankDetails, setBankDetails] = useState({
    accountNumber: user?.bankDetails?.accountNumber || '',
    ifsc: user?.bankDetails?.ifsc || '',
    bankName: user?.bankDetails?.bankName || '',
    holderName: user?.bankDetails?.holderName || '',
  });
  const [avatar, setAvatar] = useState(user?.avatar);
  const [qrCode, setQrCode] = useState(user?.qrCode);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qrInputRef = useRef<HTMLInputElement>(null);

  const handleSave = async () => {
    setLoading(true);
    try {
      await updateUser({
        name,
        mobile,
        upiId,
        bankDetails,
        avatar,
        qrCode,
      });
      setIsEditing(false);
      alert('Profile Updated Successfully!');
    } catch (e) {
      alert('Update Failed');
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'qr') => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (type === 'avatar') setAvatar(reader.result as string);
        else setQrCode(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="animate-enter pb-28">
      <div className="flex flex-col items-center pt-6 pb-8 bg-white rounded-b-[2.5rem] shadow-sm mb-6 border border-zinc-100">
        <div
          className="relative mb-4 group cursor-pointer"
          onClick={() => isEditing && fileInputRef.current?.click()}
        >
          <div className="w-24 h-24 rounded-full bg-zinc-100 border-4 border-white shadow-lg flex items-center justify-center overflow-hidden">
            {avatar ? (
              <img src={avatar} className="w-full h-full object-cover" />
            ) : (
              <UserIcon size={32} className="text-zinc-300" />
            )}
          </div>
          {isEditing && (
            <div className="absolute bottom-0 right-0 bg-black text-white p-2 rounded-full border border-white shadow-md">
              <Camera size={14} />
            </div>
          )}
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*"
            onChange={(e) => handleImageUpload(e, 'avatar')}
          />
        </div>
        <h2 className="text-xl font-black text-zinc-900">{user?.name}</h2>
        <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mt-1">
          Mediator • {user?.mediatorCode}
        </p>
      </div>

      <div className="px-4 space-y-6">
        <div className="bg-white p-6 rounded-[2rem] border border-zinc-100 shadow-sm space-y-4">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-bold text-zinc-900 flex items-center gap-2">
              <UserIcon size={16} /> Personal Info
            </h3>
            <button
              onClick={() => setIsEditing(!isEditing)}
              className="text-xs font-bold text-lime-600 uppercase hover:underline"
            >
              {isEditing ? 'Cancel' : 'Edit'}
            </button>
          </div>
          <div>
            <label className="text-[10px] font-bold text-zinc-400 uppercase ml-1 block mb-1">
              Full Name
            </label>
            <input
              type="text"
              disabled={!isEditing}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-3 bg-zinc-50 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-lime-400 disabled:opacity-70 disabled:bg-transparent disabled:border disabled:border-zinc-100"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-zinc-400 uppercase ml-1 block mb-1">
              Mobile Number
            </label>
            <input
              type="tel"
              disabled={!isEditing}
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              className="w-full p-3 bg-zinc-50 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-lime-400 disabled:opacity-70 disabled:bg-transparent disabled:border disabled:border-zinc-100"
            />
          </div>
        </div>

        <div className="bg-white p-6 rounded-[2rem] border border-zinc-100 shadow-sm space-y-4">
          <h3 className="font-bold text-zinc-900 flex items-center gap-2 mb-2">
            <Wallet size={16} /> Banking & Payments
          </h3>
          <div>
            <label className="text-[10px] font-bold text-zinc-400 uppercase ml-1 block mb-1">
              UPI ID
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                disabled={!isEditing}
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                className="w-full p-3 bg-zinc-50 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-lime-400 disabled:opacity-70 disabled:bg-transparent disabled:border disabled:border-zinc-100"
                placeholder="user@upi"
              />
            </div>
          </div>
          <div
            onClick={() => isEditing && qrInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center text-center transition-colors ${isEditing ? 'cursor-pointer hover:border-lime-400 hover:bg-lime-50' : 'border-zinc-100'}`}
          >
            {qrCode ? (
              <div className="relative">
                <img src={qrCode} className="h-32 w-32 object-contain rounded-lg" />
                {isEditing && (
                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center text-white font-bold text-xs rounded-lg">
                    Change
                  </div>
                )}
              </div>
            ) : (
              <div className="py-4">
                <QrCode size={32} className="text-zinc-300 mx-auto mb-2" />
                <p className="text-xs font-bold text-zinc-400">Upload Payment QR</p>
              </div>
            )}
            <input
              type="file"
              ref={qrInputRef}
              className="hidden"
              accept="image/*"
              onChange={(e) => handleImageUpload(e, 'qr')}
            />
          </div>
        </div>

        {isEditing ? (
          <button
            onClick={handleSave}
            disabled={loading}
            className="w-full py-4 bg-lime-400 text-black font-extrabold rounded-2xl shadow-lg hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              'Saving...'
            ) : (
              <>
                <Save size={18} /> Save Changes
              </>
            )}
          </button>
        ) : (
          <button
            onClick={logout}
            className="w-full py-4 bg-zinc-900 text-white font-bold rounded-2xl shadow-lg hover:bg-red-600 transition-colors flex items-center justify-center gap-2"
          >
            <LogOut size={18} /> Logout
          </button>
        )}
      </div>
    </div>
  );
};

const LedgerModal = ({ buyer, orders, onClose, onRefresh }: any) => {
  const [viewMode, setViewMode] = useState<'pending' | 'settled'>('pending');
  const [settleId, setSettleId] = useState<string | null>(null);
  const [utr, setUtr] = useState('');
  const [showQr, setShowQr] = useState(false);

  const pendingOrders = orders
    .filter((o: any) => o.paymentStatus === 'Pending' || o.affiliateStatus === 'Pending_Cooling')
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const settledOrders = orders
    .filter((o: any) => o.paymentStatus === 'Paid')
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const totalLiability = pendingOrders.reduce((acc: any, o: any) => acc + o.total, 0);
  const totalPaid = settledOrders.reduce((acc: any, o: any) => acc + o.total, 0);

  const handleSettle = async () => {
    if (!settleId) return;
    try {
      await api.ops.settleOrderPayment(settleId, utr.trim() || undefined);
      setSettleId(null);
      setUtr('');
      onRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to settle';
      alert(msg);
    }
  };

  const handleRevert = async (orderId: string) => {
    if (confirm('Undo settlement?')) {
      try {
        await api.ops.verifyOrderClaim(orderId);
        onRefresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to undo';
        alert(msg);
      }
    }
  };

  return (
    <div
      className="absolute inset-0 z-[60] bg-black/60 backdrop-blur-md flex items-end animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-[#F8F9FA] w-full rounded-t-[2.5rem] h-[92%] shadow-2xl animate-slide-up relative flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-none p-5 bg-[#18181B] rounded-t-[2.5rem] text-white pb-8">
          <div className="w-12 h-1.5 bg-white/20 rounded-full mx-auto mb-6"></div>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-[0.8rem] bg-white/10 flex items-center justify-center font-bold text-sm">
                {buyer.name.charAt(0)}
              </div>
              <div>
                <h3 className="text-xl font-black leading-none">{buyer.name}</h3>
                <p className="text-[10px] text-zinc-400 font-mono mt-1 opacity-80">
                  {buyer.mobile}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#CCF381] p-4 rounded-[1.5rem] text-black shadow-lg">
              <p className="text-[9px] font-black uppercase tracking-widest opacity-60 mb-1">
                Total Payable
              </p>
              <h2 className="text-3xl font-black tracking-tighter leading-none">
                {formatCurrency(totalLiability)}
              </h2>
            </div>
            <div className="bg-white/5 border border-white/10 p-4 rounded-[1.5rem]">
              <p className="text-[9px] font-black uppercase tracking-widest text-zinc-400 mb-1">
                Total Settled
              </p>
              <h2 className="text-2xl font-black tracking-tighter leading-none text-white">
                {formatCurrency(totalPaid)}
              </h2>
            </div>
          </div>
        </div>

        <div className="flex-none px-5 -mt-6 relative z-10">
          <div className="bg-white p-4 rounded-[1.5rem] shadow-lg border border-zinc-100 flex items-center justify-between">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <CreditCard size={20} />
              </div>
              <div className="min-w-0">
                <p className="text-[9px] font-bold text-zinc-400 uppercase">UPI Address</p>
                <p className="font-bold text-zinc-900 text-sm truncate">
                  {buyer.upiId || 'Not Linked'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {buyer.qrCode && (
                <button
                  onClick={() => setShowQr(true)}
                  className="p-2 hover:bg-indigo-50 text-indigo-400 hover:text-indigo-600 rounded-lg transition-colors"
                >
                  <QrCode size={18} />
                </button>
              )}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(buyer.upiId || '');
                  alert('Copied');
                }}
                className="p-2 hover:bg-zinc-50 rounded-lg text-zinc-400 hover:text-zinc-900 transition-colors"
              >
                <Copy size={18} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0 pt-6">
          <div className="px-5 mb-4 flex items-center gap-2">
            <button
              onClick={() => setViewMode('pending')}
              className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${viewMode === 'pending' ? 'bg-black text-white shadow-md' : 'bg-white text-zinc-500 border border-zinc-200'}`}
            >
              Unsettled ({pendingOrders.length})
            </button>
            <button
              onClick={() => setViewMode('settled')}
              className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${viewMode === 'settled' ? 'bg-black text-white shadow-md' : 'bg-white text-zinc-500 border border-zinc-200'}`}
            >
              History ({settledOrders.length})
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-3 scrollbar-hide">
            {(viewMode === 'pending' ? pendingOrders : settledOrders).length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-zinc-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <FileText size={24} className="text-zinc-300" />
                </div>
                <p className="text-zinc-400 font-bold text-xs">No records found.</p>
              </div>
            ) : (
              (viewMode === 'pending' ? pendingOrders : settledOrders).map((o: any) => (
                <div
                  key={o.id}
                  className="bg-white p-4 rounded-[1.5rem] border border-zinc-100 shadow-sm flex flex-col group transition-all hover:shadow-md"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-zinc-50 rounded-[0.8rem] p-1.5 flex-shrink-0">
                        <img
                          src={o.items[0].image}
                          className="w-full h-full object-contain mix-blend-multiply"
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-zinc-400">
                            #{o.id.slice(-6)}
                          </span>
                          <span className="text-[9px] font-bold uppercase bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded">
                            {o.items[0].dealType}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-zinc-900 line-clamp-1">
                          {o.items[0].title}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-black text-zinc-900">{formatCurrency(o.total)}</p>
                      <p className="text-[9px] font-bold text-zinc-400">
                        {new Date(o.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 mt-1 border-t border-zinc-50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${viewMode === 'pending' ? 'bg-orange-500' : 'bg-green-500'}`}
                      ></span>
                      <span className="text-[10px] font-bold uppercase text-zinc-500">
                        {viewMode === 'pending' ? 'Processing' : 'Settled'}
                      </span>
                    </div>

                    {viewMode === 'pending' && (
                      <button
                        onClick={() => setSettleId(o.id)}
                        className="px-4 py-2 bg-black text-white rounded-xl text-[10px] font-bold hover:bg-zinc-800 transition-colors active:scale-95 flex items-center gap-1"
                      >
                        Settle <ChevronRight size={12} />
                      </button>
                    )}
                    {viewMode === 'settled' && (
                      <button
                        onClick={() => handleRevert(o.id)}
                        className="text-[10px] font-bold text-zinc-400 hover:text-red-500 flex items-center gap-1 transition-colors"
                      >
                        <RefreshCcw size={10} /> Revert
                      </button>
                    )}
                  </div>

                  {settleId === o.id && (
                    <div className="mt-3 p-3 bg-zinc-50 rounded-xl animate-enter">
                      <input
                        autoFocus
                        type="text"
                        placeholder="Enter UTR / Ref ID (Optional)"
                        value={utr}
                        onChange={(e) => setUtr(e.target.value)}
                        className="w-full bg-white border border-zinc-200 p-2.5 rounded-lg text-xs font-bold outline-none focus:border-black mb-2"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => setSettleId(null)}
                          className="flex-1 py-2 bg-white border border-zinc-200 rounded-lg text-[10px] font-bold hover:bg-zinc-100"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSettle}
                          className="flex-1 py-2 bg-[#CCF381] text-black rounded-lg text-[10px] font-black hover:brightness-90 shadow-sm"
                        >
                          Confirm Payment
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {showQr && buyer.qrCode && (
        <div
          className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in"
          onClick={() => setShowQr(false)}
        >
          <div
            className="bg-white p-6 rounded-[2rem] shadow-2xl relative w-full max-w-[280px] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowQr(false)}
              className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-900"
            >
              <X size={20} />
            </button>
            <h3 className="font-bold text-lg text-zinc-900 mb-4">Payment QR</h3>
            <div className="p-2 border-2 border-dashed border-zinc-200 rounded-xl mb-4">
              <img src={buyer.qrCode} alt="Payment QR" className="w-48 h-48 object-contain" />
            </div>
            <p className="text-center text-xs font-bold text-zinc-500">{buyer.name}</p>
            <p className="text-center text-[10px] text-zinc-400 font-mono">{buyer.upiId}</p>
          </div>
        </div>
      )}
    </div>
  );
};

// --- MAIN LAYOUT ---

export const MediatorDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'inbox' | 'market' | 'squad' | 'profile'>('inbox');
  const [showNotifications, setShowNotifications] = useState(false);

  const [orders, setOrders] = useState<Order[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [verifiedUsers, setVerifiedUsers] = useState<User[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);

  // Modals
  const [proofModal, setProofModal] = useState<Order | null>(null);
  const [dealBuilder, setDealBuilder] = useState<Campaign | null>(null);
  const [commission, setCommission] = useState('');
  const [selectedBuyer, setSelectedBuyer] = useState<User | null>(null);

  // AI Analysis State
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    loadData();
  }, [user, selectedBuyer]);

  const loadData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [ords, camps, pend, ver, tix] = await Promise.all([
        api.ops.getMediatorOrders(user.mediatorCode || ''),
        api.ops.getCampaigns(user.mediatorCode || ''),
        api.ops.getPendingUsers(user.mediatorCode || ''),
        api.ops.getVerifiedUsers(user.mediatorCode || ''),
        api.tickets.getAll(),
      ]);
      setOrders(ords);
      setCampaigns(camps);
      setPendingUsers(pend);
      setVerifiedUsers(ver);
      setTickets(tix);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handlePublish = async () => {
    if (!dealBuilder || !commission || !user?.mediatorCode) return;
    await api.ops.publishDeal(dealBuilder.id, parseInt(commission), user.mediatorCode);
    setDealBuilder(null);
    setCommission('');
    alert('Deal Published!');
    loadData();
  };

  const runAnalysis = async () => {
    if (!proofModal || !proofModal.screenshots?.order) return;
    setIsAnalyzing(true);
    setAiAnalysis(null);
    try {
      const imageBase64 = await urlToBase64(proofModal.screenshots.order);
      const result = await api.ops.analyzeProof(
        proofModal.id,
        imageBase64,
        proofModal.externalOrderId || '',
        proofModal.total
      );
      setAiAnalysis(result);
    } catch (e) {
      console.error(e);
      alert('Analysis failed. Try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Recommendation 2: Auto-trigger extraction when modal opens
  useEffect(() => {
    if (proofModal && proofModal.screenshots?.order) {
      runAnalysis();
    }
  }, [proofModal]);

  const pendingOrdersCount = orders.filter((o: Order) => o.affiliateStatus === 'Unchecked').length;
  const hasNotifications = pendingUsers.length > 0 || pendingOrdersCount > 0;

  const notifications = [
    ...(pendingUsers.length > 0
      ? [
          {
            id: 'users',
            title: 'New Joiners',
            message: `${pendingUsers.length} buyers waiting for approval`,
            time: 'Action Required',
            type: 'alert',
            action: () => setActiveTab('inbox'),
          },
        ]
      : []),
    ...(pendingOrdersCount > 0
      ? [
          {
            id: 'orders',
            title: 'Order Verification',
            message: `${pendingOrdersCount} orders need verification`,
            time: 'Action Required',
            type: 'alert',
            action: () => setActiveTab('inbox'),
          },
        ]
      : []),
    {
      id: 'system',
      title: 'System Update',
      message: 'Campaign inventory refreshed for the week.',
      time: '2h ago',
      type: 'info',
    },
  ];

  return (
    <div className="flex flex-col h-full bg-[#FAFAFA] font-sans relative overflow-hidden text-zinc-900 select-none">
      {/* Top Bar */}
      <div className="pt-safe-top pt-6 px-4 pb-2 bg-[#FAFAFA] z-30 flex justify-between items-center sticky top-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[0.8rem] bg-[#18181B] text-white flex items-center justify-center font-black text-lg shadow-lg border-2 border-white">
            {user?.name.charAt(0)}
          </div>
          <div>
            <h1 className="text-lg font-black text-[#18181B] leading-none tracking-tight">
              {user?.name}
            </h1>
            <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest mt-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-[#CCF381] rounded-full animate-pulse shadow-[0_0_6px_#CCF381]"></span>{' '}
              {user?.mediatorCode}
            </p>
          </div>
        </div>

        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="w-10 h-10 rounded-[0.8rem] bg-white border border-zinc-100 flex items-center justify-center text-zinc-600 hover:bg-zinc-50 transition-all active:scale-95 shadow-md relative"
          >
            <Bell size={18} strokeWidth={2.5} />
            {hasNotifications && (
              <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white animate-pulse"></span>
            )}
          </button>

          {showNotifications && (
            <>
              <div
                className="fixed inset-0 z-40 bg-transparent"
                onClick={() => setShowNotifications(false)}
              ></div>
              <div className="absolute right-0 top-12 w-72 bg-white rounded-[1.5rem] shadow-2xl border border-zinc-100 p-4 z-50 animate-enter origin-top-right">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-black text-sm text-zinc-900">Notifications</h3>
                  <button
                    onClick={() => setShowNotifications(false)}
                    className="p-1 bg-zinc-50 rounded-full hover:bg-zinc-100"
                  >
                    <X size={14} className="text-zinc-400" />
                  </button>
                </div>
                <div className="space-y-2 max-h-[250px] overflow-y-auto scrollbar-hide">
                  {notifications.length === 0 && (
                    <div className="text-center py-6">
                      <p className="text-zinc-300 font-bold text-xs">All caught up!</p>
                    </div>
                  )}
                  {notifications.map((n: any) => (
                    <div
                      key={n.id}
                      onClick={() => {
                        if (n.action) n.action();
                        setShowNotifications(false);
                      }}
                      className="p-3 bg-zinc-50 rounded-[1rem] hover:bg-zinc-100 transition-colors cursor-pointer flex gap-3 items-start relative overflow-hidden group"
                    >
                      <div
                        className={`w-1.5 h-full absolute left-0 top-0 bottom-0 ${n.type === 'alert' ? 'bg-red-500' : 'bg-blue-500'}`}
                      ></div>
                      <div className="flex-1 pl-1">
                        <p className="text-xs font-bold text-zinc-900 leading-tight mb-0.5">
                          {n.message}
                        </p>
                        <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-wide">
                          {n.time}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 scrollbar-hide">
        {activeTab === 'inbox' && (
          <InboxView
            orders={orders}
            pendingUsers={pendingUsers}
            tickets={tickets}
            onRefresh={loadData}
            onViewProof={(order: Order) => {
              setProofModal(order);
              setAiAnalysis(null);
            }}
          />
        )}
        {activeTab === 'market' && (
          <MarketView
            campaigns={campaigns}
            user={user}
            onRefresh={loadData}
            onPublish={setDealBuilder}
          />
        )}
        {activeTab === 'squad' && (
          <SquadView
            user={user}
            pendingUsers={pendingUsers}
            verifiedUsers={verifiedUsers}
            orders={orders}
            onRefresh={loadData}
            onSelectUser={setSelectedBuyer}
          />
        )}
        {activeTab === 'profile' && <MediatorProfileView />}
      </div>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 w-full max-w-[260px]">
        <div className="bg-[#18181B] backdrop-blur-xl border border-white/5 px-5 py-2.5 rounded-[2rem] shadow-[0_20px_40px_-10px_rgba(0,0,0,0.5)] flex items-center justify-between">
          <TabButton
            icon={LayoutGrid}
            label="Home"
            active={activeTab === 'inbox'}
            onClick={() => setActiveTab('inbox')}
          />
          <TabButton
            icon={Tag}
            label="Market"
            active={activeTab === 'market'}
            onClick={() => setActiveTab('market')}
          />
          <TabButton
            icon={Users}
            label="Squad"
            active={activeTab === 'squad'}
            onClick={() => setActiveTab('squad')}
          />
          <TabButton
            icon={UserIcon}
            label="Profile"
            active={activeTab === 'profile'}
            onClick={() => setActiveTab('profile')}
          />
        </div>
      </div>

      {/* VERIFICATION MODAL */}
      {proofModal && (
        <div
          className="absolute inset-0 z-50 bg-black/95 flex flex-col animate-enter backdrop-blur-sm overflow-hidden"
          onClick={() => {}}
        >
          <div className="flex justify-between items-center p-5 text-white pt-safe-top border-b border-white/10 bg-[#18181B] z-10 sticky top-0">
            <div>
              <h3 className="font-bold text-base">Verification Station</h3>
              <div className="flex items-center gap-2 text-[10px] text-zinc-400 font-mono mt-0.5">
                <span>{proofModal.buyerName}</span>
                <span>•</span>
                <span>{proofModal.id}</span>
              </div>
            </div>
            <button
              onClick={() => setProofModal(null)}
              className="w-9 h-9 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide pb-28">
            {/* 1. ORDER MATCHING SECTION */}
            <div className="bg-zinc-900/50 rounded-2xl border border-zinc-800 p-4">
              <h4 className="text-xs font-bold text-zinc-500 uppercase mb-3 flex items-center gap-2">
                <ShoppingBag size={14} /> Match Order ID
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-black/40 p-3 rounded-xl border border-white/5">
                  <p className="text-[9px] text-zinc-500 font-bold uppercase mb-1">
                    Platform ID (User Entered)
                  </p>
                  <p className="text-sm font-mono font-bold text-white tracking-wide break-all">
                    {proofModal.externalOrderId || 'Not Provided'}
                  </p>
                </div>
                <div className="bg-black/40 p-3 rounded-xl border border-white/5">
                  <p className="text-[9px] text-zinc-500 font-bold uppercase mb-1">
                    Expected Price
                  </p>
                  <p className="text-sm font-bold text-lime-400">₹{proofModal.total}</p>
                </div>
              </div>

              {proofModal.screenshots?.order ? (
                <div className="mt-4">
                  <p className="text-[10px] text-zinc-500 font-bold uppercase mb-2">
                    Order Screenshot
                  </p>
                  <img
                    src={proofModal.screenshots.order}
                    className="w-full rounded-xl border border-white/10"
                    alt="Order Proof"
                  />

                  {/* AI ANALYSIS SECTION */}
                  <div className="bg-indigo-500/10 p-4 rounded-xl border border-indigo-500/20 mt-4 relative overflow-hidden">
                    <div className="flex justify-between items-center mb-3 relative z-10">
                      <h4 className="font-bold text-indigo-300 flex items-center gap-2 text-xs uppercase tracking-widest">
                        <Sparkles size={14} className="text-indigo-400" /> AI Assistant
                      </h4>
                      {!aiAnalysis && !isAnalyzing && (
                        <button
                          onClick={runAnalysis}
                          className="bg-indigo-500 hover:bg-indigo-400 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg transition-colors shadow-lg active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1020]"
                        >
                          Re-Analyze
                        </button>
                      )}
                    </div>

                    {isAnalyzing && (
                      <div className="flex flex-col items-center justify-center py-4">
                        <Loader2
                          className="animate-spin motion-reduce:animate-none text-indigo-400 mb-2"
                          size={24}
                        />
                        <p className="text-xs font-bold text-indigo-300 animate-pulse motion-reduce:animate-none">
                          Analyzing Screenshot...
                        </p>
                      </div>
                    )}

                    {aiAnalysis && (
                      <div className="space-y-3 animate-fade-in">
                        <div className="flex gap-2">
                          <div
                            className={`flex-1 p-2 rounded-lg border ${aiAnalysis.orderIdMatch ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}
                          >
                            <p
                              className={`text-[9px] font-bold uppercase ${aiAnalysis.orderIdMatch ? 'text-green-400' : 'text-red-400'}`}
                            >
                              Order ID
                            </p>
                            <p className="text-xs font-bold text-white">
                              {aiAnalysis.orderIdMatch ? 'Matched' : 'Mismatch'}
                            </p>
                          </div>
                          <div
                            className={`flex-1 p-2 rounded-lg border ${aiAnalysis.amountMatch ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}
                          >
                            <p
                              className={`text-[9px] font-bold uppercase ${aiAnalysis.amountMatch ? 'text-green-400' : 'text-red-400'}`}
                            >
                              Amount
                            </p>
                            <p className="text-xs font-bold text-white">
                              {aiAnalysis.amountMatch ? 'Matched' : 'Mismatch'}
                            </p>
                          </div>
                        </div>
                        <div className="bg-black/30 p-2 rounded-lg">
                          <p className="text-[10px] text-zinc-400 leading-relaxed">
                            {aiAnalysis.discrepancyNote ||
                              'Verified. Details match expected values.'}
                          </p>
                        </div>
                        <div className="flex justify-between items-center pt-1">
                          <span className="text-[9px] text-indigo-300 font-bold uppercase">
                            Confidence Score
                          </span>
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${aiAnalysis.confidenceScore > 80 ? 'bg-green-500' : aiAnalysis.confidenceScore > 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                style={{ width: `${aiAnalysis.confidenceScore}%` }}
                              ></div>
                            </div>
                            <span className="text-xs font-bold text-white">
                              {aiAnalysis.confidenceScore}%
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-4 p-4 text-center border border-dashed border-zinc-700 rounded-xl text-zinc-500 text-xs">
                  No Order Screenshot Uploaded
                </div>
              )}
            </div>

            {/* 2. DEAL SPECIFIC PROOFS */}
            {proofModal.items[0].dealType === 'Rating' && (
              <div className="bg-orange-950/20 rounded-2xl border border-orange-500/20 p-4">
                <h4 className="text-xs font-bold text-orange-400 uppercase mb-3 flex items-center gap-2">
                  <Star size={14} /> 5-Star Rating Check
                </h4>
                {proofModal.screenshots?.rating ? (
                  <img
                    src={proofModal.screenshots.rating}
                    className="w-full rounded-xl border border-orange-500/20"
                    alt="Rating Proof"
                  />
                ) : (
                  <div className="p-4 text-center border border-dashed border-orange-900/50 rounded-xl text-orange-400/50 text-xs">
                    Rating Screenshot Missing
                  </div>
                )}
              </div>
            )}

            {proofModal.items[0].dealType === 'Review' && (
              <div className="bg-purple-950/20 rounded-2xl border border-purple-500/20 p-4">
                <h4 className="text-xs font-bold text-purple-400 uppercase mb-3 flex items-center gap-2">
                  <FileText size={14} /> Text Review Check
                </h4>
                {proofModal.reviewLink ? (
                  <a
                    href={proofModal.reviewLink}
                    target="_blank"
                    className="flex items-center justify-between p-4 bg-purple-900/20 border border-purple-500/30 rounded-xl hover:bg-purple-900/40 transition-colors group"
                  >
                    <span className="text-xs font-bold text-purple-300 truncate pr-4">
                      {proofModal.reviewLink}
                    </span>
                    <ExternalLink
                      size={14}
                      className="text-purple-400 group-hover:scale-110 transition-transform"
                    />
                  </a>
                ) : (
                  <div className="p-4 text-center border border-dashed border-purple-900/50 rounded-xl text-purple-400/50 text-xs">
                    Review Link Missing
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ACTION BAR */}
          <div className="absolute bottom-0 left-0 w-full p-4 bg-[#18181B] border-t border-white/10 z-20 flex gap-3">
            <button
              onClick={() => setProofModal(null)}
              className="flex-1 py-4 bg-white/10 text-white font-bold text-sm rounded-[1.2rem] hover:bg-white/20 transition-colors"
            >
              Later
            </button>
            <button
              onClick={() => {
                api.ops.verifyOrderClaim(proofModal.id).then(loadData);
                setProofModal(null);
              }}
              className="flex-[2] py-4 bg-[#CCF381] text-black font-black text-sm rounded-[1.2rem] shadow-xl hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              <CheckCircle2 size={18} strokeWidth={3} /> Verify Only
            </button>
          </div>
        </div>
      )}

      {dealBuilder && (
        <div
          className="absolute inset-0 z-50 bg-black/60 backdrop-blur-md flex items-end animate-fade-in"
          onClick={() => setDealBuilder(null)}
        >
          <div
            className="bg-white w-full rounded-t-[2rem] p-5 shadow-2xl animate-slide-up relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-1 bg-zinc-200 rounded-full mx-auto mb-6"></div>
            <div className="flex gap-4 mb-6">
              <div className="w-16 h-16 rounded-[1rem] bg-zinc-50 p-2 border border-zinc-100 flex items-center justify-center">
                <img
                  src={dealBuilder.image}
                  className="w-full h-full object-contain mix-blend-multiply"
                />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-black text-zinc-900 leading-tight line-clamp-2 mb-1">
                  {dealBuilder.title}
                </h3>
                <span className="text-[9px] font-bold bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full uppercase tracking-wider">
                  {dealBuilder.platform}
                </span>
              </div>
            </div>
            <div className="bg-zinc-50 p-4 rounded-[1.5rem] border border-zinc-100 mb-6 flex items-center justify-between relative overflow-hidden">
              <div className="relative z-10">
                <p className="text-[9px] text-zinc-400 font-black uppercase tracking-widest mb-1">
                  Base Price
                </p>
                <p className="text-2xl font-black text-zinc-900">
                  {formatCurrency(dealBuilder.price)}
                </p>
              </div>
              <div className="text-zinc-300 relative z-10">
                <ChevronRight size={24} />
              </div>
              <div className="text-right relative z-10">
                <p className="text-[9px] text-zinc-400 font-black uppercase tracking-widest mb-1">
                  Final Price
                </p>
                <p className="text-2xl font-black text-[#65a30d]">
                  {formatCurrency(dealBuilder.price + (parseInt(commission) || 0))}
                </p>
              </div>
            </div>
            <div className="space-y-3 mb-6">
              <label className="text-[10px] font-black text-zinc-900 uppercase ml-2 block tracking-wide">
                Your Commission (₹)
              </label>
              <input
                type="number"
                autoFocus
                value={commission}
                onChange={(e) => setCommission(e.target.value)}
                className="w-full bg-white border-2 border-zinc-100 rounded-[1.5rem] p-4 text-2xl font-black text-center focus:border-[#CCF381] focus:ring-4 focus:ring-[#CCF381]/20 outline-none transition-all placeholder:text-zinc-200"
                placeholder="0"
              />
              <p className="text-center text-[10px] text-zinc-400 font-bold">
                This will be added to the product price.
              </p>
            </div>
            <button
              onClick={handlePublish}
              disabled={!commission || parseInt(commission) <= 0}
              className="w-full py-4 bg-[#18181B] text-white rounded-[1.5rem] font-black text-base shadow-xl hover:bg-[#CCF381] hover:text-black transition-all disabled:opacity-50 disabled:scale-100 active:scale-95 flex items-center justify-center gap-2"
            >
              Publish Deal <Tag size={16} strokeWidth={3} className="fill-current" />
            </button>
          </div>
        </div>
      )}

      {selectedBuyer && (
        <LedgerModal
          buyer={selectedBuyer}
          orders={orders.filter((o) => o.userId === selectedBuyer.id)}
          onClose={() => setSelectedBuyer(null)}
          onRefresh={loadData}
        />
      )}
    </div>
  );
};
