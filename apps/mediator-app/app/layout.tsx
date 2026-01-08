import type { ReactNode } from 'react';
import { MoboHead } from '../../../shared/layouts/MoboHead';
import { BODY_CLASSNAME, HTML_CLASSNAME } from '../../../shared/styles/moboGlobals';

export const metadata = {
  title: 'Mediator App',
  description: 'Minimal Next.js mediator app scaffold',
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
