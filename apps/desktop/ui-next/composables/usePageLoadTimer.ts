import type { AwogBrowserTab } from '~/types/awog-bridge'

// Đồng hồ tải trang của chrome trình duyệt: đếm sống khi tab đang tải, giữ con số cuối
// khi xong. Mốc thời gian lấy từ MAIN (`loadStartedAt` = `did-start-loading`, `loadMs` =
// tới `did-stop-loading` — spinner tắt, mọi frame xong) chứ không từ lúc renderer nhận
// được bản cập nhật, nên con số không cộng thêm độ trễ IPC. Cùng một máy ⇒ cùng đồng hồ
// `Date.now()` nên trừ mốc của main cho bộ đếm sống là hợp lệ.
const TICK_MS = 100

export function usePageLoadTimer(tab: () => AwogBrowserTab | null) {
  const { t } = useI18n()
  const now = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | undefined

  // Đang đo = main đã ghi mốc bắt đầu của lượt điều hướng khung chính nhưng CHƯA có
  // `loadMs`. Không dựa vào `tab.loading`: iframe tải muộn bật lại cờ đó sau khi trang
  // đã xong, và đồng hồ sẽ chạy lại từ mốc cũ.
  const running = computed(() => {
    const cur = tab()
    return typeof cur?.loadStartedAt === 'number' && cur.loadMs == null
  })

  // Chỉ tick khi đang tải — đứng yên thì không tốn một interval nào.
  watch(
    running,
    (on) => {
      clearInterval(timer)
      timer = undefined
      if (!on) return
      now.value = Date.now()
      timer = setInterval(() => {
        now.value = Date.now()
      }, TICK_MS)
    },
    { immediate: true },
  )
  onBeforeUnmount(() => clearInterval(timer))

  const elapsedMs = computed<number | null>(() => {
    const cur = tab()
    if (!cur) return null
    if (running.value && typeof cur.loadStartedAt === 'number') {
      return Math.max(0, now.value - cur.loadStartedAt)
    }
    return typeof cur.loadMs === 'number' ? cur.loadMs : null
  })

  const text = computed(() =>
    elapsedMs.value === null ? '' : `${(elapsedMs.value / 1000).toFixed(1)}s`,
  )
  const title = computed(() => {
    if (elapsedMs.value === null) return ''
    return running.value
      ? t('browser.loadTimer.running', { ms: elapsedMs.value })
      : t('browser.loadTimer.done', { ms: elapsedMs.value })
  })

  return { running, text, title }
}
