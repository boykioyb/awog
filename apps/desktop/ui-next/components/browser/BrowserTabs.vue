<template>
  <!-- Tab strip — cuộn NGANG, không bao giờ bóp nhóm nút cạnh nó. Chip gồm:
       favicon (hoặc spinner khi loading, hoặc globe fallback) + tên + nút ×. -->
  <div class="bch-tablist">
    <button
      v-for="tab in tabs"
      :key="tab.tabId"
      type="button"
      class="bch-tab"
      :class="{ on: tab.tabId === activeTabId }"
      :title="tab.url || tabLabel(tab)"
      @click="emit('select-tab', tab.tabId)"
      @contextmenu="emit('tab-menu', { tab, ev: $event })"
    >
      <!-- Loading thì spinner che chỗ favicon — đúng nơi mắt đang nhìn. -->
      <Icon
        v-if="tab.loading"
        name="refresh"
        class="bch-spin"
        style="width: var(--icon-xs); height: var(--icon-xs)"
      />
      <img
        v-else-if="faviconOf(tab)"
        class="bch-fav"
        :src="faviconOf(tab)"
        alt=""
        draggable="false"
        @error="onFavError(tab)"
      />
      <Icon
        v-else
        name="globe"
        class="bch-favicon"
        style="width: var(--icon-xs); height: var(--icon-xs)"
      />
      <span class="bch-tabname">{{ tabLabel(tab) }}</span>
      <span class="x" @click.stop="emit('close-tab', tab.tabId)">×</span>
    </button>
    <button
      type="button"
      class="bch-act"
      :title="t('sessions.workspace.browser.newTab')"
      @click="emit('new-tab')"
    >
      <Icon name="plus" style="width: var(--icon-sm); height: var(--icon-sm)" />
    </button>
  </div>
</template>

<script setup lang="ts">
// Tab strip của chrome trình duyệt — tách khỏi BrowserChrome (nó chỉ còn ghép
// mảng). Emit intent lên; mọi hành động thật sống ở `useEmbeddedBrowser` của
// bề mặt chứa nó.
import type { AwogBrowserTab } from '~/types/awog-bridge'

defineProps<{
  tabs: AwogBrowserTab[]
  activeTabId: string | null
}>()

const emit = defineEmits<{
  'select-tab': [tabId: string]
  'close-tab': [tabId: string]
  'new-tab': []
  // Chuột phải trên một tab — bề mặt chứa quyết định menu (reload/duplicate/
  // đóng theo vị trí) vì nó ôm useEmbeddedBrowser. Event đi nguyên vẹn để menu
  // neo đúng con trỏ.
  'tab-menu': [payload: { tab: AwogBrowserTab; ev: MouseEvent }]
}>()

const { t } = useI18n()

// Tab trắng chưa có title/url: gọi nó là "New tab" thay vì phơi id nội bộ.
const tabLabel = (tab: AwogBrowserTab): string =>
  tab.title || tab.url || t('sessions.workspace.browser.newTab')

// Favicon là string do TRANG khai (L1). Chỉ chấp nhận http(s)/data:image — thứ
// gì khác (file://, javascript:…) thì fallback về globe thay vì gán vào <img>.
// Và chỉ assign vào `src`, không bao giờ innerHTML.
const favFailed = ref<string[]>([])
const faviconOf = (tab: AwogBrowserTab): string => {
  const f = tab.favicon?.trim() ?? ''
  if (!/^(https?:\/\/|data:image\/)/i.test(f) || favFailed.value.includes(f)) return ''
  return f
}
// Icon chết (404, origin chặn, data hỏng) → nhớ lại, đừng vẽ <img> lỗi mãi.
const onFavError = (tab: AwogBrowserTab): void => {
  const f = tab.favicon?.trim() ?? ''
  if (f && !favFailed.value.includes(f)) favFailed.value = [...favFailed.value, f]
}
</script>

<style scoped>
.bch-tablist {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
}
/* Tab đang chọn = accent-tint (không nền xám đặc — quy ước segmented control). */
.bch-tab {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 180px;
  padding: 4px 8px;
  border-radius: var(--r-sm);
  background: transparent;
  border: 1px solid transparent;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}
.bch-tab:hover {
  background: var(--bgHover);
  color: var(--text);
}
.bch-tab.on {
  background: var(--accentDim);
  border-color: var(--accentBorder);
  color: var(--text);
}
.bch-tab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
/* Favicon 12px — kích thước đọc được mà không phá nhịp chip; spinner cùng chỗ. */
.bch-fav {
  width: var(--icon-xs);
  height: var(--icon-xs);
  border-radius: var(--r-xs);
  flex-shrink: 0;
}
.bch-favicon {
  color: var(--textFaint);
  flex-shrink: 0;
}
.bch-tabname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bch-tab .x {
  opacity: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.bch-tab:hover .x,
.bch-tab:focus-visible .x {
  opacity: 0.7;
}
.bch-act {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: var(--r-sm);
  background: transparent;
  border: none;
  color: var(--textDim);
  cursor: pointer;
  flex-shrink: 0;
}
.bch-act:hover:not(:disabled) {
  background: var(--bgHover);
  color: var(--text);
}
.bch-act:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.bch-spin {
  animation: bch-spin 1s linear infinite;
  color: var(--textFaint);
  flex-shrink: 0;
}
@keyframes bch-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .bch-spin {
    animation: none;
  }
}
</style>
