import React, { useState } from 'react';
import { ZoomIn, X } from 'lucide-react';

/**
 * A clickable image with zoom-to-fullscreen overlay.
 * Used across all portal proof viewers for screenshot inspection.
 */
export const ZoomableImage: React.FC<{
  src: string;
  alt: string;
  className?: string;
}> = ({ src, alt, className }) => {
  const [zoomed, setZoomed] = useState(false);
  return (
    <>
      <div className="relative group cursor-pointer" onClick={() => setZoomed(true)}>
        <img
          src={src}
          alt={alt}
          className={
            className ||
            'w-full h-auto rounded-xl max-h-[60vh] object-contain border border-slate-100'
          }
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded-xl flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 backdrop-blur-sm p-2 rounded-full shadow-lg">
            <ZoomIn size={16} className="text-slate-700" />
          </div>
        </div>
      </div>
      {zoomed && (
        <div
          className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-4 cursor-zoom-out animate-fade-in"
          onClick={() => setZoomed(false)}
        >
          <img src={src} alt={alt} className="max-w-full max-h-full object-contain" />
          <button
            onClick={() => setZoomed(false)}
            className="absolute top-4 right-4 p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors"
          >
            <X size={20} className="text-white" />
          </button>
        </div>
      )}
    </>
  );
};
