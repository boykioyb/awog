// Dev-mode bridge: when the Nuxt dev server runs in a bare browser (no Electron
// shell), `window.awog` does not exist and every IPC call throws
// `SidecarUnavailableError`. This plugin installs a fetch/EventSource shim that
// forwards JSON-RPC + SSE to the local engine-relay on :4899 — gated by
// `?awog-shim=1` or `localStorage['awog.shim']` so real Electron runs skip it.
// Remove with the relay once browser-mode sidecar transport lands.

const RELAY = 'http://localhost:4899'

export default defineNuxtPlugin(() => {
  if (typeof window === 'undefined' || window.awog) return
  const params = new URLSearchParams(window.location.search)
  const want = params.has('awog-shim') || window.localStorage.getItem('awog.shim') === '1'
  if (!want) return

  const handlers = new Set<(type: string, payload: unknown) => void>()
  let es: EventSource | null = null
  const ensureEs = () => {
    if (es) return
    es = new EventSource(`${RELAY}/events`)
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as { type: string; payload: unknown }
        for (const h of handlers) {
          try {
            h(msg.type, msg.payload)
          } catch {
            /* per-handler */
          }
        }
      } catch {
        /* parse */
      }
    }
  }

  window.awog = {
    request: async (method: string, params?: unknown) => {
      const res = await fetch(`${RELAY}/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, params: params ?? null }),
      }).then((r) => r.json())
      if (res.error)
        throw Object.assign(new Error(res.error.message || 'rpc'), { rpcError: res.error })
      return res.result
    },
    onEvent: (fn: (type: string, payload: unknown) => void) => {
      ensureEs()
      handlers.add(fn)
      return () => handlers.delete(fn)
    },
    // Surfaces probed by components — keep them falsy so callers take their
    // `!api` fallback instead of crashing on a stub.
    browser: null,
    platform: { os: 'darwin', arch: 'arm64' },
  } as unknown as typeof window.awog
})
