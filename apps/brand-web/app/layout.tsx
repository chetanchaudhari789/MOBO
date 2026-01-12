import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { MoboHead } from '../../../shared/layouts/MoboHead';
import { BODY_CLASSNAME, HTML_CLASSNAME } from '../../../shared/styles/moboGlobals';

export const metadata: Metadata = {
  title: 'Brand Web',
  description: 'Minimal Next.js brand web scaffold',
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
