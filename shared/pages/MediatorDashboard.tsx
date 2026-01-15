import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { useToast } from '../context/ToastContext';
import { api } from '../services/api';
import { subscribeRealtime } from '../services/realtime';
import { normalizeMobileTo10Digits } from '../utils/mobiles';
import { User, Campaign, Order, Product, Ticket } from '../types';
import {
  LayoutGrid,
  Tag,
  Users,
  Wallet,
  ArrowUpRight,
  X,
  Check,
  Copy,
  CheckCircle2,
  ChevronRight,
  Bell,
  Star,
  CreditCard,
  ShoppingBag,
  FileText,
  ExternalLink,
  ShieldCheck,
  RefreshCcw,
  ArrowRightLeft,
  QrCode,
  User as UserIcon,
  LogOut,
  Save,
  Camera,
  CalendarClock,
  AlertTriangle,
  Sparkles,
  Loader2,
} from 'lucide-react';

import { EmptyState, Spinner } from '../components/ui';
import { MobileTabBar } from '../components/MobileTabBar';

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
  } catch {
    return '';
  }
};

const formatRelativeTime = (iso?: string) => {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const deltaMs = Date.now() - t;
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

// --- COMPONENTS ---

// --- VIEWS ---

const InboxView = ({ orders, pendingUsers, tickets, loading, onRefresh, onViewProof }: any) => {
  // Verification queue is workflow-driven.
  // Orders can remain UNDER_REVIEW even after purchase verification if review/rating is still pending.
  const { toast } = useToast();
  const actionRequiredOrders = orders.filter((o: Order) => String(o.workflowStatus || '') === 'UNDER_REVIEW');
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
    <div className="space-y-6 animate-enter">
      {/* Header Stats */}
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide px-1 snap-x">
        <div className="min-w-[150px] bg-[#18181B] p-4 rounded-[1.5rem] shadow-xl relative overflow-hidden snap-center flex-1">
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#CCF381]/10 rounded-full blur-2xl -mr-6 -mt-6"></div>
          <div className="relative z-10">
            <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mb-1">
              Today's Profit
            </p>
            <h2 className="text-3xl font-black text-[#CCF381] tracking-tighter leading-none">
              {formatCurrency(todayEarnings).replace('', '')}
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
                  <div className="w-10 h-10 bg-orange-100 text-orange-600 rounded-[0.8rem] flex items-center justify-center font-black text-sm shadow-inner overflow-hidden">
                    {u.avatar ? (
                      <img
                        src={u.avatar}
                        alt={u.name ? `${u.name} avatar` : 'Avatar'}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      u.name.charAt(0)
                    )}
                  </div>
                  <div>
                    <h4 className="font-bold text-zinc-900 text-xs line-clamp-1">{u.name}</h4>
                    <p className="text-[10px] text-zinc-400 font-mono tracking-wide">{u.mobile}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    aria-label={`Approve ${u.name}`}
                    title="Approve"
                    onClick={() =>
                      api.ops
                        .approveUser(u.id)
                        .then(onRefresh)
                        .catch((e: any) => toast.error(String(e?.message || 'Failed to approve user')))
                    }
                    className="w-8 h-8 rounded-lg bg-zinc-900 text-white flex items-center justify-center hover:bg-[#CCF381] hover:text-black transition-all shadow-md active:scale-90"
                  >
                    <Check size={14} strokeWidth={3} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Reject ${u.name}`}
                    title="Reject"
                    onClick={() =>
                      api.ops
                        .rejectUser(u.id)
                        .then(onRefresh)
                        .catch((e: any) => toast.error(String(e?.message || 'Failed to reject user')))
                    }
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
            type="button"
            aria-pressed={viewMode === 'todo'}
            onClick={() => setViewMode('todo')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${viewMode === 'todo' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
          >
            Verify ({actionRequiredOrders.length})
          </button>
          <button
            type="button"
            aria-pressed={viewMode === 'cooling'}
            onClick={() => setViewMode('cooling')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${viewMode === 'cooling' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
          >
            Cooling Period ({coolingOrders.length})
          </button>
        </div>

        {(viewMode === 'todo' ? actionRequiredOrders : coolingOrders).length === 0 ? (
          loading ? (
            <EmptyState
              title="Loading orders"
              description="Fetching the latest verification queue."
              icon={<Spinner className="w-5 h-5 text-zinc-400" />}
            />
          ) : (
            <EmptyState
              title={viewMode === 'todo' ? 'No orders to verify' : 'No orders in cooling'}
              description={
                viewMode === 'todo'
                  ? 'New verified purchases will appear here for review.'
                  : 'These orders are waiting out the cooling period.'
              }
              icon={
                viewMode === 'todo' ? (
                  <CheckCircle2 size={22} className="text-zinc-400" />
                ) : (
                  <CalendarClock size={22} className="text-zinc-400" />
                )
              }
            />
          )
        ) : (
          <div className="space-y-3">
            {(viewMode === 'todo' ? actionRequiredOrders : coolingOrders).map((o: Order) => {
              const dealType = o.items[0].dealType || 'Discount';
              const settleDate = o.expectedSettlementDate
                ? new Date(o.expectedSettlementDate).toDateString()
                : 'N/A';
              const isDisputed = disputedOrderIds.has(o.id);
              const purchaseVerified = !!o.verification?.orderVerified;
              const missingProofs = o.requirements?.missingProofs ?? [];
              const missingVerifications = o.requirements?.missingVerifications ?? [];

              const stepLabel =
                !purchaseVerified
                  ? 'Needs purchase verification'
                  : missingProofs.length > 0
                    ? `Waiting on buyer: ${missingProofs.join(' + ')}`
                    : missingVerifications.length > 0
                      ? `Awaiting approval: ${missingVerifications.join(' + ')}`
                      : 'Ready';

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
                        alt={o.items[0].title}
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
                      {viewMode === 'todo' && (
                        <div className="mt-1 text-[10px] font-bold text-zinc-500">
                          {stepLabel}
                        </div>
                      )}
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
                        type="button"
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
                            <ShieldCheck size={16} /> {purchaseVerified ? 'Review Steps' : 'Verify Purchase'}
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

const MarketView = ({ campaigns, deals, loading, user, onRefresh: _onRefresh, onPublish }: any) => {
  const dealByCampaignId = useMemo(() => {
    const m = new Map<string, Product>();
    (deals || []).forEach((d: Product) => {
      if (d?.campaignId) m.set(String(d.campaignId), d);
    });
    return m;
  }, [deals]);

  const unpublishedCampaigns = useMemo(() => {
    return (campaigns || []).filter((c: Campaign) => !dealByCampaignId.has(String(c.id)));
  }, [campaigns, dealByCampaignId]);

  const [mode, setMode] = useState<'published' | 'unpublished'>('published');

  return (
    <div className="space-y-5 animate-enter">
      <div className="bg-[#18181B] p-5 rounded-[1.5rem] shadow-xl text-white relative overflow-hidden">
        <div className="absolute top-[-50%] right-[-10%] w-40 h-40 bg-[#CCF381] rounded-full blur-[60px] opacity-20 animate-pulse"></div>
        <div className="relative z-10">
          <h2 className="text-xl font-black mb-1 tracking-tight">Inventory Deck</h2>
          <p className="text-zinc-400 text-xs font-medium">
            Published deals are separated from unpublished inventory.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-[1.5rem] border border-zinc-100 shadow-sm p-1">
        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            aria-pressed={mode === 'published'}
            onClick={() => setMode('published')}
            className={`px-4 py-3 rounded-[1.2rem] font-black text-xs transition-all flex items-center justify-center gap-2 ${
              mode === 'published'
                ? 'bg-zinc-900 text-white shadow-md'
                : 'bg-transparent text-zinc-500 hover:bg-zinc-50'
            }`}
          >
            Published
            <span
              className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                mode === 'published' ? 'bg-white/15 text-white' : 'bg-zinc-100 text-zinc-600'
              }`}
            >
              {Array.isArray(deals) ? deals.length : 0}
            </span>
          </button>
          <button
            type="button"
            aria-pressed={mode === 'unpublished'}
            onClick={() => setMode('unpublished')}
            className={`px-4 py-3 rounded-[1.2rem] font-black text-xs transition-all flex items-center justify-center gap-2 ${
              mode === 'unpublished'
                ? 'bg-zinc-900 text-white shadow-md'
                : 'bg-transparent text-zinc-500 hover:bg-zinc-50'
            }`}
          >
            Unpublished
            <span
              className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                mode === 'unpublished' ? 'bg-white/15 text-white' : 'bg-zinc-100 text-zinc-600'
              }`}
            >
              {unpublishedCampaigns.length}
            </span>
          </button>
        </div>
      </div>

      {mode === 'published' ? (
        <div>
          <div className="flex items-center justify-between px-1 mb-3">
            <h3 className="font-bold text-base text-zinc-900 tracking-tight">Published Deals</h3>
            <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
              {Array.isArray(deals) ? deals.length : 0}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {!Array.isArray(deals) || deals.length === 0 ? (
              <div className="bg-white rounded-[1.5rem] border border-zinc-100 p-4">
                {loading ? (
                  <EmptyState
                    title="Loading deals"
                    description="Loading your published inventory."
                    icon={<Spinner className="w-5 h-5 text-zinc-400" />}
                    className="bg-transparent border-0 py-10"
                  />
                ) : (
                  <EmptyState
                    title="No Published Deals"
                    description="Publish inventory to make it available to buyers."
                    icon={<Tag size={22} className="text-zinc-400" />}
                    className="bg-transparent border-0 py-10"
                  />
                )}
              </div>
            ) : (
              deals.map((d: Product) => (
                <div
                  key={String(d.id)}
                  className="bg-white p-4 rounded-[1.5rem] border border-zinc-100 shadow-sm flex flex-col relative overflow-hidden"
                >
                  <div className="flex gap-4 mb-4">
                    <div className="w-16 h-16 bg-[#F4F4F5] rounded-[1rem] p-2 flex-shrink-0">
                        <img
                          src={d.image}
                          alt={d.title}
                          className="w-full h-full object-contain mix-blend-multiply"
                        />
                    </div>
                    <div className="flex-1 min-w-0 py-0.5">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest border border-zinc-100 px-1.5 py-0.5 rounded-md">
                          {d.platform}
                        </span>
                        <span className="bg-emerald-500/10 text-emerald-700 text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wide">
                          Published
                        </span>
                      </div>
                      <h4 className="font-bold text-zinc-900 text-base leading-tight line-clamp-1 mb-2">
                        {d.title}
                      </h4>
                      <div className="flex items-center gap-2">
                        <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                          Price
                        </p>
                        <p className="text-sm font-black text-zinc-900">{formatCurrency(d.price)}</p>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled
                    className="w-full py-3 bg-zinc-100 text-zinc-400 rounded-[1rem] font-bold text-xs shadow-inner flex items-center justify-center gap-1.5 cursor-not-allowed"
                  >
                    <ArrowUpRight size={14} strokeWidth={2.5} /> Published
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between px-1 mb-3">
            <h3 className="font-bold text-base text-zinc-900 tracking-tight">Unpublished Inventory</h3>
            <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
              {unpublishedCampaigns.length}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {unpublishedCampaigns.length === 0 ? (
              <div className="bg-white rounded-[1.5rem] border border-zinc-100 p-4">
                {loading ? (
                  <EmptyState
                    title="Loading inventory"
                    description="Fetching campaigns and assignments."
                    icon={<Spinner className="w-5 h-5 text-zinc-400" />}
                    className="bg-transparent border-0 py-10"
                  />
                ) : (
                  <EmptyState
                    title="No Unpublished Inventory"
                    description="Everything in your deck is already published."
                    icon={<Tag size={22} className="text-zinc-400" />}
                    className="bg-transparent border-0 py-10"
                  />
                )}
              </div>
            ) : (
              unpublishedCampaigns.map((c: Campaign) => (
                <div
                  key={c.id}
                  className="bg-white p-4 rounded-[1.5rem] border border-zinc-100 shadow-sm flex flex-col relative overflow-hidden hover:shadow-lg transition-all duration-300"
                >
                  <div className="flex gap-4 mb-4">
                    <div className="w-16 h-16 bg-[#F4F4F5] rounded-[1rem] p-2 flex-shrink-0">
                        <img
                          src={c.image}
                          alt={c.title}
                          className="w-full h-full object-contain mix-blend-multiply"
                        />
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
                    type="button"
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
      )}
    </div>
  );
};

const SquadView = ({ user, pendingUsers, verifiedUsers, loading, orders: _orders, onRefresh: _onRefresh, onSelectUser }: any) => {
  const { toast } = useToast();
  return (
    <div className="space-y-5 animate-enter">
      <div
        className="bg-[#4F46E5] p-5 rounded-[1.5rem] shadow-xl shadow-indigo-500/20 text-white relative overflow-hidden group active:scale-[0.98] transition-transform cursor-pointer"
        onClick={() => {
          navigator.clipboard.writeText(user.mediatorCode!);
          toast.success('Code copied');
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
          {loading ? (
            <div className="p-4">
              <EmptyState
                title="Loading buyers"
                description="Fetching your active roster."
                icon={<Spinner className="w-5 h-5 text-zinc-400" />}
                className="bg-transparent border-0 py-10"
              />
            </div>
          ) : verifiedUsers.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No active buyers yet"
                description="Share your invite code to onboard buyers."
                icon={<Users size={22} className="text-zinc-400" />}
                className="bg-transparent border-0 py-10"
              />
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
                    <div className="w-9 h-9 bg-zinc-100 rounded-[0.8rem] flex items-center justify-center font-black text-zinc-500 text-sm overflow-hidden">
                      {u.avatar ? (
                        <img
                          src={u.avatar}
                          alt={u.name ? `${u.name} avatar` : 'Avatar'}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        u.name.charAt(0)
                      )}
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
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [mobile, setMobile] = useState(user?.mobile || '');
  const [upiId, setUpiId] = useState(user?.upiId || '');
  const [bankDetails] = useState({
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
      toast.success('Profile updated');
    } catch (e) {
      toast.error(String((e as any)?.message || 'Update failed'));
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
    <div className="animate-enter">
      <div className="flex flex-col items-center pt-6 pb-8 bg-white rounded-b-[2.5rem] shadow-sm mb-6 border border-zinc-100">
        <div
          className="relative mb-4 group cursor-pointer"
          onClick={() => isEditing && fileInputRef.current?.click()}
        >
          <div className="w-24 h-24 rounded-full bg-zinc-100 border-4 border-white shadow-lg flex items-center justify-center overflow-hidden">
            {avatar ? (
              <img
                src={avatar}
                alt={user?.name ? `${user.name} avatar` : 'Avatar'}
                className="w-full h-full object-cover"
              />
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
          Mediator  {user?.mediatorCode}
        </p>
      </div>

      <div className="px-4 space-y-6">
        <div className="bg-white p-6 rounded-[2rem] border border-zinc-100 shadow-sm space-y-4">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-bold text-zinc-900 flex items-center gap-2">
              <UserIcon size={16} /> Personal Info
            </h3>
            <button
              type="button"
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
              inputMode="numeric"
              maxLength={10}
              pattern="[0-9]{10}"
              value={mobile}
              onChange={(e) => setMobile(normalizeMobileTo10Digits(e.target.value))}
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
                <img
                  src={qrCode}
                  alt="Payment QR"
                  className="h-32 w-32 object-contain rounded-lg"
                />
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
            type="button"
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
            type="button"
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

const LedgerModal = ({ buyer, orders, loading, onClose, onRefresh }: any) => {
  const { toast } = useToast();
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
      await api.ops.settleOrderPayment(settleId, utr.trim() || undefined, 'external');
      setSettleId(null);
      setUtr('');
      onRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to settle';
      toast.error(msg);
    }
  };

  const handleRevert = async (orderId: string) => {
    if (confirm('Undo settlement?')) {
      try {
        await api.ops.unsettleOrderPayment(orderId);
        onRefresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to revert settlement';
        toast.error(msg);
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
              <div className="w-10 h-10 rounded-[0.8rem] bg-white/10 flex items-center justify-center font-bold text-sm overflow-hidden">
                {buyer.avatar ? (
                  <img
                    src={buyer.avatar}
                    alt={buyer.name ? `${buyer.name} avatar` : 'Avatar'}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  buyer.name.charAt(0)
                )}
              </div>
              <div>
                <h3 className="text-xl font-black leading-none">{buyer.name}</h3>
                <p className="text-[10px] text-zinc-400 font-mono mt-1 opacity-80">
                  {buyer.mobile}
                </p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Close ledger"
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
                  type="button"
                  aria-label="Show payment QR"
                  onClick={() => setShowQr(true)}
                  className="p-2 hover:bg-indigo-50 text-indigo-400 hover:text-indigo-600 rounded-lg transition-colors"
                >
                  <QrCode size={18} />
                </button>
              )}
              <button
                type="button"
                aria-label="Copy UPI address"
                onClick={() => {
                  navigator.clipboard.writeText(buyer.upiId || '');
                  toast.success('Copied');
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
              type="button"
              aria-pressed={viewMode === 'pending'}
              onClick={() => setViewMode('pending')}
              className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${viewMode === 'pending' ? 'bg-black text-white shadow-md' : 'bg-white text-zinc-500 border border-zinc-200'}`}
            >
              Unsettled ({pendingOrders.length})
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'settled'}
              onClick={() => setViewMode('settled')}
              className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${viewMode === 'settled' ? 'bg-black text-white shadow-md' : 'bg-white text-zinc-500 border border-zinc-200'}`}
            >
              History ({settledOrders.length})
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-3 scrollbar-hide">
            {(viewMode === 'pending' ? pendingOrders : settledOrders).length === 0 ? (
              loading ? (
                <EmptyState
                  title="Loading settlements"
                  description="Fetching the latest payment status."
                  icon={<Spinner className="w-5 h-5 text-zinc-400" />}
                  className="bg-transparent border-zinc-200/60"
                />
              ) : (
                <EmptyState
                  title={
                    viewMode === 'pending' ? 'Nothing to settle yet' : 'No settlement history yet'
                  }
                  description={
                    viewMode === 'pending'
                      ? 'When orders are verified, they will show up here for settlement.'
                      : 'Completed settlements will appear here.'
                  }
                  icon={<FileText size={22} className="text-zinc-400" />}
                  className="bg-transparent border-zinc-200/60"
                />
              )
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
                          alt={o.items[0].title}
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
                        type="button"
                        onClick={() => setSettleId(o.id)}
                        className="px-4 py-2 bg-black text-white rounded-xl text-[10px] font-bold hover:bg-zinc-800 transition-colors active:scale-95 flex items-center gap-1"
                      >
                        Settle <ChevronRight size={12} />
                      </button>
                    )}
                    {viewMode === 'settled' && (
                      <button
                        type="button"
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
                          type="button"
                          onClick={() => setSettleId(null)}
                          className="flex-1 py-2 bg-white border border-zinc-200 rounded-lg text-[10px] font-bold hover:bg-zinc-100"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
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
              type="button"
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
  const { user } = useAuth();
  const { toast } = useToast();
  const {
    notifications: inboxNotifications,
    unreadCount,
    markAllRead,
    removeNotification,
    refresh: refreshNotifications,
  } = useNotification();
  const [activeTab, setActiveTab] = useState<'inbox' | 'market' | 'squad' | 'profile'>('inbox');
  const [showNotifications, setShowNotifications] = useState(false);

  const [orders, setOrders] = useState<Order[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [deals, setDeals] = useState<Product[]>([]);
  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [verifiedUsers, setVerifiedUsers] = useState<User[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);

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

  useEffect(() => {
    if (!showNotifications) return;
    refreshNotifications();
  }, [showNotifications, refreshNotifications]);

  const loadData = async (opts?: unknown) => {
    if (!user) return;
    if (loadingRef.current) return;
    const silent =
      !!opts &&
      typeof opts === 'object' &&
      Object.prototype.hasOwnProperty.call(opts, 'silent') &&
      Boolean((opts as any).silent);

    loadingRef.current = true;
    setLoading(true);
    try {
      const [ords, camps, publishedDeals, pend, ver, tix] = await Promise.all([
        api.ops.getMediatorOrders(user.mediatorCode || ''),
        api.ops.getCampaigns(user.mediatorCode || ''),
        api.ops.getDeals(user.mediatorCode || ''),
        api.ops.getPendingUsers(user.mediatorCode || ''),
        api.ops.getVerifiedUsers(user.mediatorCode || ''),
        api.tickets.getAll(),
      ]);
      setOrders(ords);
      setCampaigns(camps);
      setDeals(publishedDeals);
      setPendingUsers(pend);
      setVerifiedUsers(ver);
      setTickets(tix);

      // Keep the open buyer/ledger view in sync with realtime profile updates
      // (e.g., UPI/QR updates emitted via `users.changed`).
      setSelectedBuyer((prev) => {
        if (!prev) return prev;
        const updated = [...pend, ...ver].find((u: any) => u?.id === (prev as any).id);
        if (!updated) return prev;
        const changed =
          updated.name !== (prev as any).name ||
          updated.mobile !== (prev as any).mobile ||
          updated.upiId !== (prev as any).upiId ||
          updated.qrCode !== (prev as any).qrCode;
        return changed ? updated : prev;
      });
    } catch (e) {
      console.error(e);
      if (!silent) {
        const msg = (e as any)?.message ? String((e as any).message) : 'Failed to refresh dashboard.';
        toast.error(msg);
      }
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  // Realtime: refresh queue/dashboard when backend state changes.
  useEffect(() => {
    if (!user) return;
    let timer: any = null;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        loadData({ silent: true });
        if (showNotifications) refreshNotifications();
      }, 600);
    };
    const unsub = subscribeRealtime((msg) => {
      if (
        msg.type === 'orders.changed' ||
        msg.type === 'users.changed' ||
        msg.type === 'wallets.changed' ||
        msg.type === 'deals.changed' ||
        msg.type === 'notifications.changed' ||
        msg.type === 'tickets.changed'
      )
        schedule();
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [user, showNotifications, refreshNotifications]);

  const handlePublish = async () => {
    if (!dealBuilder || !commission || !user?.mediatorCode) return;
    await api.ops.publishDeal(dealBuilder.id, parseInt(commission), user.mediatorCode);
    setDealBuilder(null);
    setCommission('');
    toast.success('Deal published');
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
      toast.error('Analysis failed. Try again.');
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

  const hasNotifications = unreadCount > 0;

  return (
    <div className="flex flex-col h-[100dvh] min-h-0 bg-[#FAFAFA] font-sans relative overflow-hidden text-zinc-900 select-none">
      {/* Top Bar */}
      <div className="pt-safe-top pt-6 px-4 pb-2 bg-[#FAFAFA] z-30 flex justify-between items-center sticky top-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[0.8rem] bg-[#18181B] text-white flex items-center justify-center font-black text-lg shadow-lg border-2 border-white overflow-hidden">
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt={user?.name ? `${user.name} avatar` : 'Avatar'}
                className="w-full h-full object-cover"
              />
            ) : (
              user?.name.charAt(0)
            )}
          </div>
          <div>
            <h1 className="text-lg font-black text-[#18181B] leading-none tracking-tight">
              {user?.name}
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-[#CCF381] rounded-full animate-pulse shadow-[0_0_6px_#CCF381]"></span>{' '}
                {user?.mediatorCode}
              </p>
            </div>
          </div>
        </div>

        <div className="relative flex items-center gap-2">
          <button
            type="button"
            aria-label="Open notifications"
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
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-black text-sm text-zinc-900">Notifications</h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => markAllRead()}
                      className="text-[10px] font-black uppercase tracking-wider text-zinc-500 hover:text-zinc-900"
                      type="button"
                    >
                      Mark all read
                    </button>
                    <button
                      onClick={() => setShowNotifications(false)}
                      className="p-1 bg-zinc-50 rounded-full hover:bg-zinc-100"
                      type="button"
                    >
                      <X size={14} className="text-zinc-400" />
                    </button>
                  </div>
                </div>
                <div className="space-y-2 max-h-[250px] overflow-y-auto scrollbar-hide">
                  {inboxNotifications.length === 0 && (
                    <div className="text-center py-6">
                      <p className="text-zinc-300 font-bold text-xs">All caught up!</p>
                    </div>
                  )}
                  {inboxNotifications.map((n: any) => (
                    <div
                      key={n.id}
                      onClick={() => {
                        const id = String(n.id || '');
                        if (id.startsWith('pending-users:') || id.startsWith('pending-orders:')) {
                          setActiveTab('inbox');
                        }
                        setShowNotifications(false);
                      }}
                      className="p-3 bg-zinc-50 rounded-[1rem] hover:bg-zinc-100 transition-colors cursor-pointer flex gap-3 items-start relative overflow-hidden group"
                    >
                      <div
                        className={`w-1.5 h-full absolute left-0 top-0 bottom-0 ${n.type === 'alert' ? 'bg-red-500' : n.type === 'success' ? 'bg-emerald-500' : 'bg-blue-500'}`}
                      ></div>
                      <div className="flex-1 pl-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-black text-zinc-900 leading-tight mb-0.5 truncate">
                              {n.title || 'Notification'}
                            </p>
                            <p className="text-[10px] text-zinc-600 leading-tight">
                              {n.message}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-zinc-900"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeNotification(String(n.id));
                            }}
                            aria-label="Dismiss notification"
                            title="Dismiss"
                          >
                            <X size={14} />
                          </button>
                        </div>
                        <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-wide mt-1">
                          {n.read ? 'Read' : 'New'}{n.createdAt ? `${formatRelativeTime(n.createdAt)}` : ''}
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

      <div className="flex-1 min-h-0 overflow-y-auto p-4 scrollbar-hide pb-[calc(7.5rem+env(safe-area-inset-bottom))]">
        {activeTab === 'inbox' && (
          <InboxView
            orders={orders}
            pendingUsers={pendingUsers}
            tickets={tickets}
            loading={loading}
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
            deals={deals}
            loading={loading}
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
            loading={loading}
            onRefresh={loadData}
            onSelectUser={setSelectedBuyer}
          />
        )}
        {activeTab === 'profile' && <MediatorProfileView />}
      </div>

      <div className="fixed left-1/2 -translate-x-1/2 z-40 w-[92vw] max-w-[360px] bottom-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <MobileTabBar
          items={[
            {
              id: 'inbox',
              label: 'Home',
              ariaLabel: 'Home',
              icon: <LayoutGrid size={22} strokeWidth={activeTab === 'inbox' ? 2.5 : 2} />,
              badge: unreadCount,
            },
            {
              id: 'market',
              label: 'Market',
              ariaLabel: 'Market',
              icon: <Tag size={22} strokeWidth={activeTab === 'market' ? 2.5 : 2} />,
            },
            {
              id: 'squad',
              label: 'Squad',
              ariaLabel: 'Squad',
              icon: <Users size={22} strokeWidth={activeTab === 'squad' ? 2.5 : 2} />,
            },
            {
              id: 'profile',
              label: 'Profile',
              ariaLabel: 'Profile',
              icon: <UserIcon size={22} strokeWidth={activeTab === 'profile' ? 2.5 : 2} />,
            },
          ]}
          activeId={activeTab}
          onChange={(id) => {
            setActiveTab(id as any);
            setShowNotifications(false);
          }}
          variant="darkGlass"
          showLabels={false}
        />
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
                <span></span>
                <span>{proofModal.id}</span>
              </div>
            </div>
            <button
              type="button"
              aria-label="Close verification modal"
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
                  <p className="text-sm font-bold text-lime-400">{proofModal.total}</p>
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
                          type="button"
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
                        {(() => {
                          const n = Number(aiAnalysis.confidenceScore);
                          const score = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
                          return (
                            <>
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
                                      className={`h-full rounded-full ${score > 80 ? 'bg-green-500' : score > 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                      style={{ width: `${score}%` }}
                                    ></div>
                                  </div>
                                  <span className="text-xs font-bold text-white">{score}%</span>
                                </div>
                              </div>
                            </>
                          );
                        })()}
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
                    target="_blank" rel="noreferrer"
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
            {!proofModal?.verification?.orderVerified ? (
              <button
                onClick={async () => {
                  try {
                    const resp = await api.ops.verifyOrderClaim(proofModal.id);
                    const missingProofs: Array<'review' | 'rating'> =
                      (resp?.missingProofs as any) || [];
                    const missingVerifications: Array<'review' | 'rating'> =
                      (resp?.missingVerifications as any) || [];

                    if (resp?.approved) {
                      toast.success('Purchase verified and order approved.');
                    } else if (missingProofs.length) {
                      toast.info(`Purchase verified. Waiting on buyer proof: ${missingProofs.join(' + ')}.`);
                    } else if (missingVerifications.length) {
                      toast.info(`Purchase verified. Awaiting step approval: ${missingVerifications.join(' + ')}.`);
                    } else {
                      toast.success('Purchase verified.');
                    }

                    await loadData();
                    setProofModal(null);
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : 'Failed to verify purchase';
                    toast.error(msg);
                  }
                }}
                className="flex-[2] py-4 bg-[#CCF381] text-black font-black text-sm rounded-[1.2rem] shadow-xl hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle2 size={18} strokeWidth={3} /> Verify Purchase
              </button>
            ) : (
              <>
                {proofModal?.requirements?.required?.includes('review') && (
                  <button
                    onClick={async () => {
                      try {
                        const resp = await api.ops.verifyOrderRequirement(proofModal.id, 'review');
                        const missingProofs: Array<'review' | 'rating'> =
                          (resp?.missingProofs as any) || [];
                        const missingVerifications: Array<'review' | 'rating'> =
                          (resp?.missingVerifications as any) || [];

                        if (resp?.approved) {
                          toast.success('Review verified and order approved.');
                        } else if (missingProofs.length) {
                          toast.info(`Review verified. Waiting on buyer proof: ${missingProofs.join(' + ')}.`);
                        } else if (missingVerifications.length) {
                          toast.info(`Review verified. Awaiting step approval: ${missingVerifications.join(' + ')}.`);
                        } else {
                          toast.success('Review verified.');
                        }

                        await loadData();
                        setProofModal(null);
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : 'Failed to verify review';
                        toast.error(msg);
                      }
                    }}
                    disabled={
                      !!proofModal?.requirements?.missingProofs?.includes('review') ||
                      !proofModal?.requirements?.missingVerifications?.includes('review')
                    }
                    className="flex-1 py-4 bg-[#CCF381] text-black font-black text-sm rounded-[1.2rem] shadow-xl hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:hover:scale-100"
                    title={
                      proofModal?.requirements?.missingProofs?.includes('review')
                        ? 'Buyer proof missing'
                        : !proofModal?.requirements?.missingVerifications?.includes('review')
                          ? 'Already verified'
                          : undefined
                    }
                  >
                    <CheckCircle2 size={18} strokeWidth={3} /> Verify Review
                  </button>
                )}

                {proofModal?.requirements?.required?.includes('rating') && (
                  <button
                    onClick={async () => {
                      try {
                        const resp = await api.ops.verifyOrderRequirement(proofModal.id, 'rating');
                        const missingProofs: Array<'review' | 'rating'> =
                          (resp?.missingProofs as any) || [];
                        const missingVerifications: Array<'review' | 'rating'> =
                          (resp?.missingVerifications as any) || [];

                        if (resp?.approved) {
                          toast.success('Rating verified and order approved.');
                        } else if (missingProofs.length) {
                          toast.info(`Rating verified. Waiting on buyer proof: ${missingProofs.join(' + ')}.`);
                        } else if (missingVerifications.length) {
                          toast.info(`Rating verified. Awaiting step approval: ${missingVerifications.join(' + ')}.`);
                        } else {
                          toast.success('Rating verified.');
                        }

                        await loadData();
                        setProofModal(null);
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : 'Failed to verify rating';
                        toast.error(msg);
                      }
                    }}
                    disabled={
                      !!proofModal?.requirements?.missingProofs?.includes('rating') ||
                      !proofModal?.requirements?.missingVerifications?.includes('rating')
                    }
                    className="flex-1 py-4 bg-[#CCF381] text-black font-black text-sm rounded-[1.2rem] shadow-xl hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:hover:scale-100"
                    title={
                      proofModal?.requirements?.missingProofs?.includes('rating')
                        ? 'Buyer proof missing'
                        : !proofModal?.requirements?.missingVerifications?.includes('rating')
                          ? 'Already verified'
                          : undefined
                    }
                  >
                    <CheckCircle2 size={18} strokeWidth={3} /> Verify Rating
                  </button>
                )}

                {!proofModal?.requirements?.required?.length && (
                  <button
                    disabled
                    className="flex-[2] py-4 bg-white/10 text-white font-black text-sm rounded-[1.2rem] opacity-60 flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 size={18} strokeWidth={3} /> Verified
                  </button>
                )}
              </>
            )}
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
                Your Commission ()
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
          loading={loading}
          onClose={() => setSelectedBuyer(null)}
          onRefresh={loadData}
        />
      )}
    </div>
  );
};
