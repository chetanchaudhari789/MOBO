'use client';
import React, { Suspense } from 'react';

/**
 * Recharts re-exports for dashboard charts.
 *
 * Why direct imports instead of React.lazy()?
 * -------------------------------------------
 * Recharts sub-components (Area, Bar, XAxis, etc.) CANNOT be wrapped in
 * React.lazy() because recharts chart containers identify their children by
 * checking `child.type` at runtime. React.lazy() wraps the type in a
 * Suspense-compatible shell, which breaks this detection and causes a
 * runtime crash ("Something went wrong").
 *
 * Code-splitting is still effective because:
 * 1. Dashboard pages are already lazy-loaded via React.lazy() in the App
 *    entry components (AgencyApp, BrandApp, etc.)
 * 2. Next.js automatically code-splits dynamic imports, so recharts only
 *    loads when the dashboard chunk loads — never in the initial bundle.
 * 3. ChartSuspense wraps chart regions to show a skeleton while loading.
 */
import {
  AreaChart,
  BarChart,
  ResponsiveContainer,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

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
  AreaChart,
  BarChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
};
