import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../services/api';
import { subscribeRealtime } from '../services/realtime';
import { Button, EmptyState, IconButton, Input, Spinner } from '../components/ui';
import { DesktopShell } from '../components/DesktopShell';
import {
  LayoutGrid,
  Users,
  ShoppingCart,
  Package,
  DollarSign,
  Settings,
  LogOut,
  Menu,
  Download,
  Database,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Ban,
  AlertTriangle,
  Key,
  Copy,
  Plus,
  IndianRupee,
  Wallet,
  Save,
  Terminal,
  HeadphonesIcon,
  Trash2,
  ClipboardList,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { User, Order, Product, Invite, Ticket } from '../types';

// --- TYPES & CONSTANTS ---
type ViewMode =
  | 'dashboard'
  | 'users'
  | 'orders'
  | 'inventory'
  | 'finance'
  | 'settings'
  | 'invites'
  | 'support'
  | 'audit-logs';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

// --- COMPONENTS ---

const SidebarItem = ({ icon: Icon, label, active, onClick, badge }: any) => (
  <button
    type="button"
    onClick={onClick}
    aria-current={active ? 'page' : undefined}
    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 group relative overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 motion-reduce:transition-none motion-reduce:transform-none ${
      active
        ? 'bg-white/10 text-white shadow-lg backdrop-blur-sm border border-white/5'
        : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
    }`}
  >
    {active && (
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500 rounded-r-full"></div>
    )}
    <div className="flex items-center gap-3">
      <Icon
        size={18}
        className={active ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'}
      />
      <span className="font-medium text-sm tracking-wide">{label}</span>
    </div>
    {badge > 0 && (
      <span className="bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
        {badge}
      </span>
    )}
  </button>
);

const StatCard = ({ title, value, subtext, icon: Icon, colorClass }: any) => (
  <div className="bg-white p-6 rounded-[1.5rem] shadow-[0_2px_20px_-12px_rgba(0,0,0,0.1)] border border-slate-100 relative overflow-hidden flex flex-col justify-between group hover:-translate-y-1 transition-all duration-300">
    <div
      className={`absolute -right-6 -top-6 w-24 h-24 rounded-full opacity-[0.08] group-hover:opacity-[0.15] transition-opacity ${colorClass.replace('text-', 'bg-')}`}
    ></div>

    <div className="flex justify-between items-start z-10">
      <div
        className={`p-3 rounded-2xl ${colorClass.replace('text-', 'bg-').replace('600', '50')} ${colorClass}`}
      >
        <Icon size={24} />
      </div>
      {subtext && (
        <div
          className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-slate-50 text-slate-500`}
        >
          {subtext}
        </div>
      )}
    </div>

    <div className="mt-4 z-10">
      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">{title}</p>
      <h3 className="text-3xl font-black text-slate-900 tracking-tight">{value}</h3>
    </div>
  </div>
);

const StatusBadge = ({ status }: { status: string }) => {
  const styles: any = {
    active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    suspended: 'bg-rose-50 text-rose-700 border-rose-200',
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    Paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Pending: 'bg-slate-100 text-slate-600 border-slate-200',
    Pending_Cooling: 'bg-blue-50 text-blue-700 border-blue-200',
    Delivered: 'bg-blue-50 text-blue-700 border-blue-200',
    Ordered: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    Shipped: 'bg-violet-50 text-violet-700 border-violet-200',
    Fraud_Alert: 'bg-rose-50 text-rose-700 border-rose-200',
    Approved_Settled: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    used: 'bg-slate-100 text-slate-400 border-slate-200 line-through',
    Cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
    Open: 'bg-blue-50 text-blue-700 border-blue-200',
    Resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Rejected: 'bg-slate-100 text-slate-500 border-slate-200',
  };

  const labels: any = {
    Pending_Cooling: 'Cooling Period',
    Approved_Settled: 'Settled',
    Fraud_Alert: 'High Risk',
  };

  return (
    <span
      className={`px-2.5 py-1 rounded-md text-[10px] font-extrabold uppercase tracking-wide border ${styles[status] || styles['Pending']}`}
    >
      {labels[status] || status.replace(/_/g, ' ')}
    </span>
  );
};

// --- MAIN PAGE ---

