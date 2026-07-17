// Shared "current time" ticker for relative-time labels. A SINGLE interval updates one
// module-level ref that every relative-time computed depends on — so hundreds of session
// rows refresh their "3m / 2h" labels together, without each row holding its own timer.
//
// 30s cadence: fine enough for minute-level labels, cheap enough to ignore. The interval
// starts on first use and runs for the app's lifetime (matches the store's app-lifetime
// singletons — no per-caller teardown needed).
const nowMs = shallowRef(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

export function useNow() {
  if (!timer && typeof window !== 'undefined') {
    timer = setInterval(() => {
      nowMs.value = Date.now()
    }, 30_000)
  }
  return nowMs
}
