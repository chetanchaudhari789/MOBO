import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  LogOut,
  Building2,
  Briefcase,
  Plus,
  Search,
  Trash2,
  CheckCircle,
  Users,
  LayoutDashboard,
  ChevronRight,
  ArrowUpRight,
  Globe,
  Wallet,
  TrendingUp,
  AlertCircle,
  Lock,
  Image as ImageIcon,
  Link as LinkIcon,
  Bell,
  XCircle,
  ShoppingBag,
  Eye,
  X,
  Copy,
  Menu,
  CreditCard,
  Landmark,
  Send,
  Star,
  MessageCircle,
  FileText,
  ExternalLink,
  History,
  Save,
  Edit2,
  Key,
  Download,
  Phone,
  Mail,
  Camera,
  RefreshCw,
} from 'lucide-react';
import { api } from '../services/api';
import { subscribeRealtime } from '../services/realtime';
import { useRealtimeConnection } from '../hooks/useRealtimeConnection';
import { User, Campaign, Order } from '../types';
import { EmptyState, Spinner } from '../components/ui';
import { DesktopShell } from '../components/DesktopShell';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';

// --- TYPES ---
type Tab = 'dashboard' | 'agencies' | 'campaigns' | 'requests' | 'orders' | 'profile';

// --- COMPONENTS ---

const SidebarItem = ({ icon, label, active, onClick, badge }: any) => (
  <button
    onClick={onClick}
    aria-current={active ? 'page' : undefined}
    className={`w-full flex items-center justify-between px-5 py-4 rounded-2xl transition-all duration-300 group mb-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white motion-reduce:transition-none motion-reduce:transform-none ${
      active
        ? 'bg-zinc-900 text-white shadow-xl shadow-zinc-900/10 scale-100'
        : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900'
    }`}
  >
    <div className="flex items-center gap-4 min-w-0 flex-1">
      <span
        className={`transition-colors flex-shrink-0 ${active ? 'text-lime-400' : 'group-hover:text-zinc-900'}`}
      >
        {React.cloneElement(icon, { size: 20, strokeWidth: active ? 2.5 : 2 })}
      </span>
      <span
        className={`font-bold text-[15px] tracking-wide whitespace-nowrap truncate ${active ? 'font-extrabold' : ''}`}
      >
        {label}
      </span>
    </div>
    {badge > 0 && (
      <span className="bg-lime-500 text-zinc-900 text-[10px] font-extrabold px-2.5 py-1 rounded-full shadow-sm flex-shrink-0 ml-2">
        {badge}
      </span>
    )}
  </button>
);

