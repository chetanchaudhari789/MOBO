import React, { useMemo, useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { subscribeRealtime } from '../services/realtime';
import { useToast } from '../context/ToastContext';
import { Product } from '../types';
import { ProductCard } from '../components/ProductCard';
import { Search, Filter } from 'lucide-react';
import { EmptyState, Input, Spinner } from '../components/ui';

export const Explore: React.FC = () => {
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [filtered, setFiltered] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [loading, setLoading] = useState(true);
  const silentSyncRef = useRef(false);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      const c = String((p as any)?.category || '').trim();
      if (c) set.add(c);
    }
    const dynamic = Array.from(set).sort((a, b) => a.localeCompare(b));
    return ['All', ...dynamic];
  }, [products]);

  const fetchDeals = async (silent = false) => {
    if (silent) {
      if (silentSyncRef.current) return;
      silentSyncRef.current = true;
    } else {
      setLoading(true);
    }
    try {
      const data = await api.products.getAll();
      setProducts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setProducts([]);
      if (!silent) toast.error('Failed to load deals. Please try again.');
    } finally {
      setLoading(false);
      silentSyncRef.current = false;
    }
  };

  useEffect(() => {
    fetchDeals();

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

  useEffect(() => {
    if (selectedCategory === 'All') return;
    if (categories.includes(selectedCategory)) return;
    setSelectedCategory('All');
  }, [categories, selectedCategory]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#F4F4F5]">
      {/* Header */}
      <div className="px-6 pt-16 pb-4 bg-white shadow-sm z-10 border-b border-gray-100 sticky top-0">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-extrabold text-slate-900">Explore Deals</h1>
        </div>

        {/* Search Bar */}
        <div className="mb-4">
          <Input
            placeholder="Search deals, brands, platforms..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            leftIcon={<Search size={18} />}
            aria-label="Search deals"
          />
        </div>

        {/* Categories */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              aria-pressed={selectedCategory === cat}
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
