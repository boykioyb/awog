import { ref } from 'vue'

// Service-worker lifecycle: register the app-shell worker (public/sw.js), watch
// for a newer build shipped by the desktop, and let the user swap it in.
//
// Registration is a no-op unless the page is a secure context — the gateway
// serves plain HTTP on the tailnet IP today, and browsers refuse service workers
// there. Everything else in the app works the same either way.

export const updateReady = ref(false)
export const swActive = ref(false)

let waiting: ServiceWorker | null = null

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((reg) => {
        swActive.value = true
        if (reg.waiting) {
          waiting = reg.waiting
          updateReady.value = true
        }
        reg.addEventListener('updatefound', () => {
          const next = reg.installing
          if (!next) return
          next.addEventListener('statechange', () => {
            // "installed" while another worker controls the page = a new build is
            // ready and parked; surface it instead of swapping mid-session.
            if (next.state === 'installed' && navigator.serviceWorker.controller) {
              waiting = next
              updateReady.value = true
            }
          })
        })
      })
      .catch(() => {
        // Offline shell is a nicety, never a hard dependency.
      })
  })
}

export function applyUpdate(): void {
  waiting?.postMessage('skip-waiting')
  // The new worker takes control on the next navigation.
  location.reload()
}
