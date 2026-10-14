<template>
  <!-- pointerenter/pointerdown: chụp sẵn frame trang (thư mục, », menu chuột phải đều
       mở bề mặt nổi chồng lên trang) — xem prefetchBrowserFrame. -->
  <div
    ref="rowEl"
    class="bmb"
    @contextmenu.self.prevent
    @pointerenter="prefetchBrowserFrame"
    @pointerdown="prefetchBrowserFrame"
  >
    <!-- Hàng ĐO: cùng chip nhưng ẩn + ngoài luồng, để biết bề rộng thật của từng chip mà
         không phải render rồi cắt. Kết quả → `visibleCount`; phần còn lại vào menu ». -->
    <div ref="measureEl" class="bmb-measure" aria-hidden="true">
      <span v-for="n in items" :key="n.id" class="bmb-chip">
        <Icon :name="n.kind === 'folder' ? 'folder' : 'bookmark'" class="bmb-ic" />
        <span class="bmb-label">{{ labelOf(n) }}</span>
        <Icon v-if="n.kind === 'folder'" name="chev" class="bmb-ic bmb-down" />
      </span>
    </div>

    <template v-if="items.length">
      <button
        v-for="n in shown"
        :key="n.id"
        type="button"
        class="bmb-chip"
        :class="{ on: n.kind === 'url' && sameUrl(n.url, currentUrl) }"
        :title="n.kind === 'url' ? n.url : n.title"
        @click="onChipClick(n, $event)"
        @auxclick.middle.prevent="n.kind === 'url' && emit('open', n.url, 'new')"
        @contextmenu.prevent="openCtx($event, n)"
      >
        <Icon :name="n.kind === 'folder' ? 'folder' : 'bookmark'" class="bmb-ic" />
        <span class="bmb-label">{{ labelOf(n) }}</span>
        <Icon v-if="n.kind === 'folder'" name="chev" class="bmb-ic bmb-down" />
      </button>
      <button
        v-if="hiddenItems.length"
        type="button"
        class="bmb-chip bmb-more"
        :title="t('browser.bookmarks.more')"
        :aria-label="t('browser.bookmarks.more')"
        @click.stop="openMore"
      >
        <span aria-hidden="true">»</span>
      </button>
    </template>
    <span v-else class="bmb-hint">{{ t('browser.bookmarks.emptyHint') }}</span>

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

<style scoped>
.bmb {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  padding: 2px 8px;
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: inset 0 -1px 0 var(--border);
}
.bmb-measure {
  position: absolute;
  left: 0;
  top: 0;
  display: flex;
  gap: 4px;
  visibility: hidden;
  pointer-events: none;
}
.bmb-chip {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 5px;
  max-width: 150px;
  padding: 2px 7px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}
.bmb-chip:hover {
  background: var(--bgHover);
  color: var(--text);
}
/* Trang đang xem = accent-tint, đúng quy ước selection (không fill xám). */
.bmb-chip.on {
  background: var(--accentDim);
  color: var(--text);
}
.bmb-chip:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.bmb-ic {
  flex: 0 0 auto;
  width: var(--icon-xs);
  height: var(--icon-xs);
  color: var(--textFaint);
}
.bmb-down {
  width: 10px; /* design-token-ok: caret nhỏ cạnh nhãn thư mục */
  height: 10px; /* design-token-ok: caret nhỏ cạnh nhãn thư mục */
}
.bmb-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bmb-more {
  padding: 2px 8px;
}
.bmb-hint {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
