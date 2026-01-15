import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import './globals.css';
import { MoboHead } from '../../../shared/layouts/MoboHead';
import { BODY_CLASSNAME, HTML_CLASSNAME } from '../../../shared/styles/moboGlobals';

export const metadata: Metadata = {
  title: 'MOBO Brand',
  description: 'Brand portal for inventory, orders, payouts, and brand operations.',
  robots: { index: false, follow: false },
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={HTML_CLASSNAME} suppressHydrationWarning>
      <head>
        <MoboHead />
      </head>
      <body className={BODY_CLASSNAME} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