const StatCard = ({ label, value, icon, trend, dark }: any) => (
  <div
    className={`p-6 rounded-[2rem] flex flex-col justify-between h-44 relative overflow-hidden group hover:-translate-y-1 transition-all duration-300 ${
      dark
        ? 'bg-zinc-900 text-white shadow-2xl shadow-zinc-900/20'
        : 'bg-white border border-zinc-100 shadow-sm hover:shadow-xl hover:shadow-zinc-200/50'
    }`}
  >
    {/* Decor */}
    <div
      className={`absolute -right-6 -top-6 w-32 h-32 rounded-full blur-3xl transition-opacity ${
        dark ? 'bg-lime-500/20 opacity-100' : 'bg-zinc-200 opacity-0 group-hover:opacity-50'
      }`}
    ></div>

    <div className="flex justify-between items-start z-10">
      <div
        className={`p-3.5 rounded-2xl ${dark ? 'bg-white/10 text-lime-400' : 'bg-zinc-50 text-zinc-900'}`}
      >
        {icon}
      </div>
      {trend && (
        <div
          className={`flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full ${
            dark ? 'bg-lime-400/10 text-lime-400' : 'bg-green-50 text-green-600'
          }`}
        >
          <TrendingUp size={12} /> {trend}
        </div>
      )}
    </div>

    <div className="z-10">
      <p
        className={`text-xs font-bold uppercase tracking-widest mb-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}
      >
        {label}
      </p>
      <h3 className="text-4xl font-extrabold tracking-tight">{value}</h3>
    </div>
  </div>
);

// --- VIEWS ---

const BrandProfileView = () => {
  const { user, updateUser } = useAuth();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: user?.name || '',
    mobile: user?.mobile || '',
    email: user?.email || '',
  });
  const [avatar, setAvatar] = useState(user?.avatar);

  useEffect(() => {
    if (user) {
      setForm({
        name: user.name || '',
        mobile: user.mobile || '',
        email: user.email || '',
      });
      setAvatar(user.avatar);
    }
  }, [user]);

  const handleSave = async () => {
    setLoading(true);
    try {
      await updateUser({
        name: form.name,
        email: form.email,
        avatar,
      });
      setIsEditing(false);
    } catch (e) {
      toast.error(String((e as any)?.message || 'Failed to update profile.'));
    } finally {
      setLoading(false);
    }
  };

  const handleFile = (e: any) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setAvatar(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="max-w-5xl mx-auto animate-enter pb-12">
      {/* Header with Cover */}
      <div className="bg-white rounded-[2.5rem] shadow-sm border border-zinc-100 overflow-hidden relative mb-8">
        <div className="h-40 bg-zinc-900 relative">
          <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div>
          <div className="absolute inset-0 bg-gradient-to-r from-zinc-800 to-black opacity-80"></div>
        </div>
        <div className="px-8 pb-8 flex flex-col md:flex-row items-end -mt-16 gap-8">
          <div
            className="relative group cursor-pointer"
            onClick={() => isEditing && fileInputRef.current?.click()}
          >
            <div className="w-36 h-36 rounded-[2rem] bg-white p-2 shadow-2xl border border-zinc-100 rotate-3 transition-transform group-hover:rotate-0">
              <div className="w-full h-full bg-zinc-100 rounded-[1.5rem] flex items-center justify-center text-5xl font-black text-zinc-300 overflow-hidden relative">
                {avatar ? (
                  <img src={avatar} className="w-full h-full object-cover" />
                ) : (
                  user?.name?.charAt(0)
                )}
                {isEditing && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white backdrop-blur-[2px] transition-opacity">
                    <Camera size={28} />
                  </div>
                )}
              </div>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/*"
              onChange={handleFile}
            />
          </div>
          <div className="flex-1 pb-2">
            <h2 className="text-4xl font-black text-zinc-900 tracking-tight">{user?.name}</h2>
            <div className="flex wrap items-center gap-3 mt-3">
              <span className="px-3 py-1 bg-lime-100 text-lime-700 rounded-lg text-xs font-bold border border-lime-200">
                Verified Brand
              </span>
              <span className="font-mono text-xs text-zinc-400 font-bold bg-zinc-50 px-2 py-1 rounded border border-zinc-100 flex items-center gap-2">
                <Key size={12} /> {user?.brandCode}
              </span>
            </div>
          </div>
          <button
            onClick={() => (isEditing ? handleSave() : setIsEditing(true))}
            className={`px-8 py-3.5 rounded-xl font-bold text-sm transition-all shadow-lg active:scale-95 flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${isEditing ? 'bg-black text-white hover:bg-zinc-800' : 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200'}`}
          >
            {loading ? (
              <RefreshCw className="animate-spin motion-reduce:animate-none" size={18} />
            ) : isEditing ? (
              <>
                <Save size={18} /> Save Changes
              </>
            ) : (
              <>
                <Edit2 size={18} /> Edit Profile
              </>
            )}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white p-10 rounded-[2.5rem] border border-zinc-100 shadow-sm space-y-8 h-full">
          <h3 className="font-extrabold text-xl text-zinc-900 flex items-center gap-3">
            <Building2 size={24} className="text-lime-500" /> Brand Identity
          </h3>
          <div className="space-y-6">
            <div className="group">
              <label className="text-[11px] font-extrabold text-zinc-400 uppercase tracking-wider ml-1 mb-2 block">
                Brand Name
              </label>
              <input
                type="text"
                disabled={!isEditing}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full p-4 bg-zinc-50 rounded-2xl font-bold text-zinc-900 outline-none focus:ring-4 focus:ring-lime-100 focus:bg-white transition-all disabled:opacity-70 disabled:bg-zinc-50/50"
              />
            </div>
            <div className="group">
              <label className="text-[11px] font-extrabold text-zinc-400 uppercase tracking-wider ml-1 mb-2 block">
                Brand Code (Immutable)
              </label>
              <div className="w-full p-4 bg-zinc-100 rounded-2xl font-bold text-zinc-500 font-mono border border-zinc-200 flex items-center gap-3">
                <Lock size={16} /> {user?.brandCode}
              </div>
              <p className="text-[10px] text-zinc-400 mt-2 ml-1 font-medium">
                This code is used by agencies to identify your organization.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white p-10 rounded-[2.5rem] border border-zinc-100 shadow-sm space-y-8 h-full">
          <h3 className="font-extrabold text-xl text-zinc-900 flex items-center gap-3">
            <Phone size={24} className="text-lime-500" /> Contact Details
          </h3>
          <div className="space-y-6">
            <div className="group">
              <label className="text-[11px] font-extrabold text-zinc-400 uppercase tracking-wider ml-1 mb-2 block">
                Mobile Number
              </label>
              <div className="relative">
                <Phone
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400"
                  size={18}
                />
                <input
                  type="tel"
                  disabled
                  value={form.mobile}
                  onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                  className="w-full pl-12 pr-4 py-4 bg-zinc-50 rounded-2xl font-bold text-zinc-900 outline-none focus:ring-4 focus:ring-lime-100 focus:bg-white transition-all disabled:opacity-70 disabled:bg-zinc-50/50"
                />
              </div>
              <p className="text-[10px] text-zinc-400 mt-2 ml-1 font-medium">
                Mobile number cannot be changed.
              </p>
            </div>
            <div className="group">
              <label className="text-[11px] font-extrabold text-zinc-400 uppercase tracking-wider ml-1 mb-2 block">
                Email Address
              </label>
              <div className="relative">
                <Mail
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400"
                  size={18}
                />
                <input
                  type="email"
                  disabled={!isEditing}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="brand@company.com"
                  className="w-full pl-12 pr-4 py-4 bg-zinc-50 rounded-2xl font-bold text-zinc-900 outline-none focus:ring-4 focus:ring-lime-100 focus:bg-white transition-all disabled:opacity-70 disabled:bg-zinc-50/50"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const DashboardView = ({
  campaigns,
  agencies,
  orders,
}: {
  campaigns: Campaign[];
  agencies: User[];
  orders: Order[];
}) => {
  const totalRevenue = orders.reduce((acc, o) => acc + o.total, 0);
  const activeCampaigns = campaigns.filter((c) => c.status === 'Active').length;
  const totalReach = campaigns.reduce((acc, c) => acc + c.totalSlots, 0);

  const formatRupees = (value: number) => {
    const n = Number(value || 0);
    return `â‚¹${Math.round(n).toLocaleString('en-IN')}`;
  };

  const revenueData = useMemo(() => {
    const days = 7;
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);

    const localDayKey = (d: Date) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };

    const totalsByDay = new Map<string, number>();
    for (const o of orders) {
      const d = new Date(o.createdAt);
      if (Number.isNaN(d.getTime())) continue;
      if (d < start || d > now) continue;
      const key = localDayKey(d);
      totalsByDay.set(key, (totalsByDay.get(key) ?? 0) + (Number(o.total) || 0));
    }

    const points: Array<{ name: string; revenue: number; dateKey: string }> = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const dateKey = localDayKey(d);
      const name = d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
      points.push({ name, revenue: totalsByDay.get(dateKey) ?? 0, dateKey });
    }

    return points;
  }, [orders]);

  const campaignPerformance = campaigns.slice(0, 5).map((c) => ({
    name: c.title.split(' ')[0],
    sold: c.usedSlots,
    remaining: Math.max(0, c.totalSlots - c.usedSlots),
    total: c.totalSlots,
  }));

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-enter">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
        <div>
          <h1 className="text-4xl font-extrabold text-zinc-900 tracking-tight mb-2">
            Command Center
          </h1>
          <p className="text-zinc-500 font-medium">
            Real-time overview of your market performance.
          </p>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          label="Total Revenue"
          value={`â‚¹${(totalRevenue / 100000).toFixed(2)}L`}
          icon={<Wallet size={24} />}
          dark
        />
        <StatCard label="Active Campaigns" value={activeCampaigns} icon={<Briefcase size={24} />} />
        <StatCard
          label="Partner Agencies"
          value={agencies.length}
          icon={<Users size={24} />}
        />
        <StatCard
          label="Inventory Reach"
          value={`${(totalReach / 1000).toFixed(1)}k`}
          icon={<Globe size={24} />}
          dark
        />
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-auto lg:h-[400px]">
        {/* Revenue Chart */}
        <div className="lg:col-span-2 bg-white p-8 rounded-[2.5rem] shadow-sm border border-zinc-100 relative overflow-hidden h-[400px] lg:h-full">
          <div className="flex justify-between items-center mb-8">
            <h3 className="font-bold text-lg text-zinc-900">Revenue Trajectory</h3>
            <div className="flex gap-2">
              <span className="w-3 h-3 rounded-full bg-lime-500"></span>
              <span className="text-xs font-bold text-zinc-400 uppercase">Gross Sales</span>
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 top-20 px-4 pb-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueData}>
                <defs>
                  <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#84cc16" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#84cc16" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  fontSize={12}
                  tick={{ fill: '#a1a1aa' }}
                  dy={10}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  fontSize={12}
                  tick={{ fill: '#a1a1aa' }}
                  tickFormatter={(v) => formatRupees(Number(v))}
                />
                <Tooltip
                  cursor={{ stroke: '#d4d4d8', strokeWidth: 1, strokeDasharray: '4 4' }}
                  contentStyle={{
                    borderRadius: '16px',
                    border: 'none',
                    boxShadow: '0 10px 40px -10px rgba(0,0,0,0.1)',
                    padding: '12px 20px',
                  }}
                  itemStyle={{ color: '#18181b', fontWeight: 'bold' }}
                  formatter={(value: any) => formatRupees(Number(value))}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#65a30d"
                  strokeWidth={4}
                  fillOpacity={1}
                  fill="url(#colorRev)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Campaign Inventory Chart */}
        <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-zinc-100 flex flex-col h-[400px] lg:h-full">
          <div className="mb-4">
            <h3 className="font-bold text-lg text-zinc-900">Inventory Fill Rate</h3>
            <div className="flex items-center gap-3 mt-2">
              <span className="flex items-center gap-1 text-[10px] font-bold text-zinc-400 uppercase">
                <span className="w-2 h-2 rounded-full bg-lime-500"></span> Sold
              </span>
              <span className="flex items-center gap-1 text-[10px] font-bold text-zinc-400 uppercase">
                <span className="w-2 h-2 rounded-full bg-zinc-100"></span> Remaining
              </span>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={campaignPerformance}
                layout="vertical"
                barSize={24}
                margin={{ left: 10, right: 10 }}
              >
                <XAxis type="number" hide />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={100}
                  tick={{ fontSize: 12, fontWeight: 600, fill: '#52525b' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'transparent' }}
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-zinc-900 text-white p-3 rounded-xl shadow-xl text-xs font-bold">
                          <p className="mb-1 text-zinc-400 uppercase">{data.name}</p>
                          <p>
                            Sold: <span className="text-lime-400">{data.sold}</span> / {data.total}
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="sold" stackId="a" fill="#84cc16" radius={[4, 0, 0, 4]} />
                <Bar dataKey="remaining" stackId="a" fill="#f4f4f5" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

