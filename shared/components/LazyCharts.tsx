'use client';
import React, { lazy, Suspense } from 'react';

/**
 * Lazy-loaded Recharts components.
 * Recharts is ~200KB gzipped — only load when charts are actually rendered.
 * Container components (AreaChart, BarChart, ResponsiveContainer) are lazy-loaded.
 * Sub-components (Area, Bar, XAxis, etc.) are re-exported directly since they
 * are class components that aren't compatible with React.lazy().
 */

const LazyAreaChart = lazy(() => import('recharts').then(m => ({ default: m.AreaChart })));
const LazyBarChart = lazy(() => import('recharts').then(m => ({ default: m.BarChart })));
const LazyResponsiveContainer = lazy(() => import('recharts').then(m => ({ default: m.ResponsiveContainer })));

// Re-export sub-components as async imports to avoid loading recharts eagerly.
// These are used inside chart containers which are already lazy-loaded above.

// Sub-components: use lazy with explicit ComponentType cast to satisfy TS strict mode.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LazyArea = lazy(() => import('recharts').then(m => ({ default: m.Area as any as React.ComponentType<any> })));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LazyBar = lazy(() => import('recharts').then(m => ({ default: m.Bar as any as React.ComponentType<any> })));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LazyXAxis = lazy(() => import('recharts').then(m => ({ default: m.XAxis as any as React.ComponentType<any> })));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LazyYAxis = lazy(() => import('recharts').then(m => ({ default: m.YAxis as any as React.ComponentType<any> })));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LazyCartesianGrid = lazy(() => import('recharts').then(m => ({ default: m.CartesianGrid as any as React.ComponentType<any> })));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LazyTooltip = lazy(() => import('recharts').then(m => ({ default: m.Tooltip as any as React.ComponentType<any> })));

/** Wrapper that shows a skeleton while Recharts loads */
function ChartFallback() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-slate-50 rounded-2xl animate-pulse">
      <div className="text-xs text-slate-400 font-medium">Loading chart…</div>
    </div>
  );
}

export function ChartSuspense({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<ChartFallback />}>{children}</Suspense>;
}

export {
  LazyAreaChart as AreaChart,
  LazyBarChart as BarChart,
  LazyArea as Area,
  LazyBar as Bar,
  LazyXAxis as XAxis,
  LazyYAxis as YAxis,
  LazyCartesianGrid as CartesianGrid,
  LazyTooltip as Tooltip,
  LazyResponsiveContainer as ResponsiveContainer,
};
