import React from 'react';
import { Package, Menu } from 'lucide-react';

export const Navbar: React.FC = () => {
  return (
    <nav className="flex-none bg-white/80 backdrop-blur-md border-b border-gray-100 z-30 sticky top-0 safe-top">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        {/* Branding */}
        <div className="flex items-center gap-2">
          <div className="bg-lime-400 text-black p-1.5 rounded-lg shadow-sm">
            <Package size={20} />
          </div>
          <span className="font-extrabold text-xl tracking-tight text-slate-900">Mobo</span>
        </div>

        {/* Optional Menu Icon for future expansion */}
        <button
          aria-label="Open menu"
          className="p-2 text-slate-400 hover:text-slate-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white rounded"
        >
          <Menu size={20} />
        </button>
      </div>
    </nav>
  );
};
