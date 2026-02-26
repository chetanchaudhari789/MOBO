import React from 'react';

export function MoboHead() {
  return (
    <>
      <meta charSet="UTF-8" />
      <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0, viewport-fit=cover"
      />
      <link
        href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap"
        rel="stylesheet"
      />
      <link
        href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style
        // Matches root index.html exactly
        dangerouslySetInnerHTML={{
          __html: `
      :root {
        --safe-top: env(safe-area-inset-top);
        --safe-bottom: env(safe-area-inset-bottom);
      }
      html, body {
        height: 100%;
        overflow: hidden; 
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        font-family: 'Plus Jakarta Sans', sans-serif;
      }
      body {
        background-color: #f8f9fa;
        overscroll-behavior-y: none;
      }

      /* ULTRA SMOOTH SCROLLBARS */
      .scrollbar-hide::-webkit-scrollbar { display: none; }
      .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      
      /* ANIMATIONS */
      .animate-enter { animation: enter 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      @keyframes enter {
        from { opacity: 0; transform: scale(0.98) translateY(10px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }

      .animate-slide-up { animation: slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      @keyframes slideUp {
        from { transform: translateY(100%); }
        to { transform: translateY(0); }
      }

      @keyframes mobo-float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-4px); }
      }

      @keyframes mobo-pulse {
        0%, 100% { transform: scale(0.95); opacity: 0.4; }
        50% { transform: scale(1.05); opacity: 0.7; }
      }

      /* GLASS & BLUR UTILS */
      .glass {
        background: rgba(255, 255, 255, 0.85);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.5);
      }

      .shadow-glow {
        box-shadow: 0 0 40px -10px rgba(163, 230, 53, 0.5);
      }
    `,
        }}
      />
    </>
  );
}
