<template>
  <span class="bom">
    <ContextMenu
      :open="open"
      :position="position"
      :items="items"
      @close="emit('close')"
      @select="onSelect"
    />

    <!-- Nhập profile browser thật vào jar của agent — modal đã có sẵn, giờ mở từ
         menu này thay vì một nút riêng trên thanh công cụ. -->
    <WorkspaceBrowserImport :open="importOpen" @close="importOpen = false" />
    <BrowserSitesModal :open="sitesOpen" @close="sitesOpen = false" />
  </span>
</template>

<script setup lang="ts">
// Menu `⋮` của chrome trình duyệt (ADR 0086) + hai hộp thoại nó mở ra.
//
// Tách khỏi BrowserChrome vì đây là một trách nhiệm riêng: chrome lo BỐ CỤC (tab
// strip, điều hướng, ô URL, ngưỡng xuống dòng), menu này lo NHỮNG VIỆC ÍT DÙNG của
// trình duyệt agent — ảnh chụp trang, cookie, chính sách host, đích mở link, xoá
// dữ liệu. Chỉ những món CÓ THẬT ở tầng dưới; không có "Open file" / "Disable auto
// verify" / "Persist sessions".
import type { MenuItem } from '~/composables/useContextMenu'
import { useConfirm } from '~/composables/useConfirm'
import { useLinkOpen } from '~/composables/useLinkOpen'
import { pushActionToast } from '~/composables/useActionToasts'

const props = withDefaults(
  defineProps<{
    open: boolean
    // Điểm mở (toạ độ viewport) — ContextMenu tự kẹp vào trong màn hình.
    position: { x: number; y: number }
    // Root tuyệt đối của workspace: đích ghi ảnh chụp. null ⇒ món đó tắt.
    root?: string | null
    tabId?: string | null
  }>(),
  { root: null, tabId: null },
)

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const { confirm } = useConfirm()
const linkOpen = useLinkOpen()

const bridge = computed(() =>
  typeof window === 'undefined' ? null : (window.awog?.browser ?? null),
)
const importOpen = ref(false)
const sitesOpen = ref(false)

const items = computed<MenuItem[]>(() => [
  {
    id: 'screenshot',
    label: t('browser.menu.screenshot'),
    icon: 'save',
    disabled: !props.root,
    ...(props.root ? {} : { hint: t('browser.menu.noProject') }),
  },
  { id: 'import', label: t('browser.menu.importCookies'), icon: 'download' },
  { id: 'sites', label: t('browser.menu.sites'), icon: 'shield' },
  { separator: true },
  {
    id: 'link-app',
    label: t('browser.menu.openLinksHere'),
    icon: 'external',
    active: linkOpen.mode.value === 'app',
  },
  { separator: true },
  { id: 'clear', label: t('browser.menu.clearData'), icon: 'trash', danger: true },
])

const fail = (err: unknown): void => {
  pushActionToast(
    t('browser.toast.failed', { message: err instanceof Error ? err.message : String(err) }),
    'error',
  )
}

const onScreenshot = async (): Promise<void> => {
  const api = bridge.value
  const root = props.root
  if (!api || !root) return
  try {
    const res = await api.saveScreenshot(root, props.tabId ?? undefined)
    // Đường dẫn tuyệt đối dài hơn cả cái toast, nên hiện phần TRONG workspace như
    // mọi chỗ khác của app (Files/Diff), và cho bấm để mở trong Finder.
    const rel = res.path.startsWith(root)
      ? res.path.slice(root.length).replace(/^[/\\]+/, '')
      : res.path
    pushActionToast(t('browser.toast.screenshot', { path: rel }), 'success', {
      action: () => void window.awog?.revealPath(root, rel).catch(() => {}),
    })
  } catch (err) {
    fail(err)
  }
}

const onClearData = async (): Promise<void> => {
  const api = bridge.value
  if (!api) return
  const ok = await confirm({
    title: t('sessions.workspace.browser.import.clearTitle'),
    description: t('sessions.workspace.browser.import.clearDesc'),
    confirmLabel: t('browser.menu.clearData'),
  })
  if (!ok) return
  try {
    await api.clearData()
    pushActionToast(t('browser.toast.cleared'), 'success')
  } catch (err) {
    fail(err)
  }
}

const onSelect = (id: string): void => {
  if (id === 'import') importOpen.value = true
  else if (id === 'sites') sitesOpen.value = true
  else if (id === 'screenshot') void onScreenshot()
  // Công tắc nối thẳng vào mode của useLinkOpen — không dựng state thứ hai.
  else if (id === 'link-app') linkOpen.setMode(linkOpen.mode.value === 'app' ? 'ask' : 'app')
  else if (id === 'clear') void onClearData()
}
</script>

<style scoped>
/* Chỉ là chỗ neo cho menu + modal (cả hai tự fixed / teleport ra body). */
.bom {
  display: contents;
}
</style>
