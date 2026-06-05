import type { Ref } from 'vue'

/**
 * Gọi `handler` khi user click ra ngoài element trỏ bởi `targetRef`.
 *
 * Dùng `mousedown` (không `click`) để tránh race với button click bên trong:
 * nếu button trong target được click, `mousedown` xảy ra trước; handler kiểm
 * tra `target.contains(event.target)` và bỏ qua. Nếu dùng `click`, một số
 * button (vd. menu trigger) sẽ disappear ngay khi handler chạy.
 *
 * Listener gắn ở `document` mỗi instance — không share giữa caller vì target
 * khác nhau. Cleanup ở `onBeforeUnmount`.
 *
 * @example
 * const menuRef = ref<HTMLElement | null>(null)
 * useClickOutside(menuRef, () => (open.value = false))
 */
export const useClickOutside = (
  // Read-only Ref so it accepts ref(), shallowRef(), and useTemplateRef() alike
  // (the composable only reads `.value`). useTemplateRef is the preferred way to
  // pass a template ref — vue-tsc mis-types a plain `ref<HTMLElement>()` bound via
  // `ref="x"` as a structurally-expanded HTMLElement that won't match this param.
  targetRef: Readonly<Ref<HTMLElement | null>>,
  handler: (event: MouseEvent) => void,
) => {
  const onMousedown = (event: MouseEvent) => {
    const el = targetRef.value
    if (!el) return
    if (event.target instanceof Node && el.contains(event.target)) return
    handler(event)
  }

  onMounted(() => {
    if (typeof document !== 'undefined') {
      document.addEventListener('mousedown', onMousedown)
    }
  })

  onBeforeUnmount(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('mousedown', onMousedown)
    }
  })
}
