import React from 'react';
import { cn } from './cn';

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  tone?: 'light' | 'dark';
};

export const Input = React.forwardRef<HTMLInputElement, Props>(function Input(
  { className, label, hint, error, leftIcon, tone = 'light', id, ...props },
  ref
) {
  const inputId = id || React.useId();

  const isDark = tone === 'dark';

  return (
    <label className="block">
      {label && (
        <span
          className={cn(
            'block text-[10px] font-extrabold uppercase tracking-widest ml-1 mb-1.5',
            isDark ? 'text-slate-500' : 'text-zinc-400'
          )}
        >
          {label}
        </span>
      )}
      <div
        className={cn(
          'relative rounded-2xl transition-all',
          isDark
            ? 'bg-slate-900 border border-slate-700 focus-within:ring-2 focus-within:ring-indigo-400/50 focus-within:border-indigo-400'
            : 'bg-zinc-50 border border-zinc-200 focus-within:bg-white focus-within:ring-2 focus-within:ring-lime-400/50 focus-within:border-lime-300',
          error
            ? isDark
              ? 'border-rose-500/40 focus-within:ring-rose-400/40 focus-within:border-rose-400/60'
              : 'border-red-200 focus-within:ring-red-400/40 focus-within:border-red-300'
            : ''
        )}
      >
        {leftIcon && (
          <div
            className={cn(
              'absolute left-4 top-1/2 -translate-y-1/2',
              isDark ? 'text-slate-500' : 'text-zinc-400'
            )}
          >
            {leftIcon}
          </div>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'w-full bg-transparent outline-none font-semibold',
            isDark ? 'text-white placeholder:text-slate-600' : 'text-zinc-900 placeholder:text-zinc-400',
            leftIcon ? 'pl-11 pr-4 py-4' : 'px-4 py-4',
            className
          )}
          {...props}
        />
      </div>
      {error ? (
        <div className={cn('mt-2 text-xs font-bold', isDark ? 'text-rose-400' : 'text-red-600')}>
          {error}
        </div>
      ) : hint ? (
        <div className={cn('mt-2 text-xs font-medium', isDark ? 'text-slate-400' : 'text-zinc-500')}>
          {hint}
        </div>
      ) : null}
    </label>
  );
});
