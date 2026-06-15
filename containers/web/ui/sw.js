/**
 * sw.js — Service Worker for 42 Web UI.
 *
 * Injects X-Session-ID header into all same-origin requests
 * for server-side request tracking and logging.
 */

const SESSION_ID = new URL(self.location.href).searchParams.get('sid') || '-';

self.addEventListener('install', () => {
   self.skipWaiting();
});

self.addEventListener('activate', (event) => {
   event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
   const url = new URL(event.request.url);

   /* Only intercept same-origin requests */
   if (url.origin !== self.location.origin) return;

   /* Skip WASM/data files (they're large; don't clone) */
   if (url.pathname.endsWith('.wasm') || url.pathname.endsWith('.data')) return;

   const headers = new Headers(event.request.headers);
   headers.set('X-Session-ID', SESSION_ID);

   const modified = new Request(event.request, {
      headers,
      cache: 'no-store',
   });

   event.respondWith(fetch(modified));
});
