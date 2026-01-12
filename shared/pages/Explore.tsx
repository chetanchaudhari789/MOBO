<<<<<<< HEAD
import React, { useMemo, useState, useEffect } from 'react';
import { api } from '../services/api';
import { subscribeRealtime } from '../services/realtime';
import { useRealtimeConnection } from '../hooks/useRealtimeConnection';
import { Product } from '../types';
import { ProductCard } from '../components/ProductCard';
import { Search, Filter, RefreshCw } from 'lucide-react';
import { Badge, EmptyState, Input, Spinner } from '../components/ui';

export const Explore: React.FC = () => {
  const { connected } = useRealtimeConnection();
=======
import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Product } from '../types';
import { ProductCard } from '../components/ProductCard';
import { Search, Filter, Loader2, RefreshCw } from 'lucide-react';

export const Explore: React.FC = () => {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
  const [products, setProducts] = useState<Product[]>([]);
  const [filtered, setFiltered] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

<<<<<<< HEAD
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      const c = String((p as any)?.category || '').trim();
      if (c) set.add(c);
    }
    const dynamic = Array.from(set).sort((a, b) => a.localeCompare(b));
    return ['All', ...dynamic];
  }, [products]);
=======
  const categories = ['All', 'Electronics', 'Fashion', 'Audio', 'Footwear', 'Watches'];
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176

  const fetchDeals = async (silent = false) => {
    if (!silent) setLoading(true);
    else setIsSyncing(true);
    try {
      const data = await api.products.getAll();
      setProducts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setProducts([]);
    } finally {
      setLoading(false);
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    fetchDeals();

<<<<<<< HEAD
    let timer: any = null;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        fetchDeals(true);
      }, 400);
    };

    // Realtime inventory updates (SSE)
    const unsub = subscribeRealtime((msg) => {
      if (msg.type === 'deals.changed') schedule();
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Fallback: when realtime is disconnected, refresh occasionally.
  useEffect(() => {
    if (connected) return;
    const heartbeat = setInterval(() => fetchDeals(true), 60_000);
    return () => clearInterval(heartbeat);
  }, [connected]);
=======
    // [UI] Live Inventory Sync: Heartbeat refresh every 30 seconds
    const heartbeat = setInterval(() => fetchDeals(true), 30000);
    return () => clearInterval(heartbeat);
  }, []);
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176

  useEffect(() => {
    let result = products;

    if (selectedCategory !== 'All') {
      result = result.filter(
        (p) =>
          p.category === selectedCategory ||
          p.title.includes(selectedCategory) ||
          p.dealType.includes(selectedCategory) ||
          (selectedCategory === 'Audio' &&
            (p.title.includes('Buds') ||
              p.title.includes('Speaker') ||
              p.title.includes('Headphone'))) ||
          (selectedCategory === 'Footwear' &&
            (p.title.includes('Shoe') || p.title.includes('Sneaker'))) ||
          (selectedCategory === 'Watches' && p.title.includes('Watch'))
      );
    }

    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(
        (p) =>
          p.title.toLowerCase().includes(lower) ||
          p.description.toLowerCase().includes(lower) ||
          p.platform.toLowerCase().includes(lower) ||
          p.brandName.toLowerCase().includes(lower)
      );
    }

    setFiltered(result);
  }, [searchTerm, selectedCategory, products]);

<<<<<<< HEAD
  useEffect(() => {
    if (selectedCategory === 'All') return;
    if (categories.includes(selectedCategory)) return;
    setSelectedCategory('All');
  }, [categories, selectedCategory]);

=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
  return (
    <div className="flex flex-col h-full bg-[#F4F4F5]">
      {/* Header */}
      <div className="px-6 pt-16 pb-4 bg-white shadow-sm z-10 border-b border-gray-100 sticky top-0">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-extrabold text-slate-900">Explore Deals</h1>
<<<<<<< HEAD
          <div className="flex items-center gap-2">
            <Badge
              variant={connected ? 'success' : 'warning'}
              title={connected ? 'Realtime connected' : 'Realtime reconnecting'}
              className="gap-2"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  connected ? 'bg-emerald-500 animate-pulse motion-reduce:animate-none' : 'bg-amber-500'
                }`}
              />
              {connected ? 'LIVE' : 'OFFLINE'}
            </Badge>
            {isSyncing && (
              <Badge variant="info" className="gap-2">
                <RefreshCw size={12} className="animate-spin motion-reduce:animate-none" /> SYNCING
              </Badge>
            )}
          </div>
        </div>

        {/* Search Bar */}
        <div className="mb-4">
          <Input
            placeholder="Search deals, brands, platforms..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            leftIcon={<Search size={18} />}
            aria-label="Search deals"
=======
          {isSyncing && (
            <div className="flex items-center gap-1 text-[10px] font-bold text-lime-600 bg-lime-50 px-2 py-1 rounded-full animate-pulse motion-reduce:animate-none">
              <RefreshCw size={10} className="animate-spin motion-reduce:animate-none" /> LIVE SYNC
            </div>
          )}
        </div>

        {/* Search Bar */}
        <div className="relative mb-4">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input
            type="text"
            placeholder="Search specific items..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-12 pl-12 pr-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm text-slate-900 outline-none focus:border-lime-400 transition-all placeholder:text-slate-400"
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
          />
        </div>

        {/* Categories */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-5 py-2.5 rounded-full text-xs font-bold transition-all border whitespace-nowrap ${
                selectedCategory === cat
                  ? 'bg-black text-white border-black shadow-lg'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 pb-32 scrollbar-hide">
        {loading ? (
<<<<<<< HEAD
          <div className="flex flex-col items-center justify-center py-20 text-slate-500 font-bold text-sm gap-3">
            <Spinner className="w-7 h-7 text-lime-500" />
            Loading inventory...
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No deals found"
            description="Try a different search term or category."
            icon={<Filter size={40} className="text-zinc-300" />}
          />
=======
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 font-bold text-sm gap-2">
            <Loader2 className="animate-spin motion-reduce:animate-none text-lime-500" size={32} />
            Loading inventory...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-slate-400 font-bold text-sm flex flex-col items-center">
            <Filter size={48} className="mb-4 opacity-20" />
            No deals found matching your criteria.
          </div>
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        ) : (
          <div className="flex flex-col items-center gap-6">
            {filtered.map((p) => (
              <div key={p.id} className="animate-enter w-full flex justify-center">
                <ProductCard product={p} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
