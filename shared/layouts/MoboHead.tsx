import React from 'react';

/**
 * MoboHead — shared <head> meta tags for all MOBO apps.
 * Fonts are now handled by next/font in each app's layout.tsx.
 * Global styles are in each app's globals.css.
 */
export function MoboHead() {
  return (
    <>
      <meta charSet="UTF-8" />
      <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0, viewport-fit=cover"
      />
    </>
  );
}
