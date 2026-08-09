/* AWOG Remote — app-shell service worker.
 *
 * Purpose: the PWA opens instantly (and shows a real offline screen instead of the
 * browser's dinosaur) when the phone has no route to the desktop. It caches ONLY
 * the static shell shipped by the gateway; every piece of session data still comes
 * over the authenticated WebSocket and is NEVER cached — nothing about a
 * transcript, diff or token is written to disk here.
 *
 * Strategy:
 *   - navigation  → network-first, fall back to the cached index.html
 *   - /assets/*   → cache-first (Vite content-hashes these, so they are immutable)
 *   - everything else → network, cache a copy for next time
 *
 * Registration only happens in a secure context (see src/pwa.ts) — over plain HTTP
 * on a tailnet IP the browser refuses service workers and the app runs unchanged.
 */

const CACHE = 'awog-remote-v1'
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => undefined))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// The page asks to swap in a freshly installed worker (Settings → Cập nhật).
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting()
})

async function cachePut(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return
  const cache = await caches.open(CACHE)
  await cache.put(request, response.clone())
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          void cachePut(request, res)
          return res
        })
        .catch(async () => (await caches.match('./index.html')) ?? Response.error()),
    )
    return
  }

  const immutable = url.pathname.includes('/assets/')
  event.respondWith(
    (async () => {
      const hit = await caches.match(request)
      if (hit && immutable) return hit
      try {
        const res = await fetch(request)
        void cachePut(request, res)
        return res
      } catch (err) {
        if (hit) return hit
        throw err
      }
    })(),
  )
})

// Tapping a gate/turn notification focuses the app instead of opening a new tab.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c)
      if (open) return open.focus()
      return self.clients.openWindow('./')
    }),
  )
})
