'use client';
import React, { lazy, Suspense } from 'react';

/**
 * Lazy-loaded Recharts components.
 * Recharts is ~200KB gzipped — only load when charts are actually rendered.
 */

const LazyAreaChart = lazy(() => import('recharts').then(m => ({ default: m.AreaChart })));
const LazyBarChart = lazy(() => import('recharts').then(m => ({ default: m.BarChart })));
const LazyArea = lazy(() => import('recharts').then(m => ({ default: m.Area })));
const LazyBar = lazy(() => import('recharts').then(m => ({ default: m.Bar })));
const LazyXAxis = lazy(() => import('recharts').then(m => ({ default: m.XAxis })));
const LazyYAxis = lazy(() => import('recharts').then(m => ({ default: m.YAxis })));
const LazyCartesianGrid = lazy(() => import('recharts').then(m => ({ default: m.CartesianGrid })));
const LazyTooltip = lazy(() => import('recharts').then(m => ({ default: m.Tooltip })));
const LazyResponsiveContainer = lazy(() => import('recharts').then(m => ({ default: m.ResponsiveContainer })));

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
