import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

// Tay kéo đổi bề rộng cột danh sách thread Slack (SlackWorkspace). Cùng khuôn tay kéo
// của app (`useResizable`: pointer capture trên chính tay kéo) nhưng trần là 60% bề
// rộng workspace — số động theo cửa sổ, `useResizable` chỉ nhận trần cố định.
//
// Bề rộng nhớ ở localStorage (cùng origin ⇒ modal và cửa sổ Slack riêng dùng chung một
// giá trị). Bề rộng đã lưu lớn hơn trần hiện tại (cửa sổ hẹp hơn lúc lưu) thì chỉ KẸP
// lúc hiện, không ghi đè số đã lưu — mở rộng cửa sổ lại là về đúng bề rộng cũ.

const STORAGE_KEY = 'awog.slack.listWidth'
export const SLACK_LIST_MIN = 240
// Bằng `flex-basis` mặc định của `.slk-list` trước khi có tay kéo.
const SLACK_LIST_DEFAULT = 380
const MAX_RATIO = 0.6
const KEY_STEP = 16

function readStored(): number {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY))
    return Number.isFinite(n) && n >= SLACK_LIST_MIN ? Math.round(n) : SLACK_LIST_DEFAULT
  } catch {
    return SLACK_LIST_DEFAULT
  }
}

function writeStored(w: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(w))
  } catch {
    // localStorage bị chặn/đầy: bề rộng chỉ sống tới lần mở sau, không đáng báo lỗi.
  }
}

/** `container` = hàng chứa cột danh sách + khung thread (để tính trần 60%). */
export function useSlackListResize(container: Readonly<Ref<HTMLElement | null>>) {
  const stored = ref(readStored())
  const containerW = ref(0)
  const dragging = ref(false)

  const max = computed(() =>
    containerW.value ? Math.max(SLACK_LIST_MIN, Math.floor(containerW.value * MAX_RATIO)) : 10_000,
  )
  const clamp = (w: number): number => Math.min(max.value, Math.max(SLACK_LIST_MIN, Math.round(w)))
  const width = computed(() => clamp(stored.value))

  function set(w: number): void {
    stored.value = clamp(w)
    writeStored(stored.value)
  }

  let ro: ResizeObserver | null = null
  onMounted(() => {
    const el = container.value
    if (!el) return
    containerW.value = el.clientWidth
    ro = new ResizeObserver(() => (containerW.value = el.clientWidth))
    ro.observe(el)
  })

  // Trong lúc kéo: không bôi đen chữ, và iframe/webview (xem trước file, trình duyệt nhúng)
  // không được nuốt pointer khi chuột lướt qua chúng.
  let restore: (() => void) | null = null
  function freezePage(): void {
    const body = document.body
    const prevSelect = body.style.userSelect
    body.style.userSelect = 'none'
    const frames = [...document.querySelectorAll<HTMLElement>('iframe, webview')]
    const prevPe = frames.map((f) => f.style.pointerEvents)
    for (const f of frames) f.style.pointerEvents = 'none'
    restore = () => {
      body.style.userSelect = prevSelect
      frames.forEach((f, i) => (f.style.pointerEvents = prevPe[i] ?? ''))
      restore = null
    }
  }

  function onPointerDown(ev: PointerEvent): void {
    if (ev.button !== 0) return
    ev.preventDefault()
    const handle = ev.currentTarget as HTMLElement
    handle.setPointerCapture(ev.pointerId)
    dragging.value = true
    freezePage()
    const startX = ev.clientX
    const startW = width.value
    const onMove = (e: PointerEvent): void => {
      stored.value = clamp(startW + e.clientX - startX)
    }
    const onEnd = (): void => {
      dragging.value = false
      restore?.()
      writeStored(stored.value)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onEnd)
      handle.removeEventListener('lostpointercapture', onEnd)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onEnd)
    // pointercancel / mất focus cửa sổ ⇒ mất capture: vẫn phải nhả body + iframe.
    handle.addEventListener('lostpointercapture', onEnd)
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    set(width.value + (e.key === 'ArrowRight' ? KEY_STEP : -KEY_STEP))
  }

  const reset = (): void => set(SLACK_LIST_DEFAULT)

  onBeforeUnmount(() => {
    ro?.disconnect()
    restore?.()
  })

  return { width, max, min: SLACK_LIST_MIN, dragging, onPointerDown, onKeydown, reset }
}