export const AdminPortal: React.FC<{ onBack?: () => void }> = ({ onBack: _onBack }) => {
  const { user, loginAdmin, logout } = useAuth();
  const { toast } = useToast();
  const [view, setView] = useState<ViewMode>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [deletingWalletId, setDeletingWalletId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);

  const switchView = (next: ViewMode) => {
    setView(next);
    setIsSidebarOpen(false);
  };

  // Data Stores
  const [users, setUsers] = useState<User[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [chartData, setChartData] = useState<any[]>([]);

  // Admin Auth
  const [adminId, setAdminId] = useState('');
  const [passkey, setPasskey] = useState('');
  const [authError, setAuthError] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  // Filters
  const [userRoleFilter, setUserRoleFilter] = useState<string>('All');
  const [userSearch, setUserSearch] = useState('');
  const [inviteRole, setInviteRole] = useState<'agency' | 'brand'>('agency');
  const [inviteLabel, setInviteLabel] = useState('');

  // Order/inventory filters
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('All');
  const [inventorySearch, setInventorySearch] = useState('');
  const [proofModal, setProofModal] = useState<Order | null>(null);

  // Settings State
  const [configEmail, setConfigEmail] = useState('admin@buzzma.world');

  // Audit Logs State
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditFilter, setAuditFilter] = useState('');

  const fetchSystemConfig = async () => {
    try {
      const cfg = await api.admin.getConfig();
      if (cfg?.adminContactEmail) setConfigEmail(String(cfg.adminContactEmail));
    } catch (e) {
      console.error('Admin Config Fetch Error:', e);
    }
  };

  useEffect(() => {
    if (user?.role === 'admin') {
      fetchAllData();
      fetchSystemConfig();
    }
  }, [user]);

  // Realtime: refresh admin views when core entities change.
  useEffect(() => {
    if (!user || user.role !== 'admin') return;
    let timer: any = null;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        fetchAllData();
      }, 800);
    };
    const unsub = subscribeRealtime((msg) => {
      if (
        msg.type === 'orders.changed' ||
        msg.type === 'users.changed' ||
        msg.type === 'wallets.changed' ||
        msg.type === 'deals.changed' ||
        msg.type === 'invites.changed' ||
        msg.type === 'notifications.changed' ||
        msg.type === 'tickets.changed'
      ) {
        schedule();
      }
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [user]);

  useEffect(() => {
    if (!user || user.role !== 'admin') return;
    if (view !== 'users') return;
    api.admin
      .getUsers('all')
      .then((u) => setUsers(u))
      .catch((e) => console.error('Admin Users Fetch Error:', e));
  }, [user, view]);

  useEffect(() => {
    if (!user || user.role !== 'admin') return;
    if (view !== 'invites') return;
    api.admin
      .getInvites()
      .then((i) => setInvites(i))
      .catch((e) => console.error('Admin Invites Fetch Error:', e));
  }, [user, view]);

  useEffect(() => {
    if (!user || user.role !== 'admin') return;
    if (view !== 'settings') return;
    fetchSystemConfig();
  }, [user, view]);

  const fetchAllData = async () => {
    setIsLoading(true);
    try {
      const results = await Promise.allSettled([
        api.admin.getUsers('all'),
        api.admin.getFinancials(),
        api.admin.getProducts(),
        api.admin.getStats(),
        api.admin.getGrowthAnalytics(),
        api.admin.getInvites(),
        api.tickets.getAll(),
      ]);

      const [u, o, p, s, g, i, t] = results;

      if (u.status === 'fulfilled') setUsers(u.value);
      else console.error('Admin Users Fetch Error:', u.reason);

      if (o.status === 'fulfilled') {
        setOrders(o.value);
        // Keep proof modal in sync with refreshed data
        setProofModal((prev) => {
          if (!prev) return prev;
          const updated = (o.value as Order[]).find((ord: Order) => ord.id === prev.id);
          return updated || null;
        });
      } else console.error('Admin Financials Fetch Error:', o.reason);

      if (p.status === 'fulfilled') setProducts(p.value);
      else console.error('Admin Products Fetch Error:', p.reason);

      if (s.status === 'fulfilled') setStats(s.value);
      else console.error('Admin Stats Fetch Error:', s.reason);

      if (g.status === 'fulfilled') setChartData(g.value);
      else console.error('Admin Growth Fetch Error:', g.reason);

      if (i.status === 'fulfilled') setInvites(i.value);
      else console.error('Admin Invites Fetch Error:', i.reason);

      if (t.status === 'fulfilled') setTickets(t.value);
      else console.error('Admin Tickets Fetch Error:', t.reason);
    } catch (e) {
      console.error('Admin Data Fetch Error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsAuthLoading(true);
    try {
      const u = await loginAdmin(String(adminId || '').trim(), String(passkey || '').trim());
      if (u?.role !== 'admin') {
        logout();
        setAuthError('This account is not an admin. Please use the correct portal.');
      }
    } catch (err: any) {
      const msg = String(err?.message || '').trim();
      setAuthError(msg || 'Invalid Admin Credentials');
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleGenerateInvite = async () => {
    if (!inviteLabel.trim()) {
      toast.error("Label required (e.g. 'Nike India')");
      return;
    }
    setIsLoading(true);
    try {
      await api.admin.generateInvite(inviteRole, inviteLabel);
      const updated = await api.admin.getInvites();
      setInvites(updated);
      setInviteLabel('');
      toast.success('Invite generated');
    } catch (e) {
      toast.error(String((e as any)?.message || 'Failed to generate invite'));
    } finally {
      setIsLoading(false);
    }
  };

  const toggleUserStatus = async (target: User) => {
    if (target.role === 'admin') return;
    const newStatus = target.status === 'active' ? 'suspended' : 'active';
    await api.admin.updateUserStatus(target.id, newStatus);
    setUsers(users.map((u) => (u.id === target.id ? { ...u, status: newStatus } : u)));
  };

  const deleteWallet = async (target: User) => {
    if (target.role === 'admin') return;
    const hasBalance = Number(target.walletBalance || 0) > 0 || Number(target.walletPending || 0) > 0;
    if (hasBalance) {
      toast.error('Wallet has funds; cannot delete');
      return;
    }
    const ok = window.confirm('Delete this wallet? This cannot be undone.');
    if (!ok) return;
    setDeletingWalletId(target.id);
    try {
      await api.admin.deleteWallet(target.id);
      toast.success('Wallet deleted');
      const updated = await api.admin.getUsers('all');
      setUsers(updated);
    } catch (e: any) {
      toast.error(String(e?.message || 'Failed to delete wallet'));
    } finally {
      setDeletingWalletId(null);
    }
  };

  const deleteUser = async (target: User) => {
    if (target.role === 'admin') return;
    const ok = window.confirm('Delete this user? This cannot be undone.');
    if (!ok) return;
    setDeletingUserId(target.id);
    try {
      await api.admin.deleteUser(target.id);
      toast.success('User deleted');
      const updated = await api.admin.getUsers('all');
      setUsers(updated);
    } catch (e: any) {
      toast.error(String(e?.message || 'Failed to delete user'));
    } finally {
      setDeletingUserId(null);
    }
  };

  const deleteProduct = async (productId: string) => {
    const ok = window.confirm('Delete this product/deal? This cannot be undone.');
    if (!ok) return;
    setDeletingProductId(productId);
    try {
      await api.admin.deleteProduct(productId);
      toast.success('Product deleted');
      const updated = await api.admin.getProducts();
      setProducts(updated);
    } catch (e: any) {
      toast.error(String(e?.message || 'Failed to delete product'));
    } finally {
      setDeletingProductId(null);
    }
  };

  const resolveTicket = async (id: string, status: 'Resolved' | 'Rejected') => {
    await api.tickets.update(id, status);
    setTickets(tickets.map((t) => (t.id === id ? { ...t, status } : t)));
  };

  const deleteTicket = async (id: string) => {
    const t = tickets.find((x) => x.id === id);
    if (!t) return;
    if (t.status === 'Open') {
      toast.error('Resolve or reject the ticket before deleting');
      return;
    }
    const ok = window.confirm('Delete this ticket? This cannot be undone.');
    if (!ok) return;
    try {
      await api.tickets.delete(id);
      setTickets(tickets.filter((x) => x.id !== id));
      toast.success('Ticket deleted');
    } catch (e: any) {
      toast.error(String(e?.message || 'Failed to delete ticket'));
    }
  };

  const deleteInvite = async (code: string) => {
    const inv: any = invites.find((x: any) => x.code === code);
    if (!inv) return;
    const useCount = Number(inv.useCount ?? 0);
    if (String(inv.status) !== 'active' || useCount > 0) {
      toast.error('Only unused active codes can be deleted');
      return;
    }
    const ok = window.confirm('Delete this access code? This cannot be undone.');
    if (!ok) return;
    try {
      await api.admin.deleteInvite(code);
      setInvites(invites.filter((x) => x.code !== code));
      toast.success('Access code deleted');
    } catch (e: any) {
      toast.error(String(e?.message || 'Failed to delete access code'));
    }
  };

  const handleSaveConfig = async () => {
    setIsLoading(true);
    try {
      const saved = await api.admin.updateConfig({ adminContactEmail: configEmail });
      if (saved?.adminContactEmail) setConfigEmail(String(saved.adminContactEmail));
      toast.success('System configuration saved');
    } catch (e: any) {
      toast.error(String(e?.message || 'Failed to save system configuration'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = (reportType: 'orders' | 'finance') => {
    const dataToExport = orders;
    if (!dataToExport || dataToExport.length === 0) {
      toast.info('No data available to export.');
      return;
    }

    const getApiBase = () => {
      const fromGlobal = (globalThis as any).__MOBO_API_URL__ as string | undefined;
      const fromNext =
        typeof process !== 'undefined' &&
        (process as any).env &&
        (process as any).env.NEXT_PUBLIC_API_URL
          ? String((process as any).env.NEXT_PUBLIC_API_URL)
          : undefined;
      let base = String(fromGlobal || fromNext || '/api').trim();
      if (base.startsWith('/')) {
        base = `${window.location.origin}${base}`;
      }
      return base.endsWith('/') ? base.slice(0, -1) : base;
    };

    const apiBase = getApiBase();
    const buildProofUrl = (orderId: string, type: 'order' | 'payment' | 'rating' | 'review') => {
      return `${apiBase}/public/orders/${encodeURIComponent(orderId)}/proof/${type}`;
    };

    const csvEscape = (val: string) => `"${val.replace(/"/g, '""')}"`;
    const hyperlinkYes = (url?: string) => (url ? csvEscape(`=HYPERLINK("${url}","Yes")`) : 'No');

    const headers = [
      'Order ID',
      'Date',
      'Time',
      'Customer Name',
      'Customer Mobile',
      'Brand',
      'Product',
      'Platform',
      'Deal Type',
      'Quantity',
      'Unit Price',
      'Total Amount',
      'Order Status',
      'Payment Status',
      'Verification Status',
      'Mediator Code',
      'Agency Name',
      'Internal Ref',
      'Sold By',
      'Order Date',
      'Extracted Product',
      'Proof: Order',
      'Proof: Payment',
      'Proof: Rating',
      'Proof: Review',
    ];

    const csvRows = [headers.join(',')];

    dataToExport.forEach((order) => {
      const dateObj = new Date(order.createdAt);
      const dateStr = dateObj.toLocaleDateString();
      const timeStr = dateObj.toLocaleTimeString();
      const item = order.items[0];

      const row = [
        order.externalOrderId || order.id,
        dateStr,
        timeStr,
        `"${(order.buyerName || '').replace(/"/g, '""')}"`,
        `"${(order.buyerMobile || '').replace(/"/g, '""')}"`,
        `"${(order.brandName ?? item?.brandName ?? '').replace(/"/g, '""')}"`,
        `"${(item?.title ?? '').replace(/"/g, '""')}"`,
        item?.platform ?? '',
        item?.dealType ?? 'Discount',
        item?.quantity ?? 1,
        item?.priceAtPurchase ?? 0,
        order.total,
        order.status,
        order.paymentStatus,
        order.affiliateStatus,
        order.managerName || 'N/A',
        `"${(order.agencyName || 'Partner Agency').replace(/"/g, '""')}"`,
        order.id,
        `"${(order.soldBy || '').replace(/"/g, '""')}"`,
        order.orderDate ? new Date(order.orderDate).toLocaleDateString() : '',
        `"${(order.extractedProductName || '').replace(/"/g, '""')}"`,
        order.screenshots?.order ? hyperlinkYes(buildProofUrl(order.id, 'order')) : 'No',
        order.screenshots?.payment ? hyperlinkYes(buildProofUrl(order.id, 'payment')) : 'No',
        order.screenshots?.rating ? hyperlinkYes(buildProofUrl(order.id, 'rating')) : 'No',
        (order.reviewLink || order.screenshots?.review)
          ? hyperlinkYes(buildProofUrl(order.id, 'review'))
          : 'No',
      ];
      csvRows.push(row.join(','));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `buzzma_admin_${reportType}_report_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const filteredUsers = useMemo(() => {
    let result = users;
    if (userRoleFilter !== 'All') {
      result = result.filter((u) => u.role.toLowerCase() === userRoleFilter.toLowerCase());
    }
    if (userSearch.trim()) {
      const q = userSearch.trim().toLowerCase();
      result = result.filter(
        (u) =>
          (u.name || '').toLowerCase().includes(q) ||
          (u.mobile || '').toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q) ||
          (u.mediatorCode || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [users, userRoleFilter, userSearch]);

  const filteredOrders = useMemo(() => {
    let result = orders;
    if (orderStatusFilter !== 'All') {
      result = result.filter((o) => {
        const status = o.affiliateStatus === 'Unchecked' ? o.paymentStatus : o.affiliateStatus;
        return String(status).toLowerCase() === orderStatusFilter.toLowerCase();
      });
    }
    if (orderSearch.trim()) {
      const q = orderSearch.trim().toLowerCase();
      result = result.filter(
        (o) =>
          (o.externalOrderId || o.id || '').toLowerCase().includes(q) ||
          (o.buyerName || '').toLowerCase().includes(q) ||
          (o.items?.[0]?.title || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [orders, orderStatusFilter, orderSearch]);

  const filteredProducts = useMemo(() => {
    if (!inventorySearch.trim()) return products;
    const q = inventorySearch.trim().toLowerCase();
    return products.filter(
      (p) =>
        (p.title || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q) ||
        (p.platform || '').toLowerCase().includes(q)
    );
  }, [products, inventorySearch]);

  // --- AUTH GUARD ---
  if (!user || user.role !== 'admin') {
    return (
      <div className="min-h-[100dvh] bg-[#0F172A] flex items-center justify-center p-6 font-sans relative overflow-hidden">
        {/* Background Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-20"></div>

        <div className="bg-[#1E293B] p-10 rounded-[2rem] w-full max-w-md border border-slate-700 shadow-2xl relative z-10">
          <div className="flex justify-center mb-8">
            <div className="w-20 h-20 bg-indigo-500/10 rounded-3xl flex items-center justify-center border border-indigo-500/20 shadow-[0_0_40px_-10px_rgba(99,102,241,0.5)]">
              <ShieldAlert size={40} className="text-indigo-400" />
            </div>
          </div>

          <h1 className="text-3xl font-extrabold text-white text-center mb-2 tracking-tight">
            System Admin
          </h1>
          <p className="text-slate-400 text-center text-sm mb-8 font-medium">
            Restricted Access Environment
          </p>

          <form onSubmit={handleLogin} className="space-y-5">
            {authError && (
              <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-bold rounded-xl text-center flex items-center justify-center gap-2">
                <AlertTriangle size={14} /> {authError}
              </div>
            )}
            <Input
              tone="dark"
              label="Username"
              type="text"
              value={adminId}
              onChange={(e) => setAdminId(e.target.value)}
              placeholder="root"
              leftIcon={<Terminal size={18} />}
              className="font-mono text-sm"
              autoCapitalize="none"
              autoComplete="username"
            />

            <Input
              tone="dark"
              label="Security Key"
              type="password"
              value={passkey}
              onChange={(e) => setPasskey(e.target.value)}
              placeholder="••••••••"
              leftIcon={<Key size={18} />}
              className="font-mono text-sm"
              autoComplete="current-password"
            />

            <Button
              type="submit"
              size="lg"
              disabled={isAuthLoading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20"
              rightIcon={isAuthLoading ? <Spinner className="w-5 h-5 text-current" /> : null}
            >
              Authenticate Session
            </Button>
          </form>

          
        </div>
      </div>
    );
  }

  return (
    <DesktopShell
      isSidebarOpen={isSidebarOpen}
      onSidebarOpenChange={setIsSidebarOpen}
      showMobileHeader={false}
      containerClassName="flex h-[100dvh] min-h-0 bg-[#F8F9FA] font-sans overflow-hidden relative"
      sidebarWidthClassName="w-72"
      asideClassName="bg-[#0F172A] flex flex-col border-r border-slate-800"
      mainClassName="flex-1 min-w-0 min-h-0 overflow-hidden relative flex flex-col"
      sidebar={
        <>
          <div className="p-6 pb-2">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-600/20">
                  <Database size={20} />
                </div>
                <div>
                  <h1 className="text-white font-black text-lg tracking-tight">
                    BUZZMA<span className="text-indigo-500">Admin</span>
                  </h1>
                  <div className="flex items-center gap-2">
                    <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">
                      v3.0.1 Stable
                    </p>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSidebarOpen(false)}
                aria-label="Close sidebar"
                className="md:hidden p-2 text-slate-400 hover:text-white rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
              >
                <XCircle size={22} />
              </button>
            </div>

            <div className="space-y-1">
              <p className="px-4 py-2 text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">
                Main
              </p>
              <SidebarItem
                icon={LayoutGrid}
                label="Overview"
                active={view === 'dashboard'}
                onClick={() => switchView('dashboard')}
              />
              <SidebarItem
                icon={Users}
                label="Users"
                active={view === 'users'}
                onClick={() => switchView('users')}
                badge={users.length}
              />
              <SidebarItem
                icon={ShoppingCart}
                label="Orders"
                active={view === 'orders'}
                onClick={() => switchView('orders')}
                badge={orders.length}
              />
              <SidebarItem
                icon={Package}
                label="Inventory"
                active={view === 'inventory'}
                onClick={() => switchView('inventory')}
              />

              <p className="px-4 py-2 text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mt-6">
                System
              </p>
              <SidebarItem
                icon={DollarSign}
                label="Financials"
                active={view === 'finance'}
                onClick={() => switchView('finance')}
              />
              <SidebarItem
                icon={HeadphonesIcon}
                label="Support Desk"
                active={view === 'support'}
                onClick={() => switchView('support')}
                badge={tickets.filter((t) => t.status === 'Open').length}
              />
              <SidebarItem
                icon={Key}
                label="Access Codes"
                active={view === 'invites'}
                onClick={() => switchView('invites')}
                badge={invites.filter((i) => i.status === 'active').length}
              />
              <SidebarItem
                icon={Settings}
                label="Settings"
                active={view === 'settings'}
                onClick={() => switchView('settings')}
              />
              <SidebarItem
                icon={ClipboardList}
                label="Audit Logs"
                active={view === 'audit-logs'}
                onClick={() => switchView('audit-logs')}
              />
            </div>
          </div>

          <div className="mt-auto p-4 border-t border-slate-800">
            <button
              type="button"
              onClick={logout}
              className="w-full py-3 flex items-center justify-center gap-2 text-rose-400 hover:bg-slate-800 rounded-xl transition-colors text-xs font-bold uppercase tracking-wider"
            >
              <LogOut size={16} /> Terminate
            </button>
          </div>
        </>
      }
    >
        {/* Header */}
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 flex-none z-10 sticky top-0">
          <div className="flex items-center gap-3 min-w-0">
            <IconButton
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Open sidebar"
              title="Menu"
              className="md:hidden text-slate-400 hover:text-indigo-600 hover:border-indigo-200"
            >
              <Menu size={20} />
            </IconButton>
            <h2 className="text-2xl font-black text-slate-900 capitalize tracking-tight truncate">
              {view.replace('-', ' ')}
            </h2>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-px h-8 bg-slate-200"></div>
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold text-slate-900">Admin User</p>
                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wide">
                  Online
                </p>
              </div>
              <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-bold border-2 border-white shadow-sm">
                AD
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 scrollbar-hide bg-[#F8FAFC]">
          <div className="max-w-[1600px] mx-auto space-y-8 animate-enter">
            {/* DASHBOARD VIEW */}
            {view === 'dashboard' && stats && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <StatCard
                    title="Total Revenue"
                    value={`${((stats?.totalRevenue || 0) / 100000).toFixed(2)}L`}
                    subtext="Gross Volume"
                    icon={IndianRupee}
                    colorClass="text-emerald-600"
                  />
                  <StatCard
                    title="Pending Clearance"
                    value={`${((stats?.pendingRevenue || 0) / 100000).toFixed(2)}L`}
                    subtext="In Cooling Period"
                    icon={Wallet}
                    colorClass="text-blue-600"
                  />
                  <StatCard
                    title="Orders Processed"
                    value={(stats?.totalOrders || 0).toLocaleString()}
                    subtext="+24% this week"
                    icon={ShoppingCart}
                    colorClass="text-purple-600"
                  />
                  <StatCard
                    title="System Alerts"
                    value={stats?.riskOrders || 0}
                    subtext="Action Required"
                    icon={ShieldAlert}
                    colorClass="text-rose-500"
                  />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Chart */}
                  <div className="lg:col-span-2 bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col h-[450px]">
                    <div className="flex justify-between items-center mb-8">
                      <div>
                        <h3 className="font-extrabold text-lg text-slate-900">Revenue Growth</h3>
                        <p className="text-xs font-bold text-slate-400 mt-1">
                          Real-time performance metrics
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <span className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-[10px] font-bold uppercase tracking-wide border border-indigo-100">
                          Weekly
                        </span>
                      </div>
                    </div>
                    <div className="flex-1 w-full min-h-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData}>
                          <defs>
                            <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis
                            dataKey="date"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 11, fontWeight: 600, fill: '#94a3b8' }}
                            dy={10}
                          />
                          <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 11, fontWeight: 600, fill: '#94a3b8' }}
                            tickFormatter={(v) => `${v / 1000}k`}
                          />
                          <Tooltip
                            cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 4' }}
                            contentStyle={{
                              borderRadius: '16px',
                              border: 'none',
                              boxShadow: '0 10px 40px -10px rgba(0,0,0,0.1)',
                              padding: '12px 20px',
                            }}
                            itemStyle={{ color: '#1e293b', fontWeight: 'bold' }}
                          />
                          <Area
                            type="monotone"
                            dataKey="revenue"
                            stroke="#6366f1"
                            strokeWidth={3}
                            fillOpacity={1}
                            fill="url(#colorRev)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Quick Widgets */}
                  <div className="space-y-6">
                    <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
                      <h3 className="font-extrabold text-slate-900 mb-4">User Distribution</h3>
                      <div className="space-y-4">
                        {['User', 'Mediator', 'Agency', 'Brand'].map((role, i) => {
                          const count = stats?.counts?.[role.toLowerCase()] || 0;
                          const total = Math.max(0, stats?.counts?.total || 0);
                          const pctRaw = total > 0 ? Math.round((count / total) * 100) : 0;
                          const pct = Math.max(0, Math.min(100, pctRaw));
                          return (
                            <div key={role}>
                              <div className="flex justify-between text-xs font-bold text-slate-600 mb-1">
                                <span>{role}s</span>
                                <span>
                                  {count} ({pct}%)
                                </span>
                              </div>
                              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${pct}%`, backgroundColor: COLORS[i] }}
                                ></div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="bg-indigo-900 p-6 rounded-[2rem] shadow-xl text-white relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-white opacity-10 rounded-full blur-3xl -mr-10 -mt-10"></div>
                      <h3 className="font-bold text-lg relative z-10">System Status</h3>
                      <div className="flex items-center gap-2 mt-4 text-emerald-400 font-bold text-sm">
                        <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>{' '}
                        All Systems Operational
                      </div>
                      <p className="text-indigo-200 text-xs mt-2 font-medium">
                        Last check: Just now
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* SUPPORT VIEW */}
            {view === 'support' && (
              <div className="space-y-6 animate-enter">
                <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                      <HeadphonesIcon size={24} />
                    </div>
                    <div>
                      <h3 className="text-lg font-extrabold text-slate-900">Support Desk</h3>
                      <p className="text-xs font-bold text-slate-400">
                        Manage user disputes and tickets
                      </p>
                    </div>
                  </div>
                  <div className="bg-indigo-50 text-indigo-700 px-4 py-2 rounded-xl text-xs font-bold">
                    {tickets.filter((t) => t.status === 'Open').length} Pending
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                  {isLoading ? (
                    <div className="col-span-full">
                      <EmptyState
                        title="Loading tickets"
                        description="Loading the latest support queue"
                        icon={<Spinner className="w-6 h-6 text-slate-400" />}
                        className="border-slate-200"
                      />
                    </div>
                  ) : tickets.length === 0 ? (
                    <div className="col-span-full">
                      <EmptyState
                        title="No tickets"
                        description="When users raise disputes or issues, they'll appear here."
                        className="border-slate-200"
                      />
                    </div>
                  ) : (
                    tickets.map((t) => (
                      <div
                        key={t.id}
                        className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col hover:shadow-md transition-all"
                      >
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] font-mono text-slate-400">
                                #{t.id.slice(-6)}
                              </span>
                              <StatusBadge status={t.status} />
                            </div>
                            <h4 className="font-bold text-slate-900 text-sm">{t.issueType}</h4>
                          </div>
                          <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded">
                            {new Date(t.createdAt).toLocaleDateString()}
                          </span>
                        </div>

                        <div className="bg-slate-50 p-3 rounded-xl mb-4 flex-1">
                          <p className="text-xs text-slate-600 font-medium leading-relaxed">
                            "{t.description}"
                          </p>
                        </div>

                        <div className="flex items-center justify-between mt-auto">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center font-bold text-xs text-slate-500">
                              {t.userName.charAt(0)}
                            </div>
                            <div className="text-[10px]">
                              <p className="font-bold text-slate-900">{t.userName}</p>
                              <p className="text-slate-400 font-mono">User</p>
                            </div>
                          </div>

                          {t.status === 'Open' && (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => resolveTicket(t.id, 'Resolved')}
                                className="p-2 bg-emerald-100 text-emerald-600 rounded-lg hover:bg-emerald-200 transition-colors"
                                title="Resolve"
                              >
                                <CheckCircle2 size={16} />
                              </button>
                              <button
                                type="button"
                                onClick={() => resolveTicket(t.id, 'Rejected')}
                                className="p-2 bg-slate-100 text-slate-400 rounded-lg hover:bg-rose-100 hover:text-rose-500 transition-colors"
                                title="Reject"
                              >
                                <XCircle size={16} />
                              </button>
                            </div>
                          )}

                          {t.status !== 'Open' && (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => deleteTicket(t.id)}
                                className="p-2 bg-slate-100 text-slate-400 rounded-lg hover:bg-rose-100 hover:text-rose-500 transition-colors"
                                title="Delete"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* USERS VIEW */}
            {view === 'users' && (
              <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden flex flex-col h-full min-h-0 animate-enter">
                <div className="p-5 border-b border-slate-100 flex flex-col gap-3 bg-slate-50/50">
                  <div className="flex justify-between items-center">
                    <div className="flex gap-2">
                      {['All', 'Brand', 'Agency', 'Mediator', 'User'].map((role) => (
                        <button
                          key={role}
                          type="button"
                          onClick={() => setUserRoleFilter(role)}
                          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                            userRoleFilter === role
                              ? 'bg-slate-900 text-white border-slate-900 shadow-md'
                              : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {role}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest">
                      {filteredUsers.length} Records
                    </div>
                  </div>
                  <div className="relative">
                    <Users size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search by name, mobile, email, or code..."
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      className="w-full pl-10 pr-10 py-2.5 rounded-xl text-sm border border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all bg-white placeholder:text-slate-400"
                    />
                    {userSearch && (
                      <button
                        type="button"
                        onClick={() => setUserSearch('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                        aria-label="Clear search"
                      >
                        <XCircle size={16} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50/80 text-xs font-extrabold uppercase text-slate-400 tracking-wider sticky top-0 z-10 backdrop-blur-sm">
                      <tr>
                        <th className="p-5">User Profile</th>
                        <th className="p-5">Role</th>
                        <th className="p-5">Wallet Balance</th>
                        <th className="p-5">Status</th>
                        <th className="p-5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 text-sm font-medium">
                      {filteredUsers.map((u) => (
                        <tr key={u.id} className="hover:bg-slate-50/50 transition-colors group">
                          <td className="p-5">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center font-bold text-slate-500 text-sm shadow-inner group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors overflow-hidden">
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
                                <p className="font-bold text-slate-900">{u.name}</p>
                                <p className="text-xs text-slate-400 font-mono mt-0.5">
                                  {u.mobile}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="p-5">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-600 uppercase tracking-wide border border-slate-200">
                              {u.role}
                            </span>
                          </td>
                          <td className="p-5 font-mono text-slate-700 font-bold">
                            {(u.walletBalance || 0).toLocaleString()}
                          </td>
                          <td className="p-5">
                            <StatusBadge status={u.status} />
                          </td>
                          <td className="p-5 text-right">
                            {u.role !== 'admin' && (
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => toggleUserStatus(u)}
                                  className={`p-2 rounded-lg transition-colors border ${
                                    u.status === 'active'
                                      ? 'border-rose-100 text-rose-500 hover:bg-rose-50'
                                      : 'border-emerald-100 text-emerald-500 hover:bg-emerald-50'
                                  }`}
                                  title={u.status === 'active' ? 'Suspend user' : 'Activate user'}
                                >
                                  {u.status === 'active' ? (
                                    <Ban size={16} />
                                  ) : (
                                    <CheckCircle2 size={16} />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteWallet(u)}
                                  disabled={
                                    deletingWalletId === u.id ||
                                    Number(u.walletBalance || 0) > 0 ||
                                    Number(u.walletPending || 0) > 0
                                  }
                                  className={`p-2 rounded-lg transition-colors border ${
                                    deletingWalletId === u.id
                                      ? 'border-slate-200 text-slate-400 bg-slate-100 cursor-not-allowed'
                                      : Number(u.walletBalance || 0) > 0 || Number(u.walletPending || 0) > 0
                                        ? 'border-slate-200 text-slate-300 bg-slate-50 cursor-not-allowed'
                                        : 'border-rose-100 text-rose-500 hover:bg-rose-50'
                                  }`}
                                  title="Delete wallet"
                                >
                                  <Trash2 size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteUser(u)}
                                  disabled={deletingUserId === u.id}
                                  className={`p-2 rounded-lg transition-colors border ${
                                    deletingUserId === u.id
                                      ? 'border-slate-200 text-slate-400 bg-slate-100 cursor-not-allowed'
                                      : 'border-rose-100 text-rose-500 hover:bg-rose-50'
                                  }`}
                                  title="Delete user"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* INVITES VIEW */}
            {view === 'invites' && (
              <div className="space-y-6 animate-enter">
                <div className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col md:flex-row items-end gap-6">
                  <div className="flex-1 w-full">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2 block">
                      Create Invite For
                    </label>
                    <div className="flex gap-4">
                      <select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as any)}
                        className="bg-slate-50 border border-slate-200 text-slate-700 text-sm font-bold rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                      >
                        <option value="agency">Agency Partner</option>
                        <option value="brand">Brand Account</option>
                      </select>
                      <input
                        type="text"
                        placeholder="Assignee Label (e.g. Nike)"
                        value={inviteLabel}
                        onChange={(e) => setInviteLabel(e.target.value)}
                        className="flex-1 bg-slate-50 border border-slate-200 text-slate-900 text-sm font-bold rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 placeholder:text-slate-400"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleGenerateInvite}
                    disabled={isLoading}
                    className="px-8 py-3.5 bg-slate-900 text-white rounded-xl font-bold text-sm shadow-lg hover:bg-indigo-600 transition-all active:scale-95 flex items-center gap-2 whitespace-nowrap"
                  >
                    <Plus size={18} />
                    Generate Code
                  </button>
                </div>

                <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50/80 text-xs font-extrabold uppercase text-slate-400 tracking-wider">
                      <tr>
                        <th className="p-6">Access Code</th>
                        <th className="p-6">Role</th>
                        <th className="p-6">Label</th>
                        <th className="p-6">Status</th>
                        <th className="p-6 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {invites.map((inv, i) => (
                        <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                          <td className="p-6 font-mono text-sm font-bold text-slate-800">
                            {inv.code}
                          </td>
                          <td className="p-6">
                            <StatusBadge status={inv.role} />
                          </td>
                          <td className="p-6 text-sm font-bold text-slate-600">{inv.label}</td>
                          <td className="p-6">
                            <StatusBadge status={inv.status} />
                          </td>
                          <td className="p-6 text-right">
                            <div className="flex items-center justify-end gap-3">
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(inv.code);
                                  toast.success('Copied');
                                }}
                                aria-label="Copy access code"
                                className="text-slate-400 hover:text-indigo-600 transition-colors"
                              >
                                <Copy size={18} />
                              </button>

                              {inv.status === 'active' && Number((inv as any).useCount ?? 0) === 0 && (
                                <button
                                  type="button"
                                  onClick={() => deleteInvite(inv.code)}
                                  aria-label="Delete access code"
                                  className="text-slate-400 hover:text-rose-500 transition-colors"
                                >
                                  <Trash2 size={18} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* FINANCE & ORDERS (Simplified Table Re-use) */}
            {(view === 'finance' || view === 'orders') && (
              <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden animate-enter">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <h3 className="font-extrabold text-lg text-slate-900">
                    {view === 'finance' ? 'Global Ledger' : 'Order Management'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => handleExport(view === 'finance' ? 'finance' : 'orders')}
                    className="flex items-center gap-2 text-xs font-bold text-indigo-600 bg-indigo-50 px-4 py-2 rounded-xl hover:bg-indigo-100 transition-colors"
                  >
                    <Download size={14} /> Export Report
                  </button>
                </div>
                <div className="p-4 border-b border-slate-100 flex gap-3 flex-wrap items-center">
                  <div className="flex-1 min-w-[200px]">
                    <Input
                      placeholder="Search orders (ID, buyer, product)..."
                      value={orderSearch}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOrderSearch(e.target.value)}
                      className="text-sm"
                    />
                  </div>
                  <select
                    value={orderStatusFilter}
                    onChange={(e) => setOrderStatusFilter(e.target.value)}
                    className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold bg-white"
                  >
                    <option value="All">All Statuses</option>
                    <option value="Pending">Pending</option>
                    <option value="Pending_Cooling">Cooling</option>
                    <option value="Approved_Settled">Settled</option>
                    <option value="Rejected_Fraud">Fraud</option>
                    <option value="Rejected_Expired">Expired</option>
                    <option value="Paid">Paid</option>
                  </select>
                  <span className="text-xs text-slate-400 font-bold">{filteredOrders.length} orders</span>
                </div>
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50/80 text-xs font-extrabold uppercase text-slate-400 tracking-wider sticky top-0 z-10">
                      <tr>
                        <th className="p-5">Order Ref</th>
                        <th className="p-5">Date</th>
                        <th className="p-5">Amount</th>
                        <th className="p-5">Customer</th>
                        <th className="p-5">Proofs</th>
                        <th className="p-5 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 text-sm font-medium">
                      {filteredOrders.slice(0, 200).map((o) => (
                        <tr key={o.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="p-5">
                            <div className="font-mono text-slate-500">
                              {o.externalOrderId || o.id}
                            </div>
                          </td>
                          <td className="p-5 text-slate-600">
                            {new Date(o.createdAt).toLocaleDateString()}
                          </td>
                          <td className="p-5 font-mono text-slate-900 font-bold">{o.total}</td>
                          <td className="p-5 text-slate-700">{o.buyerName}</td>
                          <td className="p-5">
                            <button
                              type="button"
                              onClick={() => setProofModal(o)}
                              className="text-xs font-bold text-indigo-600 hover:text-indigo-800 underline"
                            >
                              View
                            </button>
                          </td>
                          <td className="p-5 text-right">
                            <StatusBadge
                              status={
                                o.affiliateStatus === 'Unchecked'
                                  ? o.paymentStatus
                                  : o.affiliateStatus
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* INVENTORY VIEW */}
            {view === 'inventory' && (
              <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden animate-enter">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                  <h3 className="font-extrabold text-lg text-slate-900">Live Inventory</h3>
                  <span className="text-xs text-slate-400 font-bold">{filteredProducts.length} products</span>
                </div>
                <div className="p-4 border-b border-slate-100">
                  <Input
                    placeholder="Search products (name, category, platform)..."
                    value={inventorySearch}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInventorySearch(e.target.value)}
                    className="text-sm"
                  />
                </div>
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-xs font-extrabold uppercase text-slate-400 tracking-wider">
                    <tr>
                      <th className="p-5">Product</th>
                      <th className="p-5">Category</th>
                      <th className="p-5 text-right">Price</th>
                      <th className="p-5 text-right">Commission</th>
                      <th className="p-5 text-right">Status</th>
                      <th className="p-5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 text-sm font-medium">
                    {filteredProducts.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="p-5">
                          <div className="flex items-center gap-3">
                            <img src={p.image} alt={p.title ? String(p.title) : 'Product image'} className="w-8 h-8 rounded-lg object-contain bg-white border border-slate-100 p-1" />
                            <span className="truncate max-w-[200px] text-slate-900 font-bold">
                              {p.title}
                            </span>
                          </div>
                        </td>
                        <td className="p-5 text-slate-500 uppercase text-xs font-bold">
                          {p.category}
                        </td>
                        <td className="p-5 text-right font-mono text-slate-900">{p.price}</td>
                        <td className="p-5 text-right font-mono text-emerald-600">
                          {p.commission}
                        </td>
                        <td className="p-5 text-right">
                          <span
                            className={`text-[10px] font-bold px-2 py-1 rounded ${p.active ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}
                          >
                            {p.active ? 'ACTIVE' : 'INACTIVE'}
                          </span>
                        </td>
                        <td className="p-5 text-right">
                          <button
                            type="button"
                            onClick={() => deleteProduct(p.id)}
                            disabled={deletingProductId === p.id}
                            className={`p-2 rounded-lg transition-colors border ${
                              deletingProductId === p.id
                                ? 'border-slate-200 text-slate-400 bg-slate-100 cursor-not-allowed'
                                : 'border-rose-100 text-rose-500 hover:bg-rose-50'
                            }`}
                            title="Delete product"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* SETTINGS VIEW */}
            {view === 'settings' && (
              <div className="max-w-xl mx-auto bg-white rounded-[2rem] shadow-sm border border-slate-200 p-8 animate-enter">
                <h3 className="text-xl font-black text-slate-900 mb-6 flex items-center gap-2">
                  <Settings size={24} /> System Configuration
                </h3>
                <div className="space-y-6">
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1.5 block">
                      Platform Name
                    </label>
                    <input
                      type="text"
                      readOnly
                      value="BUZZMA Ecosystem"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-slate-700"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1.5 block">
                      Admin Contact
                    </label>
                    <input
                      type="text"
                      value={configEmail}
                      onChange={(e) => setConfigEmail(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 font-bold text-slate-900 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div className="pt-4 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={handleSaveConfig}
                      className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                      <Save size={18} /> Save Configuration
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* AUDIT LOGS VIEW */}
            {view === 'audit-logs' && (
              <div className="animate-enter">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-black text-slate-900 flex items-center gap-2">
                    <ClipboardList size={24} /> Audit Logs
                  </h3>
                  <button
                    type="button"
                    onClick={async () => {
                      setAuditLoading(true);
                      try {
                        const data = await api.admin.getAuditLogs({ limit: 100 });
                        setAuditLogs(Array.isArray(data) ? data : data?.logs ?? []);
                      } catch (e) {
                        console.error(e);
                        toast.error('Failed to load audit logs');
                      } finally {
                        setAuditLoading(false);
                      }
                    }}
                    className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-700 transition-all"
                  >
                    {auditLoading ? 'Loading...' : 'Refresh'}
                  </button>
                </div>
                <div className="mb-4">
                  <input
                    type="text"
                    value={auditFilter}
                    onChange={(e) => setAuditFilter(e.target.value)}
                    placeholder="Filter by action, entity, or actor..."
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300"
                  />
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="p-4 text-left text-[10px] font-bold text-slate-400 uppercase">Time</th>
                        <th className="p-4 text-left text-[10px] font-bold text-slate-400 uppercase">Action</th>
                        <th className="p-4 text-left text-[10px] font-bold text-slate-400 uppercase">Entity</th>
                        <th className="p-4 text-left text-[10px] font-bold text-slate-400 uppercase">Actor</th>
                        <th className="p-4 text-left text-[10px] font-bold text-slate-400 uppercase">Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs
                        .filter((log) => {
                          if (!auditFilter.trim()) return true;
                          const q = auditFilter.toLowerCase();
                          return (
                            (log.action || '').toLowerCase().includes(q) ||
                            (log.entityType || '').toLowerCase().includes(q) ||
                            (log.entityId || '').toLowerCase().includes(q) ||
                            (log.actorUserId || '').toLowerCase().includes(q)
                          );
                        })
                        .map((log: any, idx: number) => (
                          <tr key={log.id || idx} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="p-4 text-xs text-slate-500 font-mono whitespace-nowrap">
                              {log.createdAt ? new Date(log.createdAt).toLocaleString() : '-'}
                            </td>
                            <td className="p-4">
                              <span className="px-2 py-0.5 bg-slate-100 rounded text-[10px] font-bold uppercase">
                                {(log.action || '').replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td className="p-4 text-xs font-mono text-slate-600">
                              {log.entityType && <span className="text-slate-400">{log.entityType}/</span>}
                              <span className="text-slate-700 break-all">{log.entityId?.slice(-8) || '-'}</span>
                            </td>
                            <td className="p-4 text-xs font-mono text-slate-500">
                              {log.actorUserId?.slice(-8) || 'System'}
                            </td>
                            <td className="p-4 text-[10px] text-slate-400 max-w-[200px] truncate">
                              {log.metadata ? JSON.stringify(log.metadata).slice(0, 80) : '-'}
                            </td>
                          </tr>
                        ))}
                      {auditLogs.length === 0 && (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-sm text-slate-400 font-bold">
                            Click Refresh to load audit logs.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

      {/* Proof Viewer Modal */}
      {proofModal && (
        <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setProofModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <div>
                <h3 className="font-extrabold text-lg text-slate-900">Order Proofs</h3>
                <p className="text-xs text-slate-500 font-mono mt-1">{proofModal.externalOrderId || proofModal.id}</p>
              </div>
              <button type="button" onClick={() => setProofModal(null)} className="p-2 rounded-lg hover:bg-slate-100">
                <span className="text-slate-400 text-xl font-bold">&times;</span>
              </button>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-slate-400 font-bold text-xs uppercase">Buyer</span><p className="font-bold text-slate-900">{proofModal.buyerName}</p></div>
                <div><span className="text-slate-400 font-bold text-xs uppercase">Amount</span><p className="font-bold text-slate-900">₹{proofModal.total}</p></div>
                <div><span className="text-slate-400 font-bold text-xs uppercase">Status</span><p><StatusBadge status={proofModal.affiliateStatus === 'Unchecked' ? proofModal.paymentStatus : proofModal.affiliateStatus} /></p></div>
                <div><span className="text-slate-400 font-bold text-xs uppercase">Payment</span><p className="font-bold text-slate-900">{proofModal.paymentStatus}</p></div>
                {proofModal.soldBy && <div><span className="text-slate-400 font-bold text-xs uppercase">Sold By</span><p className="font-bold text-slate-900">{proofModal.soldBy}</p></div>}
                {proofModal.orderDate && <div><span className="text-slate-400 font-bold text-xs uppercase">Order Date</span><p className="font-bold text-slate-900">{new Date(proofModal.orderDate).toLocaleDateString()}</p></div>}
                {proofModal.extractedProductName && <div className="col-span-2"><span className="text-slate-400 font-bold text-xs uppercase">Extracted Product</span><p className="font-bold text-slate-900">{proofModal.extractedProductName}</p></div>}
              </div>
              {[
                { label: 'Purchase Proof', url: proofModal.screenshots?.order },
                { label: 'Rating Proof', url: proofModal.screenshots?.rating },
                { label: 'Review Proof', url: proofModal.screenshots?.review },
                { label: 'Payment Screenshot', url: proofModal.screenshots?.payment },
              ].map(({ label, url }) => (
                <div key={label}>
                  <h4 className="text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">{label}</h4>
                  {url ? (
                    <img src={url} alt={label} className="w-full max-h-[300px] object-contain rounded-xl border border-slate-200 bg-slate-50" />
                  ) : (
                    <div className="py-4 text-center text-xs text-slate-400 font-bold bg-slate-50 rounded-xl border border-dashed border-slate-200">Not uploaded</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </DesktopShell>
  );
};
