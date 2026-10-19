<template>
  <!-- pointerenter/pointerdown: chụp sẵn frame trang (thư mục, », menu chuột phải đều
       mở bề mặt nổi chồng lên trang) — xem prefetchBrowserFrame. -->
  <div
    ref="rowEl"
    class="relative flex min-h-ctrl-xs shrink-0 items-center gap-1 overflow-hidden px-2 py-0.5 shadow-[inset_0_-1px_0_var(--color-border)]"
    @contextmenu.self.prevent
    @pointerenter="prefetchBrowserFrame"
    @pointerdown="prefetchBrowserFrame"
  >
    <!-- Hàng ĐO: cùng chip nhưng ẩn + ngoài luồng, để biết bề rộng thật của từng chip mà
         không phải render rồi cắt. Kết quả → `visibleCount`; phần còn lại vào menu ».
         Class chip ở đây PHẢI khớp chip thật bên dưới (gap/padding/cỡ chữ/max-w), lệch
         là phép đo sai. -->
    <div
      ref="measureEl"
      class="pointer-events-none invisible absolute top-0 left-0 flex gap-1"
      aria-hidden="true"
    >
      <span
        v-for="n in items"
        :key="n.id"
        class="flex max-w-37.5 flex-none items-center gap-1.5 px-2 py-0.5 text-xs"
      >
        <Icon :name="n.kind === 'folder' ? 'folder' : 'bookmark'" class="size-3 flex-none" />
        <span class="truncate">{{ labelOf(n) }}</span>
        <Icon v-if="n.kind === 'folder'" name="chev" class="size-2.5 flex-none" />
      </span>
    </div>

    <template v-if="items.length">
      <!-- Trang đang xem = accent-tint (bg-selected), không fill xám. -->
      <Button
        v-for="n in shown"
        :key="n.id"
        variant="ghost"
        class="h-auto max-w-37.5 flex-none gap-1.5 px-2 py-0.5 text-xs font-normal text-muted-foreground hover:text-foreground [&_svg]:size-3 [&_svg]:text-faint"
        :class="n.kind === 'url' && sameUrl(n.url, currentUrl) && 'bg-selected text-foreground'"
        :title="n.kind === 'url' ? n.url : n.title"
        @click="onChipClick(n, $event)"
        @auxclick.middle.prevent="n.kind === 'url' && emit('open', n.url, 'new')"
        @contextmenu.prevent="openCtx($event, n)"
      >
        <Icon :name="n.kind === 'folder' ? 'folder' : 'bookmark'" />
        <span class="truncate">{{ labelOf(n) }}</span>
        <!-- px-ok: caret nhỏ cạnh nhãn thư mục (10px), `!` để thắng [&_svg]:size-3 của nút. -->
        <Icon v-if="n.kind === 'folder'" name="chev" class="size-2.5!" />
      </Button>
      <Button
        v-if="hiddenItems.length"
        variant="ghost"
        class="h-auto flex-none px-2 py-0.5 text-xs font-normal text-muted-foreground hover:text-foreground"
        :title="t('browser.bookmarks.more')"
        :aria-label="t('browser.bookmarks.more')"
        @click.stop="openMore"
      >
        <span aria-hidden="true">»</span>
      </Button>
    </template>
    <span v-else class="truncate text-xs text-faint">{{ t('browser.bookmarks.emptyHint') }}</span>

    <AppContextMenu
      :open="menu !== null"
      :position="menu?.at ?? { x: 0, y: 0 }"
      :items="menuItems"
      @close="menu = null"
      @select="onSelect"
    />
    <BrowserBookmarkDialog
      :open="editId !== null"
      :profile-id="profileId"
      :url="''"
      :title="''"
      :bookmark-id="editId ?? undefined"
      @close="editId = null"
    />
  </div>
</template>

<script setup lang="ts">
// Thanh bookmark kiểu Chrome dưới hàng URL (thay dải pin cũ — ADR 0101): bookmark +
// thư mục MỘT cấp, thư mục mở thành dropdown, phần tràn chuyển vào menu ».
//
// Mọi dropdown/menu là AppContextMenu (`.smenu`) chứ không phải popover tự vẽ — view
// native của trang vẽ đè lên DOM, và chỉ các selector trong OVERLAYS của
// useEmbeddedBrowser mới khiến trang nhường chỗ. Menu tự vẽ ngoài danh sách đó sẽ
// bị trang che mất.
import type { BookmarkNode } from '~/types'
import type { MenuItem } from '~/composables/useContextMenu'
import { bookmarkKey, useBookmarks } from '~/composables/useBookmarks'
import { sidecarErrorText } from '~/composables/useSidecar'
import { prefetchBrowserFrame } from '~/composables/useEmbeddedBrowser'

const props = defineProps<{
  profileId: string
  // URL đang TẢI THẬT (tô accent chip của trang đang xem).
  currentUrl: string
}>()

const emit = defineEmits<{
  // 'current' = điều hướng tab đang xem; 'new' = tab mới.
  open: [url: string, mode: 'current' | 'new']
}>()

const { t } = useI18n()
const { prompt } = useTextPrompt()
const bm = useBookmarks(() => props.profileId)
const items = bm.items
const labelOf = bm.labelOf

const sameUrl = (a: string, b: string): boolean => !!a && bookmarkKey(a) === bookmarkKey(b)

// ── Tràn → menu » ───────────────────────────────────────────────────────────

const rowEl = useTemplateRef<HTMLElement>('rowEl')
const measureEl = useTemplateRef<HTMLElement>('measureEl')
const visibleCount = ref(Number.POSITIVE_INFINITY)

