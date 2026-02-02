/* Wrapper service worker to ensure a stable URL for registration. */
try {
  importScripts('/sw.js');
} catch (error) {
  // Fallback minimal handlers if sw.js is unavailable.
  self.addEventListener('fetch', () => undefined);
}
