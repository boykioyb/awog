<template>
  <div
    class="my-1 flex w-full max-w-105 flex-col overflow-hidden rounded-xl border bg-card text-foreground"
  >
    <!-- Ảnh trang. Không có ảnh (đang tải / chụp lỗi / session cũ) thì chừa khung
         với glyph globe — thẻ không đổi chiều cao khi ảnh về muộn. Khung tỉ lệ cố định:
         ảnh về muộn không làm transcript nhảy; ảnh chụp là phần ĐẦU trang nên căn top. -->
    <Button
      variant="ghost"
      class="relative block aspect-16/10 h-auto w-full overflow-hidden rounded-none bg-muted p-0 hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
      :title="t('sessions.browserCard.open')"
      @click="openPage"
    >
      <img
        v-if="thumb"
        :src="thumb"
        :alt="t('sessions.browserCard.alt', { title: titleText })"
        class="block size-full object-cover object-top"
      />
      <span v-else class="flex size-full items-center justify-center text-muted-foreground">
        <Icon name="globe" class="size-6" />
      </span>
      <span
        v-if="running"
        class="absolute top-2 right-2 size-3.5 animate-spin rounded-full border-2 border-transparent border-t-primary border-r-primary"
      />
    </Button>
    <Separator />

    <div class="flex items-center gap-2 px-2.5 py-2">
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium" :title="titleText">{{ titleText }}</div>
        <div class="flex min-w-0 gap-1 text-xs whitespace-nowrap text-muted-foreground">
          <span class="min-w-0 truncate">{{ host }}</span>
          <span>·</span>
          <span class="shrink truncate">{{ t('sessions.browserCard.caption') }}</span>
        </div>
      </div>
      <Button variant="outline" size="xs" class="shrink-0 rounded-lg px-3" @click="openPage">
        {{ t('sessions.browserCard.open') }}
      </Button>
      <Button
        variant="ghost"
        size="iconSm"
        class="shrink-0 text-muted-foreground hover:text-foreground"
        :class="menuPos !== null && 'bg-accent text-foreground'"
        :title="t('sessions.browserCard.more')"
        :aria-label="t('sessions.browserCard.more')"
        @click.stop="openMenu"
      >
        <Icon name="dots" class="size-3.5" />
      </Button>
    </div>

    <!-- Teleport ra body: menu `fixed` không được bị overflow/transform của transcript
         bẻ kẹp (cùng lý do với menu tab web của SessionDetail). -->
    <Teleport to="body">
      <AppContextMenu
        :open="menuPos !== null"
        :position="menuPos ?? { x: 0, y: 0 }"
        :items="menuItems"
        @close="menuPos = null"
        @select="onMenuSelect"
      />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
// Thẻ xem trước trang agent vừa mở bằng `browser_tool` (navigate / tab_new có url) —
// kiểu Claude Desktop: người dùng thấy trang ngay trong transcript mà không phải mở
// panel nào. Spec: docs/features/browser-preview-card.md.
//
// Dữ liệu: `block.page.url` đến từ INPUT của step (có từ lúc step còn `running`, và
// dựng lại được khi reload vì replay JSONL cũng đi qua step-mapper); ảnh + title thật
// + tabId lấy lazy qua `sessions.browserPreview` khi step xong. Thiếu preview (session
// cũ, chụp lỗi) ⇒ thẻ vẫn hiện, dùng host làm tiêu đề, không ảnh.
import type { StepBlock } from '~/composables/useSessionsData'
import type { MenuItem } from '~/composables/useContextMenu'

const props = defineProps<{ block: StepBlock }>()

const { t } = useI18n()
const scope = useSessionScope()
const { previewOf, ensurePreview } = useBrowserPreview()
const mainTabs = useSessionMainTabs()
const { openInApp, openExternally } = useLinkOpen()

const engineId = computed(() => scope.session.value?.engineId)
const running = computed(() => props.block.status === 'running')

// Chỉ hỏi sidecar khi step đã xong: handler lưu ảnh TRƯỚC khi trả kết quả, nên 'done'
// là mốc sớm nhất mà RPC chắc chắn có dữ liệu.
watch(
  [engineId, () => props.block.status, () => props.block.eid],
  ([eng, status, eid]) => {
    if (eng && eid && status === 'done') void ensurePreview(eng, eid)
  },
  { immediate: true },
)

const preview = computed(() => previewOf(engineId.value, props.block.eid) ?? null)
const pageUrl = computed(() => preview.value?.url || props.block.page?.url || '')
const thumb = computed(() => preview.value?.thumbDataUrl ?? null)

const host = computed(() => {
  try {
    return new URL(pageUrl.value).host
  } catch {
    return pageUrl.value
  }
})
const titleText = computed(() => preview.value?.title || host.value)

// "Open": tab còn sống ⇒ chuyển tới nó trên strip của phiên; tab đã đóng (agent đóng,
// hoặc app khởi động lại) ⇒ mở URL ở tab MỚI qua đường mở-link của người dùng.
async function openPage(): Promise<void> {
  const tabId = preview.value?.tabId
  const sessionScope = engineId.value
  const api = window.awog?.browser
  if (api && tabId) {
    const list = await api.tabs(sessionScope).catch(() => null)
    const alive = list?.tabs.find((tab) => tab.tabId === tabId)
    if (alive) {
      mainTabs.setMainTab(sessionScope, tabId)
      if (window.location.pathname.startsWith('/workbench')) {
        void useWorkbenchDocs().openWebTab(tabId, { title: alive.title || pageUrl.value })
      }
      return
    }
  }
  if (pageUrl.value) await openInApp(pageUrl.value)
}

// Menu ⋮
const menuPos = ref<{ x: number; y: number } | null>(null)
const MENU_W = 220
const menuItems = computed<MenuItem[]>(() => [
  { id: 'external', icon: 'external', label: t('sessions.browserCard.openExternal') },
  { id: 'copy', icon: 'copy', label: t('sessions.browserCard.copyUrl') },
])

function openMenu(e: MouseEvent): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  menuPos.value = {
    x: Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8)),
    y: r.bottom + 4,
  }
}

async function onMenuSelect(id: string): Promise<void> {
  menuPos.value = null
  if (!pageUrl.value) return
  if (id === 'external') {
    await openExternally(pageUrl.value)
    return
  }
  if (id === 'copy') {
    await navigator.clipboard.writeText(pageUrl.value).catch(() => undefined)
    useToast().add({ title: t('sessions.browserCard.copied'), color: 'success' })
  }
}
</script>
