<template>
  <div class="bcard" :class="{ run: running }">
    <!-- Ảnh trang. Không có ảnh (đang tải / chụp lỗi / session cũ) thì chừa khung
         với glyph globe — thẻ không đổi chiều cao khi ảnh về muộn. -->
    <button type="button" class="bthumb" :title="t('sessions.browserCard.open')" @click="openPage">
      <img v-if="thumb" :src="thumb" :alt="t('sessions.browserCard.alt', { title: titleText })" />
      <span v-else class="bph">
        <Icon name="globe" style="width: var(--icon-xl); height: var(--icon-xl)" />
      </span>
      <span v-if="running" class="bspin" />
    </button>

    <div class="bfoot">
      <div class="bmeta">
        <div class="btitle" :title="titleText">{{ titleText }}</div>
        <div class="bsub">
          <span class="bhost">{{ host }}</span>
          <span class="bdot">·</span>
          <span class="bcap">{{ t('sessions.browserCard.caption') }}</span>
        </div>
      </div>
      <button type="button" class="bopen" @click="openPage">
        {{ t('sessions.browserCard.open') }}
      </button>
      <button
        type="button"
        class="bmore"
        :class="{ on: menuPos !== null }"
        :title="t('sessions.browserCard.more')"
        @click.stop="openMenu"
      >
        <Icon name="dots" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
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

<style scoped>
.bcard {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 420px;
  margin: 4px 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--card);
  color: var(--foreground);
}
/* Khung ảnh tỉ lệ cố định: ảnh về muộn không làm transcript nhảy. Ảnh chụp là phần
   ĐẦU trang nên căn top, cắt đáy. */
.bthumb {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 16 / 10;
  padding: 0;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: var(--muted);
  overflow: hidden;
  cursor: pointer;
}
.bthumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top;
}
.bph {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  color: var(--muted-foreground);
}
.bspin {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 14px;
  height: 14px;
  border: 2px solid transparent;
  border-top-color: var(--primary);
  border-right-color: var(--primary);
  border-radius: 50%;
  animation: bspin 0.8s linear infinite;
}
@keyframes bspin {
  to {
    transform: rotate(360deg);
  }
}
.bfoot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
}
.bmeta {
  min-width: 0;
  flex: 1;
}
.btitle {
  overflow: hidden;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bsub {
  display: flex;
  min-width: 0;
  gap: 4px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--muted-foreground);
  white-space: nowrap;
}
.bhost {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bcap {
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bopen {
  flex: 0 0 auto;
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: transparent;
  font-family: inherit;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 500;
  color: var(--foreground);
  cursor: pointer;
  transition: background 0.12s ease;
}
.bopen:hover {
  background: var(--accent-wash);
}
.bmore {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
  transition: background 0.12s ease;
}
.bmore:hover,
.bmore.on {
  background: var(--accent-wash);
  color: var(--foreground);
}
.bopen:focus-visible,
.bmore:focus-visible,
.bthumb:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 1px;
}
</style>
