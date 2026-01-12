import React from 'react';
import { cn } from './cn';

type Props = React.HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: Props) {
  return (
    <div
      className={cn('bg-white border border-zinc-100 rounded-[2rem] shadow-sm', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: Props) {
  return <div className={cn('p-6 pb-0', className)} {...props} />;
}

export function CardContent({ className, ...props }: Props) {
  return <div className={cn('p-6', className)} {...props} />;
}