const GAP = 4
// Bề rộng nút » + gap — chừa chỗ trước khi quyết định chip nào vừa.
const MORE_W = 28

const recompute = (): void => {
  const row = rowEl.value
  const meas = measureEl.value
  if (!row || !meas) return
  const widths = Array.from(meas.children, (c) => (c as HTMLElement).offsetWidth)
  // clientWidth trừ padding hai bên của hàng.
  const style = getComputedStyle(row)
  const avail = row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  const total = widths.reduce((a, w) => a + w, 0) + GAP * Math.max(0, widths.length - 1)
  if (total <= avail) {
    visibleCount.value = widths.length
    return
  }
  let used = 0
  let n = 0
  for (const w of widths) {
    const next = used + w + (n > 0 ? GAP : 0)
    if (next + GAP + MORE_W > avail) break
    used = next
    n++
  }
  visibleCount.value = n
}

let ro: ResizeObserver | null = null
onMounted(() => {
  ro = new ResizeObserver(recompute)
  if (rowEl.value) ro.observe(rowEl.value)
  recompute()
})
onBeforeUnmount(() => ro?.disconnect())
// Danh sách/nhãn đổi → đo lại sau khi hàng đo render xong.
watch(items, () => void nextTick(recompute), { deep: true })

const shown = computed(() => items.value.slice(0, visibleCount.value))
const hiddenItems = computed(() =>
  items.value.slice(Number.isFinite(visibleCount.value) ? visibleCount.value : items.value.length),
)

// ── Menu: dropdown thư mục · » · chuột phải ─────────────────────────────────

type MenuState =
  | { kind: 'folder'; at: { x: number; y: number }; folderId: string }
  | { kind: 'more'; at: { x: number; y: number } }
  | { kind: 'ctx'; at: { x: number; y: number }; node: BookmarkNode }
const menu = ref<MenuState | null>(null)
const editId = ref<string | null>(null)

const toRow = (n: BookmarkNode): MenuItem =>
  n.kind === 'url'
    ? { id: `go:${n.id}`, label: labelOf(n), icon: 'bookmark', hint: hostOf(n.url) }
    : {
        id: `folder:${n.id}`,
        label: n.title,
        icon: 'folder',
        children: n.children.length
          ? n.children.map(toRow)
          : [{ id: 'none', label: t('browser.bookmarks.folderEmpty'), disabled: true }],
      }

const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

const menuItems = computed<MenuItem[]>(() => {
  const m = menu.value
  if (!m) return []
  if (m.kind === 'folder') {
    const f = items.value.find((n) => n.id === m.folderId)
    if (f?.kind !== 'folder' || !f.children.length)
      return [{ id: 'none', label: t('browser.bookmarks.folderEmpty'), disabled: true }]
    return f.children.map(toRow)
  }
  if (m.kind === 'more') return hiddenItems.value.map(toRow)
  const base: MenuItem[] =
    m.node.kind === 'url'
      ? [
          { id: 'open', label: t('browser.bookmarks.open'), icon: 'external' },
          { id: 'open-new', label: t('browser.bookmarks.openNew'), icon: 'plus' },
          { separator: true },
        ]
      : []
  return [
    ...base,
    { id: 'edit', label: t('browser.bookmarks.edit'), icon: 'edit' },
    { id: 'delete', label: t('browser.bookmarks.remove'), icon: 'trash', danger: true },
  ]
})

const anchorBelow = (el: HTMLElement): { x: number; y: number } => {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.bottom + 2 }
}

const onChipClick = (n: BookmarkNode, ev: MouseEvent): void => {
  if (n.kind === 'folder') {
    // AppContextMenu đóng mình bằng click ở `document` — không chặn thì menu vừa mở
    // đã bị chính cú click này đóng ngay.
    ev.stopPropagation()
    menu.value = {
      kind: 'folder',
      at: anchorBelow(ev.currentTarget as HTMLElement),
      folderId: n.id,
    }
    return
  }
  // ⌘/Ctrl-click = tab mới, như mọi trình duyệt.
  emit('open', n.url, ev.metaKey || ev.ctrlKey ? 'new' : 'current')
}

const openMore = (ev: MouseEvent): void => {
  menu.value = { kind: 'more', at: anchorBelow(ev.currentTarget as HTMLElement) }
}

const openCtx = (ev: MouseEvent, node: BookmarkNode): void => {
  menu.value = { kind: 'ctx', at: { x: ev.clientX, y: ev.clientY }, node }
}

const findUrl = (id: string): string | undefined =>
  bm.flat.value.find((e) => e.node.id === id)?.node.url

const renameFolder = async (id: string, current: string): Promise<void> => {
  const name = await prompt({ title: t('browser.bookmarks.renameFolder'), value: current })
  if (!name || name === current) return
  try {
    await bm.update(id, { title: name })
  } catch (err) {
    fail(err)
  }
}

const fail = (err: unknown): void => {
  useToast().add({
    title: t('browser.toast.failed', { message: sidecarErrorText(err) }),
    color: 'error',
  })
}

const onSelect = (id: string): void => {
  const m = menu.value
  if (id.startsWith('go:')) {
    const url = findUrl(id.slice(3))
    if (url) emit('open', url, 'current')
    return
  }
  if (m?.kind !== 'ctx') return
  if (id === 'open' || id === 'open-new') {
    if (m.node.kind === 'url') emit('open', m.node.url, id === 'open' ? 'current' : 'new')
  } else if (id === 'edit') {
    if (m.node.kind === 'folder') void renameFolder(m.node.id, m.node.title)
    else editId.value = m.node.id
  } else if (id === 'delete') {
    void bm.remove(m.node.id).catch(fail)
  }
}
</script>
