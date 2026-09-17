import { nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'

// Neo một lớp nổi ĐÃ TELEPORT ra `<body>` vào một phần tử kích hoạt.
//
// VÌ SAO TỒN TẠI. Lớp nổi `position: absolute` bị CẮT bởi bất kỳ tổ tiên nào có
// `overflow` khác `visible` — và theo CSS, đặt một trục là `auto` thì trục kia cũng
// thành `auto`, nên một cột chỉ định `overflow-y` cũng xén luôn theo chiều ngang.
// Đó không phải "bị đè": không z-index nào với tới được, vì phần bị cắt KHÔNG ĐƯỢC
// VẼ. Trong hai ngày 16–17/09/2026 lỗi này nổ ở ba chỗ khác nhau (popover khoảng
// thời gian trong cột Nhật ký, menu ⋯ của message trong `.msgs`, menu `+` của danh
// sách phiên trong `.list`), và mỗi chỗ lại tự viết một bản vá riêng.
//
// Cách duy nhất không phải nhớ: teleport ra `<body>` rồi định vị `fixed` bằng toạ độ
// đo từ nút. Composable này giữ phép đo đó ở MỘT chỗ, kèm ba thứ mà bản chép tay
// hay quên:
//
//   1. `scroll` bắt ở pha CAPTURE — nút thường nằm trong một khung có thanh cuộn
//      riêng, và sự kiện cuộn của một phần tử KHÔNG nổi bọt lên `window`.
//   2. ĐO HAI LƯỢT — lượt đầu trước khi lớp nổi mount (chưa biết chiều cao thật),
//      lượt sau trong `nextTick` để quyết định lật lên hay xuống cho đúng.
//   3. Kẹp trong viewport cả hai trục, kể cả khi nút nằm sát mép.
//
// KHÔNG lo phần đóng/mở: `open` là của bên gọi, và click-ra-ngoài thì mỗi nơi có
// khuôn riêng (backdrop, `useEscToClose`, hay listener của chính nó).

export type PopoverAnchorOptions = {
  /** Hướng ưu tiên. Thiếu chỗ thì tự lật sang hướng còn lại. */
  prefer?: 'below' | 'above'
  /** Neo theo mép nào của nút. */
  align?: 'left' | 'right'
  /** Khoảng hở giữa nút và lớp nổi. */
  gap?: number
  /** Chừa lại quanh mép viewport. */
  margin?: number
  /** Bề rộng cố định; bỏ trống thì giữ bề rộng tự nhiên của lớp nổi. */
  width?: number
  /** Trần chiều cao; lớp nổi luôn được kẹp thêm theo chỗ trống thực tế. */
  maxHeight?: number
  /** Sàn chiều cao — dưới mức này thì thà tràn còn hơn thành một khe không đọc được. */
  minHeight?: number
}

export function usePopoverAnchor(
  trigger: Readonly<Ref<HTMLElement | null>>,
  pop: Readonly<Ref<HTMLElement | null>>,
  open: Readonly<Ref<boolean>>,
  options: PopoverAnchorOptions = {},
) {
  const {
    prefer = 'below',
    align = 'left',
    gap = 6,
    margin = 8,
    width,
    maxHeight = 520,
    minHeight = 160,
  } = options

  const style = ref<Record<string, string>>({})

  function update(): void {
    const el = trigger.value
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    const w = width ?? Math.max(pop.value?.offsetWidth ?? 0, 0)
    const wanted = pop.value?.scrollHeight ?? 0

    const spaceBelow = vh - r.bottom - gap - margin
    const spaceAbove = r.top - gap - margin
    const want = Math.min(wanted || maxHeight, maxHeight)
    const below =
      prefer === 'below'
        ? spaceBelow >= want || spaceBelow >= spaceAbove
        : spaceAbove < want && spaceBelow > spaceAbove

    // Neo theo mép chỉ định, rồi kẹp để không lọt khỏi viewport bên nào.
    const rawLeft = align === 'right' ? r.right - w : r.left
    const left =
      w > 0 ? Math.max(margin, Math.min(rawLeft, vw - w - margin)) : Math.max(margin, rawLeft)

    style.value = {
      left: `${String(Math.round(left))}px`,
      ...(width !== undefined ? { width: `${String(Math.round(width))}px` } : {}),
      maxHeight: `${String(Math.round(Math.max(minHeight, Math.min(maxHeight, below ? spaceBelow : spaceAbove))))}px`,
      ...(below
        ? { top: `${String(Math.round(r.bottom + gap))}px` }
        : { bottom: `${String(Math.round(vh - r.top + gap))}px` }),
    }
  }

  function onReposition(): void {
    if (open.value) update()
  }

  function detach(): void {
    window.removeEventListener('resize', onReposition)
    window.removeEventListener('scroll', onReposition, true)
  }

  watch(open, async (isOpen) => {
    if (!isOpen) {
      detach()
      return
    }
    update()
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    await nextTick()
    update()
  })

  onBeforeUnmount(detach)

  return { style, update }
}
