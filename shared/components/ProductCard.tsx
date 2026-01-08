import React from 'react';
import { ExternalLink, Star } from 'lucide-react';
import { Product } from '../types';

interface ProductCardProps {
  product: Product;
}

// Allow React's special props (e.g. `key`) without leaking them into runtime.
type ProductCardComponentProps = React.Attributes & ProductCardProps;

export const ProductCard: React.FC<ProductCardComponentProps> = ({ product }) => {
  // Logic: Ensure we show a discount even if data is close
  const effectiveOriginal =
    product.originalPrice > product.price ? product.originalPrice : product.price * 1.4;
  const discountPercentage = Math.round(
    ((effectiveOriginal - product.price) / effectiveOriginal) * 100
  );

  const handleLinkClick = () => {
    if (product.productUrl) {
      window.open(product.productUrl, '_blank');
    } else {
      console.warn('No redirection link found for this product.');
    }
  };

  return (
    <div className="flex-shrink-0 w-[300px] bg-white rounded-[1.5rem] p-4 shadow-sm border border-gray-100 snap-center flex flex-col relative overflow-hidden group transition-all duration-300 hover:shadow-xl hover:-translate-y-1">
      {/* Platform Tag (Top Right) */}
      <div className="absolute top-4 right-4 bg-zinc-800 text-white text-[10px] font-bold px-2 py-1 rounded shadow-sm uppercase tracking-wider z-10">
        {product.platform}
      </div>

      {/* Top Section: Image & Key Info */}
      <div className="flex gap-4 mb-4">
        <div className="w-24 h-24 rounded-2xl bg-gray-50 border border-gray-100 p-2 flex-shrink-0 flex items-center justify-center relative">
          <img
            src={product.image}
            alt={product.title}
            className="w-full h-full object-contain mix-blend-multiply"
          />
        </div>
        <div className="flex-1 min-w-0 flex flex-col justify-center py-1">
          <h3
            className="font-bold text-slate-900 text-sm leading-tight line-clamp-2 mb-2"
            title={product.title}
          >
            {product.title}
          </h3>

          <div className="flex items-center gap-1 mb-1">
            <div className="flex text-yellow-400">
              {[...Array(5)].map((_, i) => (
                <Star
                  key={i}
                  size={10}
                  fill={i < Math.floor(product.rating || 5) ? 'currentColor' : 'none'}
                  strokeWidth={0}
                />
              ))}
            </div>
            <span className="text-[10px] font-bold text-slate-400">({product.rating || 5})</span>
          </div>

          <div>
            <p className="text-xl font-extrabold text-lime-600 leading-none">
              ₹{product.price.toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {/* Description Box (Technical / Monospace Style) */}
      <div className="bg-slate-50 rounded-xl p-3 mb-3 border border-slate-100 relative font-mono text-[10px] text-slate-500 leading-relaxed break-words">
        <div className="mb-1">
          <span className="text-indigo-600 font-bold">\"{product.brandName}\"</span> -{' '}
          {product.platform} Deal.
        </div>
        <div className="mb-2">
          Exclusive Offer via{' '}
          <span className="text-slate-900 font-bold uppercase">
            {product.mediatorCode || 'PARTNER'}
          </span>
          .
        </div>
        <div className="pt-2 border-t border-slate-200 border-dashed flex justify-between items-center">
          <span>Original Price:</span>
          <span className="text-slate-900 font-bold decoration-slice line-through">
            ₹{effectiveOriginal.toLocaleString()}
          </span>
        </div>

        {/* Decorative 'Online' Dot */}
        <div className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-lime-500 animate-pulse"></div>
      </div>

      {/* Action Button */}
      <button
        onClick={handleLinkClick}
        className="w-full py-3.5 bg-black text-white font-extrabold rounded-xl text-xs uppercase tracking-wider shadow-lg shadow-zinc-900/10 active:scale-95 transition-all flex items-center justify-center gap-2 group-hover:bg-zinc-800"
      >
        <ExternalLink size={14} className="stroke-[3]" /> GET LOOT LINK
      </button>
    </div>
  );
};