const OrdersView = ({ user }: any) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [viewProofOrder, setViewProofOrder] = useState<Order | null>(null);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const getOrderStatusBadge = (o: Order) => {
    const wf = String(o.workflowStatus || '').trim();
    const pay = String(o.paymentStatus || '').trim();
    const aff = String(o.affiliateStatus || '').trim();

    // Prefer workflow for "what stage is this order in?".
    const label = wf || aff || pay || 'Unknown';

    const isGood = pay === 'Paid' || wf === 'COMPLETED' || aff === 'Approved_Settled';
    const isBad = wf === 'REJECTED' || wf === 'FAILED' || aff === 'Rejected' || aff === 'Fraud_Alert' || aff === 'Frozen_Disputed' || pay === 'Failed';
    const isAction = wf === 'UNDER_REVIEW' || wf === 'PROOF_SUBMITTED' || aff === 'Unchecked' || aff === 'Pending_Cooling';

    const cls = isGood
      ? 'bg-green-100 text-green-700'
      : isBad
        ? 'bg-red-100 text-red-700'
        : isAction
          ? 'bg-orange-100 text-orange-700'
          : 'bg-zinc-100 text-zinc-700';

    return (
      <span className={`px-3 py-1 text-[10px] font-bold rounded-full uppercase ${cls}`}>
        {label.replace(/_/g, ' ')}
      </span>
    );
  };

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      setIsLoading(true);
      try {
        const data = await api.brand.getBrandOrders(user.name);
        if (!cancelled) setOrders(data);
      } catch {
        if (!cancelled) setOrders([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    fetch();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const filtered = orders.filter((o) => {
    const q = search.toLowerCase();
    const title = String(o.items?.[0]?.title || '').toLowerCase();
    return o.id.toLowerCase().includes(q) || title.includes(q);
  });

  const handleExport = () => {
    const headers = [
      'Order ID',
      'Date',
      'Time',
      'Product',
      'Category',
      'Platform',
      'Deal Type',
      'Unit Price',
      'Quantity',
      'Total Value',
      'Agency Name',
      'Partner ID',
      'Buyer Name',
      'Buyer Mobile',
      'Status',
      'Payment Status',
      'Verification Status',
      'External Order ID',
      'Proof: Order',
      'Proof: Payment',
      'Proof: Rating',
      'Proof: Review Link',
    ];

    const csvRows = [headers.join(',')];

    filtered.forEach((o) => {
      const dateObj = new Date(o.createdAt);
      const date = dateObj.toLocaleDateString();
      const time = dateObj.toLocaleTimeString();
      const item = o.items[0];

      const row = [
        o.id,
        date,
        time,
        `"${(item?.title || '').replace(/"/g, '""')}"`,
        item?.dealType || 'General',
        item?.platform || '',
        item?.dealType || 'Discount',
        item?.priceAtPurchase,
        item?.quantity || 1,
        o.total,
        `"${(o.agencyName || 'Direct').replace(/"/g, '""')}"`,
        o.managerName,
        `"${(o.buyerName || '').replace(/"/g, '""')}"`,
        `"${(o.buyerMobile || '').replace(/"/g, '""')}"`,
        o.status,
        o.paymentStatus,
        o.affiliateStatus,
        o.externalOrderId || 'N/A',
        o.screenshots?.order ? 'Yes' : 'No',
        o.screenshots?.payment ? 'Yes' : 'No',
        o.screenshots?.rating ? 'Yes' : 'No',
        o.reviewLink ? 'Yes' : 'No',
      ];
      csvRows.push(row.join(','));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brand_orders_report_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <>
      <div className="max-w-7xl mx-auto animate-enter pb-12">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <h2 className="text-3xl font-extrabold text-zinc-900">Order Intelligence</h2>
          <div className="flex gap-3 w-full md:w-auto">
            <div className="relative group flex-1 md:w-80">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Search
                  size={18}
                  className="text-zinc-400 group-focus-within:text-zinc-900 transition-colors"
                />
              </div>
              <input
                type="text"
                placeholder="Search Orders..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-12 pr-10 py-3.5 bg-white border border-zinc-200 rounded-2xl text-sm font-bold outline-none focus:border-zinc-900 focus:ring-4 focus:ring-zinc-100 transition-all shadow-sm placeholder:text-zinc-400 text-zinc-900"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-400 hover:text-zinc-900 transition-colors"
                >
                  <XCircle size={16} />
                </button>
              )}
            </div>
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-5 py-3.5 bg-zinc-900 text-white rounded-2xl font-bold text-sm shadow-lg hover:bg-black transition-all active:scale-95 whitespace-nowrap"
            >
              <Download size={18} /> <span className="hidden md:inline">Export Report</span>
            </button>
          </div>
        </div>

        <div className="bg-white rounded-[2.5rem] border border-zinc-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[800px]">
              <thead className="bg-zinc-50 text-zinc-400 text-xs font-bold uppercase tracking-wider">
                <tr>
                  <th className="p-6">Order ID</th>
                  <th className="p-6">Product</th>
                  <th className="p-6">Agency</th>
                  <th className="p-6">Partner</th>
                  <th className="p-6 text-right">Value</th>
                  <th className="p-6 text-right">Status</th>
                  <th className="p-6 text-right">Proof</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="p-8">
                      <EmptyState
                        title="Loading orders"
                        description="Fetching the latest ordersâ€¦"
                        icon={<Spinner className="w-6 h-6 text-zinc-400" />}
                        className="bg-transparent"
                      />
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8">
                      <EmptyState
                        title="No orders"
                        description={search ? 'Try a different search term.' : 'Orders will appear here once customers place them.'}
                        icon={<ShoppingBag size={22} className="text-zinc-400" />}
                        className="bg-transparent"
                      />
                    </td>
                  </tr>
                ) : (
                  filtered.map((o) => (
                    <tr key={o.id} className="hover:bg-zinc-50/50 transition-colors group">
                      <td className="p-6 font-mono text-xs font-bold text-zinc-500">
                        {o.id.slice(-6)}
                      </td>
                      <td className="p-6">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-white rounded-lg border border-zinc-100 p-1 flex-shrink-0">
                            <img
                              src={o.items[0].image}
                              className="w-full h-full object-contain mix-blend-multiply"
                            />
                          </div>
                          <span className="text-sm font-bold text-zinc-900 line-clamp-1">
                            {o.items[0]?.title || 'Unknown'}
                          </span>
                        </div>
                      </td>
                      <td className="p-6">
                        <span className="text-xs font-bold bg-zinc-100 text-zinc-600 px-2 py-1 rounded">
                          {o.agencyName || 'Direct'}
                        </span>
                      </td>
                      <td className="p-6 text-sm text-zinc-700">
                        <span className="font-mono text-xs text-zinc-500">{o.managerName || '-'}</span>
                      </td>
                      <td className="p-6 text-right font-bold text-zinc-900">â‚¹{o.total}</td>
                      <td className="p-6 text-right">
                        {getOrderStatusBadge(o)}
                      </td>
                      <td className="p-6 text-right">
                        {o.screenshots?.payment || o.screenshots?.order ? (
                          <button
                            onClick={() => setViewProofOrder(o)}
                            className="w-8 h-8 bg-white border border-zinc-200 rounded-lg flex items-center justify-center text-zinc-400 hover:text-black hover:border-black transition-colors ml-auto"
                          >
                            <Eye size={14} />
                          </button>
                        ) : (
                          <span className="text-zinc-200">-</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {viewProofOrder && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-enter"
          onClick={() => setViewProofOrder(null)}
        >
          <div
            className="bg-white w-full max-w-lg rounded-[2rem] p-6 shadow-2xl relative flex flex-col max-h-[85vh] animate-enter"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setViewProofOrder(null)}
              className="absolute top-4 right-4 p-2 bg-zinc-50 rounded-full hover:bg-zinc-100 transition-colors"
            >
              <X size={18} />
            </button>

            <div className="mb-6">
              <h3 className="font-extrabold text-lg text-zinc-900 mb-1">Proof of Performance</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500 font-bold">
                  Order #{viewProofOrder.id.slice(-6)}
                </span>
                <span className="w-1 h-1 bg-zinc-300 rounded-full"></span>
                <span
                  className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${
                    viewProofOrder.items[0].dealType === 'Rating'
                      ? 'bg-orange-50 text-orange-600 border-orange-100'
                      : viewProofOrder.items[0].dealType === 'Review'
                        ? 'bg-purple-50 text-purple-600 border-purple-100'
                        : 'bg-blue-50 text-blue-600 border-blue-100'
                  }`}
                >
                  {viewProofOrder.items[0].dealType || 'Discount'} Deal
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-hide space-y-6 pr-2">
              {/* Product Summary */}
              <div className="flex gap-4 p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                <img
                  src={viewProofOrder.items[0].image}
                  className="w-14 h-14 object-contain mix-blend-multiply rounded-xl bg-white border border-zinc-100 p-1"
                />
                <div>
                  <p className="text-sm font-bold text-zinc-900 line-clamp-1">
                    {viewProofOrder.items[0].title}
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">
                    Value:{' '}
                    <span className="font-mono font-bold text-zinc-900">
                      â‚¹{viewProofOrder.total}
                    </span>
                  </p>
                </div>
              </div>

              {/* 1. Mandatory Order Screenshot */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-extrabold text-zinc-400 uppercase tracking-widest">
                  <FileText size={14} /> Purchase Proof
                </div>
                {viewProofOrder.screenshots?.order ? (
                  <div className="rounded-2xl border-2 border-zinc-100 overflow-hidden shadow-sm">
                    <img src={viewProofOrder.screenshots.order} className="w-full h-auto block" />
                  </div>
                ) : (
                  <div className="p-8 border-2 border-dashed border-red-200 bg-red-50 rounded-2xl text-center">
                    <AlertCircle size={24} className="mx-auto text-red-400 mb-2" />
                    <p className="text-xs font-bold text-red-500">Missing Order Screenshot</p>
                  </div>
                )}
              </div>

              {/* 2. Rating Screenshot (Conditional) */}
              {viewProofOrder.items[0].dealType === 'Rating' && (
                <div className="space-y-2 animate-slide-up">
                  <div className="flex items-center gap-2 text-xs font-extrabold text-orange-400 uppercase tracking-widest">
                    <Star size={14} /> Rating Proof
                  </div>
                  {viewProofOrder.screenshots?.rating ? (
                    <div className="rounded-2xl border-2 border-orange-100 overflow-hidden shadow-sm relative">
                      <div className="absolute top-2 right-2 bg-orange-500 text-white text-[9px] font-bold px-2 py-1 rounded-lg">
                        5 Stars
                      </div>
                      <img
                        src={viewProofOrder.screenshots.rating}
                        className="w-full h-auto block"
                      />
                    </div>
                  ) : (
                    <div className="p-6 border-2 border-dashed border-orange-200 bg-orange-50 rounded-2xl text-center">
                      <p className="text-xs font-bold text-orange-500">
                        Waiting for Rating Screenshot...
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* 3. Review Link (Conditional) */}
              {viewProofOrder.items[0].dealType === 'Review' && (
                <div className="space-y-2 animate-slide-up">
                  <div className="flex items-center gap-2 text-xs font-extrabold text-purple-400 uppercase tracking-widest">
                    <MessageCircle size={14} /> Live Review
                  </div>
                  {viewProofOrder.reviewLink ? (
                    <a
                      href={viewProofOrder.reviewLink}
                      target="_blank"
                      className="flex items-center justify-between p-4 bg-purple-50 text-purple-700 rounded-2xl font-bold text-xs border border-purple-100 hover:bg-purple-100 transition-colors group"
                    >
                      <span className="truncate flex-1 mr-2">{viewProofOrder.reviewLink}</span>
                      <ExternalLink
                        size={16}
                        className="group-hover:scale-110 transition-transform"
                      />
                    </a>
                  ) : (
                    <div className="p-6 border-2 border-dashed border-purple-200 bg-purple-50 rounded-2xl text-center">
                      <p className="text-xs font-bold text-purple-500">Review Link Not Submitted</p>
                    </div>
                  )}
                </div>
              )}

              {/* 4. Payment Proof (Optional/Generic) */}
              {viewProofOrder.screenshots?.payment &&
                viewProofOrder.screenshots.payment !== 'verified' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-extrabold text-zinc-400 uppercase tracking-widest">
                      <CreditCard size={14} /> Payment Confirmation
                    </div>
                    <div className="rounded-2xl border-2 border-zinc-100 overflow-hidden shadow-sm">
                      <img
                        src={viewProofOrder.screenshots.payment}
                        className="w-full h-auto block"
                      />
                    </div>
                  </div>
                )}
            </div>

            <div className="pt-4 mt-2 border-t border-zinc-100">
              <button
                onClick={() => setViewProofOrder(null)}
                className="w-full py-3 bg-zinc-900 text-white rounded-xl font-bold text-sm hover:bg-black transition-colors shadow-lg"
              >
                Close Viewer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const CampaignsView = ({ campaigns, agencies, user, loading, onRefresh }: any) => {
  const { toast } = useToast();
  const [view, setView] = useState<'list' | 'create'>('list');
  const [, setDetailView] = useState<Campaign | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Create Form State
  const initialForm = {
    title: '',
    platform: '',
    price: '',
    payout: '',
    totalSlots: '',
    originalPrice: '',
    image: '',
    productUrl: '',
    dealType: '',
  };
  const [form, setForm] = useState(initialForm);
  const [selAgencies, setSelAgencies] = useState<string[]>([]);

  const handleCreate = async (e: any) => {
    e.preventDefault();
    try {
      const payload = {
        ...form,
        brand: user.name,
        brandId: user.id,
        price: Number(form.price),
        originalPrice: Number(form.originalPrice),
        payout: Number(form.payout),
        totalSlots: Number(form.totalSlots),
        allowedAgencies: selAgencies,
        dealType: form.dealType || undefined,
      };

      if (isEditing && editingId) {
        await api.brand.updateCampaign(editingId, payload);
      } else {
        await api.brand.createCampaign(payload);
      }

      setView('list');
      setIsEditing(false);
      setEditingId(null);
      setForm(initialForm);
      onRefresh();
    } catch {
      toast.error('Failed to save campaign');
    }
  };

  const handleEdit = (campaign: Campaign) => {
    setForm({
      title: campaign.title,
      platform: campaign.platform,
      price: campaign.price.toString(),
      payout: campaign.payout.toString(),
      totalSlots: campaign.totalSlots.toString(),
      originalPrice: campaign.originalPrice.toString(),
      image: campaign.image,
      productUrl: campaign.productUrl,
      dealType: campaign.dealType || '',
    });
    setSelAgencies(campaign.allowedAgencies || []);
    setIsEditing(true);
    setEditingId(campaign.id);
    setDetailView(null);
    setView('create');
  };

  if (view === 'create')
    return (
      <div className="max-w-7xl mx-auto animate-slide-up h-full flex flex-col">
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => {
              setView('list');
              setIsEditing(false);
              setEditingId(null);
              setForm(initialForm);
            }}
            className="w-12 h-12 rounded-full bg-white border border-zinc-200 flex items-center justify-center hover:bg-zinc-50 transition-colors"
          >
            <ChevronRight className="rotate-180" size={20} />
          </button>
          <h1 className="text-3xl font-extrabold text-zinc-900">
            {isEditing ? 'Edit Campaign' : 'Launch New Campaign'}
          </h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 overflow-y-auto scrollbar-hide">
          {/* FORM COLUMN */}
          <div className="lg:col-span-2 bg-white p-10 rounded-[2.5rem] shadow-xl border border-zinc-100">
            <form onSubmit={handleCreate} className="space-y-10">
              {/* Section 1 */}
              <div>
                <h3 className="text-lg font-bold text-zinc-900 mb-6 flex items-center gap-2">
                  <span className="w-8 h-8 rounded-full bg-zinc-900 text-white flex items-center justify-center text-sm">
                    1
                  </span>
                  Deal Details
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="md:col-span-2">
                    <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">
                      Product Title
                    </label>
                    <input
                      type="text"
                      className="w-full p-4 bg-zinc-50 border-none rounded-2xl font-bold text-zinc-900 focus:ring-2 focus:ring-lime-400 outline-none"
                      placeholder="e.g. Nike Air Jordan 1 Low"
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">
                      Platform
                    </label>
                    <input
                      type="text"
                      className="w-full p-4 bg-zinc-50 border-none rounded-2xl font-bold text-zinc-900 focus:ring-2 focus:ring-lime-400 outline-none"
                      placeholder="e.g. Amazon"
                      value={form.platform}
                      onChange={(e) => setForm({ ...form, platform: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">
                      Total Units
                    </label>
                    <input
                      type="number"
                      className="w-full p-4 bg-zinc-50 border-none rounded-2xl font-bold text-zinc-900 outline-none"
                      placeholder="1000"
                      value={form.totalSlots}
                      onChange={(e) => setForm({ ...form, totalSlots: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">
                      Image URL
                    </label>
                    <input
                      type="url"
                      className="w-full p-4 bg-zinc-50 border-none rounded-2xl font-bold text-zinc-900 outline-none"
                      placeholder="https://..."
                      value={form.image}
                      onChange={(e) => setForm({ ...form, image: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">
                      Product Link
                    </label>
                    <input
                      type="url"
                      className="w-full p-4 bg-zinc-50 border-none rounded-2xl font-bold text-zinc-900 outline-none"
                      placeholder="https://amazon.in/..."
                      value={form.productUrl}
                      onChange={(e) => setForm({ ...form, productUrl: e.target.value })}
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Section 2 */}
              <div>
                <h3 className="text-lg font-bold text-zinc-900 mb-6 flex items-center gap-2">
                  <span className="w-8 h-8 rounded-full bg-zinc-900 text-white flex items-center justify-center text-sm">
                    2
                  </span>
                  Financials
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">
                      MRP (â‚¹)
                    </label>
                    <input
                      type="number"
                      className="w-full p-4 bg-zinc-50 border-none rounded-2xl font-bold text-zinc-900 outline-none"
                      placeholder="2000"
                      value={form.originalPrice}
                      onChange={(e) => setForm({ ...form, originalPrice: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">
                      Deal Cost (â‚¹)
                    </label>
                    <input
                      type="number"
                      className="w-full p-4 bg-zinc-50 border-none rounded-2xl font-bold text-zinc-900 outline-none"
                      placeholder="1000"
                      value={form.price}
                      onChange={(e) => setForm({ ...form, price: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">
                      Partner Payout (â‚¹)
                    </label>
                    <input
                      type="number"
                      className="w-full p-4 bg-zinc-50 border-none rounded-2xl font-bold text-zinc-900 outline-none"
                      placeholder="200"
                      value={form.payout}
                      onChange={(e) => setForm({ ...form, payout: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-2 block">
                      Enforce Deal Type
                    </label>
                    <select
                      className="w-full p-4 bg-zinc-50 border-none rounded-2xl font-bold text-zinc-500 focus:text-zinc-900 outline-none cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22m6%208%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.25rem_1.25rem] bg-[right_1rem_center] bg-no-repeat"
                      value={form.dealType}
                      onChange={(e) => setForm({ ...form, dealType: e.target.value })}
                    >
                      <option value="">Flexible (Agency Decide)</option>
                      <option value="Discount">Discount Only</option>
                      <option value="Review">Review Required</option>
                      <option value="Rating">Rating Required</option>
                    </select>
                    <p className="text-[10px] text-zinc-400 mt-2 ml-1 font-medium italic">
                      Usually decided by agency partner.
                    </p>
                  </div>
                </div>
              </div>

              {/* Section 3 */}
              <div>
                <h3 className="text-lg font-bold text-zinc-900 mb-6 flex items-center gap-2">
                  <span className="w-8 h-8 rounded-full bg-zinc-900 text-white flex items-center justify-center text-sm">
                    3
                  </span>
                  Distribution
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {agencies.map((ag: User) => (
                    <button
                      type="button"
                      key={ag.id}
                      onClick={() => {
                        if (selAgencies.includes(ag.mediatorCode!))
                          setSelAgencies(selAgencies.filter((c: string) => c !== ag.mediatorCode));
                        else setSelAgencies([...selAgencies, ag.mediatorCode!]);
                      }}
                      className={`p-4 rounded-2xl font-bold text-sm text-left transition-all border-2 flex items-center justify-between ${
                        selAgencies.includes(ag.mediatorCode!)
                          ? 'bg-zinc-900 text-white border-zinc-900'
                          : 'bg-white text-zinc-500 border-zinc-100 hover:border-zinc-300'
                      }`}
                    >
                      <span>{ag.name}</span>
                      {selAgencies.includes(ag.mediatorCode!) && (
                        <CheckCircle size={16} className="text-lime-400" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <button className="w-full py-5 bg-lime-400 text-black font-extrabold rounded-2xl shadow-xl shadow-lime-400/20 hover:bg-lime-300 transition-all active:scale-[0.98] text-lg">
                {isEditing ? 'Update Campaign' : 'Launch Campaign'}
              </button>
            </form>
          </div>

          {/* PREVIEW COLUMN */}
          <div className="space-y-6">
            <h3 className="font-bold text-zinc-400 text-xs uppercase tracking-widest text-center">
              Live Preview
            </h3>

            {/* The Card Preview */}
            <div className="w-[320px] mx-auto bg-white rounded-[2rem] p-5 shadow-2xl border border-zinc-100 relative overflow-hidden">
              <div className="absolute top-4 right-4 bg-zinc-900 text-white text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider z-10">
                {form.platform || 'PLATFORM'}
              </div>

              <div className="flex gap-4 mb-4">
                <div className="w-24 h-24 rounded-2xl bg-zinc-50 p-2 flex-shrink-0 flex items-center justify-center border border-zinc-100">
                  {form.image ? (
                    <img
                      src={form.image}
                      className="w-full h-full object-contain mix-blend-multiply"
                    />
                  ) : (
                    <ImageIcon size={24} className="text-zinc-300" />
                  )}
                </div>
                <div className="flex-1 min-w-0 py-1">
                  <h3 className="font-bold text-zinc-900 text-sm leading-tight line-clamp-2 mb-2">
                    {form.title || 'Product Title'}
                  </h3>
                  <div className="flex items-center gap-1 mb-1">
                    <span className="text-[10px] font-bold text-zinc-400">â­â­â­â­â­ (4.8)</span>
                  </div>
                  <p className="text-xl font-extrabold text-lime-600 leading-none">
                    â‚¹{Number(form.price).toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="bg-zinc-50 rounded-xl p-3 mb-3 border border-zinc-100 relative font-mono text-[10px] text-zinc-500 leading-relaxed">
                <div className="mb-1">
                  <span className="text-indigo-600 font-bold">"{user.name}"</span> Direct Deal.
                </div>
                <div className="pt-2 border-t border-zinc-200 border-dashed flex justify-between items-center">
                  <span>MRP:</span>
                  <span className="text-zinc-900 font-bold decoration-slice line-through">
                    â‚¹{Number(form.originalPrice).toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="w-full py-3.5 bg-black text-white font-extrabold rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2">
                <LinkIcon size={14} /> GET LOOT LINK
              </div>
            </div>

            {/* Stats Preview */}
            <div className="bg-zinc-900 text-white p-6 rounded-[2rem] shadow-lg">
              <div className="flex justify-between items-center mb-4">
                <span className="text-xs font-bold text-zinc-500 uppercase">Estimated Budget</span>
                <Wallet size={16} className="text-lime-400" />
              </div>
              <h2 className="text-3xl font-extrabold">
                â‚¹{(Number(form.payout) * Number(form.totalSlots)).toLocaleString()}
              </h2>
              <p className="text-xs text-zinc-500 mt-2">Based on payout & total units.</p>
            </div>
          </div>
        </div>
      </div>
    );

  return (
    <div className="max-w-7xl mx-auto animate-enter h-full flex flex-col">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-zinc-900 tracking-tight">Active Campaigns</h1>
          <p className="text-zinc-500 font-medium">Manage your product distribution and deals.</p>
        </div>
        <button
          onClick={() => {
            setForm(initialForm);
            setSelAgencies([]);
            setIsEditing(false);
            setEditingId(null);
            setView('create');
          }}
          className="px-6 py-3 bg-zinc-900 text-white rounded-xl font-bold text-sm shadow-lg hover:bg-black transition-all active:scale-95 flex items-center gap-2"
        >
          <Plus size={18} /> New Campaign
        </button>
      </div>

      {loading ? (
        <EmptyState
          title="Loading campaigns"
          description="Fetching your latest campaignsâ€¦"
          icon={<Spinner className="w-6 h-6 text-zinc-400" />}
          className="bg-transparent"
        />
      ) : campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          description="Launch your first campaign to start selling."
          icon={<Briefcase size={22} className="text-zinc-400" />}
          action={
            <button
              onClick={() => setView('create')}
              className="px-6 py-3 bg-lime-400 text-black rounded-xl font-bold text-xs hover:bg-lime-300 transition-colors"
            >
              Create first campaign
            </button>
          }
          className="rounded-[2.5rem] py-20"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-20">
          {campaigns.map((c: Campaign) => (
            <div
              key={c.id}
              className="bg-white p-5 rounded-[2rem] border border-zinc-100 shadow-sm hover:shadow-xl transition-all group relative overflow-hidden flex flex-col"
            >
              <div className="flex gap-4 mb-4">
                <div className="w-20 h-20 bg-zinc-50 rounded-2xl p-2 flex-shrink-0 border border-zinc-100 flex items-center justify-center">
                  <img src={c.image} className="w-full h-full object-contain mix-blend-multiply" />
                </div>
                <div className="flex-1 min-w-0 py-1">
                  <div className="flex justify-between items-start mb-1">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${c.status === 'Active' ? 'bg-green-50 text-green-600 border-green-100' : 'bg-zinc-100 text-zinc-500 border-zinc-200'}`}
                    >
                      {c.status}
                    </span>
                    <span className="text-[10px] font-bold text-zinc-400 uppercase bg-zinc-50 px-1.5 py-0.5 rounded border border-zinc-100">
                      {c.platform}
                    </span>
                  </div>
                  <h3 className="font-bold text-zinc-900 text-sm line-clamp-1 leading-tight mb-2">
                    {c.title}
                  </h3>
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col">
                      <span className="text-[9px] font-bold text-zinc-400 uppercase">Payout</span>
                      <span className="text-xs font-black text-zinc-900">â‚¹{c.payout}</span>
                    </div>
                    <div className="w-[1px] h-6 bg-zinc-100"></div>
                    <div className="flex flex-col">
                      <span className="text-[9px] font-bold text-zinc-400 uppercase">Cost</span>
                      <span className="text-xs font-black text-zinc-900">â‚¹{c.price}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3 mt-auto">
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase">
                      Slots Sold
                    </span>
                    <span className="text-[10px] font-bold text-zinc-900">
                      {c.usedSlots} / {c.totalSlots}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-lime-500 rounded-full transition-all duration-1000"
                      style={{
                        width: `${Math.min(
                          100,
                          c.totalSlots > 0 ? (c.usedSlots / c.totalSlots) * 100 : 0
                        )}%`,
                      }}
                    ></div>
                  </div>
                </div>

                <button
                  onClick={() => handleEdit(c)}
                  className="w-full py-3 bg-zinc-50 text-zinc-600 rounded-xl font-bold text-xs hover:bg-zinc-900 hover:text-white transition-all flex items-center justify-center gap-2 border border-zinc-100 group-hover:border-zinc-900"
                >
                  Manage Campaign <ArrowUpRight size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const BrandDashboard: React.FC = () => {
  const { user, logout, updateUser } = useAuth();
  const { toast } = useToast();
  const { connected } = useRealtimeConnection();
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [agencies, setAgencies] = useState<User[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDataLoading, setIsDataLoading] = useState(true);

  // NEW: Agency Detail Modal State
  const [selectedAgency, setSelectedAgency] = useState<User | null>(null);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutRef, setPayoutRef] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);

  const fetchData = async () => {
    if (!user) return;
    setIsDataLoading(true);
    try {
      const [camps, ags, ords, txns] = await Promise.all([
        api.brand.getBrandCampaigns(user.id),
        api.brand.getConnectedAgencies(user.id),
        api.brand.getBrandOrders(user.name),
        api.brand.getTransactions(user.id),
      ]);
      setCampaigns(camps);
      setAgencies(ags);
      setOrders(ords);
      setTransactions(txns);
    } catch (e) {
      console.error(e);
    } finally {
      setIsDataLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  // Realtime: refresh when orders/wallets/users change.
  useEffect(() => {
    if (!user) return;
    let timer: any = null;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        fetchData();
      }, 900);
    };
    const unsub = subscribeRealtime((msg) => {
      if (
        msg.type === 'orders.changed' ||
        msg.type === 'users.changed' ||
        msg.type === 'wallets.changed' ||
        msg.type === 'deals.changed' ||
        msg.type === 'notifications.changed'
      ) {
        schedule();
      }
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [user]);

  const handlePayout = async () => {
    if (!selectedAgency || !payoutAmount || !payoutRef || !user) return;
    setIsProcessing(true);
    try {
      await api.brand.payoutAgency(user.id, selectedAgency.id, Number(payoutAmount), payoutRef);
      toast.success('Payment recorded');
      setPayoutAmount('');
      setPayoutRef('');
      setSelectedAgency(null);
      fetchData();
    } catch (e) {
      toast.error(String((e as any)?.message || 'Payment failed'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportPayouts = () => {
    const headers = [
      'Transaction ID',
      'Date',
      'Time',
      'Agency Name',
      'Amount (INR)',
      'Reference/UTR',
      'Status',
    ];

    const csvRows = [headers.join(',')];

    transactions.forEach((tx: any) => {
      const dateObj = new Date(tx.date);
      const date = dateObj.toLocaleDateString();
      const time = dateObj.toLocaleTimeString();

      const row = [
        tx.id,
        date,
        time,
        `"${(tx.agencyName || '').replace(/"/g, '""')}"`,
        tx.amount,
        `"${(tx.ref || '').replace(/"/g, '""')}"`,
        tx.status,
      ];
      csvRows.push(row.join(','));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payout_ledger_report_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const pendingRequests = user?.pendingConnections?.length || 0;

  return (
    <DesktopShell
      isSidebarOpen={isSidebarOpen}
      onSidebarOpenChange={setIsSidebarOpen}
      containerClassName="flex h-screen bg-[#F4F4F5] font-sans text-zinc-900 overflow-hidden relative"
      overlayClassName="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm"
      sidebarWidthClassName="w-80"
      asideClassName="bg-white flex flex-col border-r border-zinc-100 shadow-[4px_0_24px_rgba(0,0,0,0.02)]"
      mainClassName="flex-1 min-w-0 overflow-y-auto bg-[#FAFAFA] relative scrollbar-hide p-4 md:p-8"
      mobileHeader={
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-black text-lime-400 rounded-lg flex items-center justify-center">
            <Building2 size={16} />
          </div>
          <span className="font-extrabold text-lg">MoboBrand</span>
        </div>
      }
      mobileMenuButton={
        <button
          onClick={() => setIsSidebarOpen(true)}
          className="p-2 bg-white rounded-xl shadow-sm border border-zinc-200"
        >
          <Menu size={20} />
        </button>
      }
      sidebar={
        <>
          <div className="p-8">
            <div className="flex items-center justify-between mb-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-black text-lime-400 rounded-xl flex items-center justify-center shadow-xl shadow-lime-400/20">
                  <Building2 size={22} strokeWidth={2.5} />
                </div>
                <div>
                  <h1 className="font-extrabold text-xl tracking-tight leading-none">
                    Mobo<span className="text-lime-500">Brand</span>
                  </h1>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                      Partner Portal
                    </p>
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${
                        connected
                          ? 'text-lime-700 bg-lime-50 border-lime-100'
                          : 'text-orange-700 bg-orange-50 border-orange-100'
                      }`}
                      title={connected ? 'Realtime connected' : 'Realtime reconnecting'}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          connected
                            ? 'bg-lime-500 animate-pulse motion-reduce:animate-none'
                            : 'bg-orange-500'
                        }`}
                      ></span>
                      {connected ? 'LIVE' : 'OFFLINE'}
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setIsSidebarOpen(false)}
                aria-label="Close sidebar"
                className="md:hidden p-2 text-zinc-400 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              >
                <X size={24} />
              </button>
            </div>
            <nav className="space-y-1">
              <SidebarItem
                icon={<LayoutDashboard />}
                label="Command Center"
                active={activeTab === 'dashboard'}
                onClick={() => {
                  setActiveTab('dashboard');
                  setIsSidebarOpen(false);
                }}
              />
              <SidebarItem
                icon={<Briefcase />}
                label="Campaigns"
                active={activeTab === 'campaigns'}
                onClick={() => {
                  setActiveTab('campaigns');
                  setIsSidebarOpen(false);
                }}
                badge={campaigns.filter((c) => c.status === 'Active').length}
              />
              <SidebarItem
                icon={<ShoppingBag />}
                label="Order Intelligence"
                active={activeTab === 'orders'}
                onClick={() => {
                  setActiveTab('orders');
                  setIsSidebarOpen(false);
                }}
              />
              <SidebarItem
                icon={<Users />}
                label="Agency Partners"
                active={activeTab === 'agencies'}
                onClick={() => {
                  setActiveTab('agencies');
                  setIsSidebarOpen(false);
                }}
              />
              <SidebarItem
                icon={<Bell />}
                label="Requests"
                active={activeTab === 'requests'}
                onClick={() => {
                  setActiveTab('requests');
                  setIsSidebarOpen(false);
                }}
                badge={pendingRequests}
              />
            </nav>
          </div>

          <div className="mt-auto p-6">
            {/* Brand Profile Card - Interactive */}
            <div
              onClick={() => {
                setActiveTab('profile');
                setIsSidebarOpen(false);
              }}
              className={`bg-zinc-50 rounded-2xl p-4 border border-zinc-100 mb-4 cursor-pointer transition-all hover:bg-zinc-100 hover:border-zinc-200 group ${activeTab === 'profile' ? 'ring-2 ring-lime-400 ring-offset-2' : ''}`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-zinc-900 text-white flex items-center justify-center font-bold shadow-md text-sm shrink-0 overflow-hidden">
                  {user?.avatar ? (
                    <img src={user.avatar} className="w-full h-full object-cover" />
                  ) : (
                    user?.name?.charAt(0) || 'B'
                  )}
                </div>
                <div className="min-w-0 overflow-hidden flex-1">
                  <p className="text-sm font-bold text-zinc-900 truncate group-hover:text-black">
                    {user?.name}
                  </p>
                  <p className="text-[10px] text-zinc-500 font-mono bg-white px-1.5 py-0.5 rounded border border-zinc-200 inline-block mt-1 truncate max-w-full group-hover:bg-white/80">
                    {user?.brandCode}
                  </p>
                </div>
                <ChevronRight size={16} className="text-zinc-400 group-hover:text-zinc-600" />
              </div>
            </div>

            <button
              onClick={logout}
              className="w-full py-3 flex items-center justify-center gap-2 text-zinc-400 hover:bg-red-50 hover:text-red-500 rounded-xl font-bold text-xs transition-colors"
            >
              <LogOut size={16} /> Sign Out
            </button>
          </div>
        </>
      }
    >

        {activeTab === 'dashboard' && (
          <DashboardView campaigns={campaigns} agencies={agencies} orders={orders} />
        )}
        {activeTab === 'campaigns' && (
          <CampaignsView
            campaigns={campaigns}
            agencies={agencies}
            user={user}
            loading={isDataLoading}
            onRefresh={fetchData}
          />
        )}
        {activeTab === 'orders' && <OrdersView user={user} />}
        {activeTab === 'profile' && <BrandProfileView />}

        {activeTab === 'agencies' && (
          <div className="max-w-6xl mx-auto animate-enter pb-12">
            <h2 className="text-3xl font-extrabold text-zinc-900 tracking-tight mb-8">
              Partner Agencies
            </h2>
            {isDataLoading ? (
              <EmptyState
                title="Loading agencies"
                description="Fetching your connected agenciesâ€¦"
                icon={<Spinner className="w-6 h-6 text-zinc-400" />}
                className="bg-transparent"
              />
            ) : agencies.length === 0 ? (
              <EmptyState
                title="No agencies connected"
                description="Once an agency connects to your brand, it will show up here."
                icon={<Users size={22} className="text-zinc-400" />}
                className="bg-transparent"
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {agencies.map((ag: User) => (
                  <div
                    key={ag.id}
                    onClick={() => setSelectedAgency(ag)}
                    className="bg-white p-6 rounded-[2rem] border border-zinc-100 shadow-sm hover:shadow-xl transition-all group flex items-center gap-5 relative overflow-hidden cursor-pointer active:scale-[0.99]"
                  >
                    <div className="w-20 h-20 bg-zinc-50 rounded-[1.5rem] flex items-center justify-center font-bold text-2xl text-zinc-400 shadow-inner">
                      {ag.name.charAt(0)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className="text-xl font-bold text-zinc-900 truncate">{ag.name}</h3>
                      <p className="text-xs text-zinc-400 font-mono mt-1 mb-3 bg-zinc-50 px-2 py-0.5 rounded w-fit">
                        {ag.mediatorCode}
                      </p>

                      <div className="flex gap-2">
                        <span className="px-3 py-1 bg-green-50 text-green-700 text-[10px] font-bold rounded-full border border-green-100 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Active
                        </span>
                        <span className="px-3 py-1 bg-zinc-50 text-zinc-500 text-[10px] font-bold rounded-full border border-zinc-100">
                          High Volume
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!user) return;
                        if (confirm('Disconnect this Agency?')) {
                          api.brand.removeAgency(user.id, ag.mediatorCode!).then(fetchData);
                        }
                      }}
                      className="w-10 h-10 rounded-full border border-zinc-100 flex items-center justify-center text-zinc-300 hover:text-red-500 hover:border-red-100 hover:bg-red-50 transition-colors absolute top-6 right-6"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* LEDGER SECTION */}
            <div className="mt-12">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-zinc-900 flex items-center gap-2">
                  <History size={24} className="text-zinc-400" /> Payout Ledger
                </h3>
                <button
                  onClick={handleExportPayouts}
                  className="flex items-center gap-2 px-5 py-2.5 bg-zinc-100 text-zinc-700 rounded-xl font-bold text-xs hover:bg-zinc-200 transition-colors border border-zinc-200"
                >
                  <Download size={16} /> Export Report
                </button>
              </div>
              <div className="bg-white rounded-[2rem] border border-zinc-100 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left min-w-[600px]">
                    <thead className="bg-zinc-50 text-zinc-400 text-xs font-bold uppercase tracking-wider">
                      <tr>
                        <th className="p-6">Date</th>
                        <th className="p-6">Transaction ID</th>
                        <th className="p-6">Agency</th>
                        <th className="p-6 text-right">Amount</th>
                        <th className="p-6 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {isDataLoading ? (
                        <tr>
                          <td colSpan={5} className="p-8">
                            <EmptyState
                              title="Loading transactions"
                              description="Fetching payout ledgerâ€¦"
                              icon={<Spinner className="w-6 h-6 text-zinc-400" />}
                              className="bg-transparent"
                            />
                          </td>
                        </tr>
                      ) : transactions.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-8">
                            <EmptyState
                              title="No transactions yet"
                              description="Recorded payouts will appear here."
                              icon={<History size={22} className="text-zinc-400" />}
                              className="bg-transparent"
                            />
                          </td>
                        </tr>
                      ) : (
                        transactions.map((tx) => (
                          <tr key={tx.id} className="hover:bg-zinc-50/50 transition-colors">
                            <td className="p-6 text-sm font-bold text-zinc-500">
                              {new Date(tx.date).toLocaleDateString()}
                            </td>
                            <td className="p-6 font-mono text-xs font-bold text-zinc-400">
                              {tx.id || tx.ref}
                            </td>
                            <td className="p-6">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-purple-50 text-purple-600 rounded-lg flex items-center justify-center font-bold text-xs">
                                  {tx.agencyName?.charAt(0)}
                                </div>
                                <span className="text-sm font-bold text-zinc-900">
                                  {tx.agencyName}
                                </span>
                              </div>
                            </td>
                            <td className="p-6 text-right font-mono font-bold text-zinc-900">
                              â‚¹{tx.amount}
                            </td>
                            <td className="p-6 text-right">
                              <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-[10px] font-bold uppercase border border-green-200">
                                {tx.status}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'requests' && (
          <div className="max-w-4xl mx-auto animate-enter">
            <h2 className="text-3xl font-extrabold text-zinc-900 tracking-tight mb-8">
              Connection Requests
            </h2>
            {isDataLoading ? (
              <EmptyState
                title="Loading requests"
                description="Fetching pending connection requestsâ€¦"
                icon={<Spinner className="w-6 h-6 text-zinc-400" />}
                className="bg-transparent"
              />
            ) : !user?.pendingConnections || user.pendingConnections.length === 0 ? (
              <EmptyState
                title="No pending requests"
                description={`Share your Brand Code: ${user?.brandCode || ''}`}
                icon={<LinkIcon size={22} className="text-zinc-400" />}
                className="bg-transparent rounded-[2.5rem] py-20"
              />
            ) : (
              <div className="space-y-4">
                {user.pendingConnections.map((req: any) => (
                  <div
                    key={req.agencyId}
                    className="bg-white p-3 rounded-[1.5rem] shadow-sm border border-zinc-100 flex flex-col sm:flex-row justify-between items-center pr-4 transition-all hover:shadow-md gap-4"
                  >
                    <div className="flex items-center gap-5 w-full sm:w-auto">
                      <div className="w-16 h-16 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center text-xl font-bold shadow-sm">
                        {req.agencyName.charAt(0)}
                      </div>
                      <div>
                        <h4 className="font-bold text-zinc-900 text-lg">{req.agencyName}</h4>
                        <p className="text-sm text-zinc-400 font-medium">
                          Wants to connect with your brand.
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-3 w-full sm:w-auto">
                      <button
                        onClick={async () => {
                          try {
                            await api.brand.resolveConnectionRequest(
                              user.id,
                              req.agencyId,
                              'reject'
                            );
                            const currentPending = user.pendingConnections || [];
                            const newPending = currentPending.filter(
                              (r: any) => r.agencyId !== req.agencyId
                            );
                            await updateUser({ pendingConnections: newPending });
                            fetchData();
                          } catch (e) {
                            console.error('Failed to decline', e);
                          }
                        }}
                        className="flex-1 sm:flex-none px-6 py-2.5 bg-white text-zinc-600 rounded-xl font-bold text-xs border border-zinc-200 hover:bg-zinc-50 transition-colors"
                      >
                        Decline
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await api.brand.resolveConnectionRequest(
                              user.id,
                              req.agencyId,
                              'approve'
                            );
                            const currentPending = user.pendingConnections || [];
                            const newPending = currentPending.filter(
                              (r: any) => r.agencyId !== req.agencyId
                            );
                            const newConnected = [
                              ...(user.connectedAgencies || []),
                              req.agencyCode,
                            ];
                            await updateUser({
                              pendingConnections: newPending,
                              connectedAgencies: newConnected,
                            });
                            fetchData();
                          } catch (e) {
                            console.error('Failed to approve', e);
                          }
                        }}
                        className="flex-1 sm:flex-none px-8 py-2.5 bg-zinc-900 text-white rounded-xl font-bold text-xs hover:bg-black shadow-lg transition-all active:scale-95"
                      >
                        Approve
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      {/* AGENCY DETAIL / PAYMENT MODAL */}
      {selectedAgency && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-enter"
          onClick={() => setSelectedAgency(null)}
        >
          <div
            className="bg-white w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl relative animate-enter flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedAgency(null)}
              className="absolute top-6 right-6 p-2 bg-zinc-50 rounded-full hover:bg-zinc-100 transition-colors"
            >
              <X size={20} />
            </button>

            <div className="flex items-center gap-4 mb-8">
              <div className="w-16 h-16 bg-zinc-900 text-white rounded-2xl flex items-center justify-center font-bold text-2xl shadow-lg">
                {selectedAgency.name.charAt(0)}
              </div>
              <div>
                <h3 className="text-2xl font-extrabold text-zinc-900 leading-tight">
                  {selectedAgency.name}
                </h3>
                <p className="text-zinc-500 font-mono text-sm mt-0.5">
                  {selectedAgency.mediatorCode}
                </p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-hide space-y-6">
              {/* Profile Info */}
              <div className="bg-zinc-50 p-5 rounded-2xl border border-zinc-100 space-y-3">
                <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <Building2 size={14} /> Contact Details
                </h4>
                <div className="flex justify-between">
                  <span className="text-xs font-bold text-zinc-500">Mobile</span>
                  <span className="text-sm font-bold text-zinc-900">{selectedAgency.mobile}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs font-bold text-zinc-500">Status</span>
                  <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded uppercase">
                    {selectedAgency.status}
                  </span>
                </div>
              </div>

              {/* Payment Info */}
              <div className="bg-zinc-50 p-5 rounded-2xl border border-zinc-100 space-y-4">
                <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <CreditCard size={14} /> Payment Details
                </h4>

                <div className="space-y-3">
                  <div className="p-3 bg-white rounded-xl border border-zinc-200">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase">
                        Bank Account
                      </span>
                      <Landmark size={14} className="text-zinc-300" />
                    </div>
                    <p className="text-sm font-bold text-zinc-900 mb-1">
                      {selectedAgency.bankDetails?.bankName || 'N/A'}
                    </p>
                    <div className="flex justify-between items-end">
                      <p className="font-mono text-xs text-zinc-600 bg-zinc-50 px-2 py-1 rounded w-fit">
                        {selectedAgency.bankDetails?.accountNumber || 'Not Added'}
                      </p>
                      <p className="text-[10px] font-mono text-zinc-400">
                        {selectedAgency.bankDetails?.ifsc}
                      </p>
                    </div>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-zinc-200">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase">
                        UPI Address
                      </span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(selectedAgency.upiId || '');
                          toast.success('Copied');
                        }}
                        className="text-zinc-400 hover:text-black"
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                    <p className="text-sm font-bold text-zinc-900 font-mono">
                      {selectedAgency.upiId || 'Not Linked'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Payment Action */}
              <div className="pt-2">
                <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4">
                  Record Payment
                </h4>
                <div className="space-y-4">
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-zinc-400">
                      â‚¹
                    </span>
                    <input
                      type="number"
                      value={payoutAmount}
                      onChange={(e) => setPayoutAmount(e.target.value)}
                      className="w-full pl-8 pr-4 py-4 bg-white border border-zinc-200 rounded-2xl font-bold text-lg outline-none focus:ring-2 focus:ring-lime-400 focus:border-transparent transition-all"
                      placeholder="0.00"
                    />
                  </div>
                  <input
                    type="text"
                    value={payoutRef}
                    onChange={(e) => setPayoutRef(e.target.value)}
                    className="w-full p-4 bg-white border border-zinc-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-lime-400 focus:border-transparent transition-all"
                    placeholder="Transaction Reference (UTR)"
                  />
                  <button
                    onClick={handlePayout}
                    disabled={!payoutAmount || !payoutRef || isProcessing}
                    className="w-full py-4 bg-black text-white font-bold rounded-2xl shadow-xl hover:bg-lime-400 hover:text-black transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 disabled:scale-100"
                  >
                    {isProcessing ? (
                      <span className="animate-spin motion-reduce:animate-none w-5 h-5 border-2 border-current border-t-transparent rounded-full"></span>
                    ) : (
                      <>
                        <Send size={18} /> Confirm Transfer
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </DesktopShell>
  );
};
