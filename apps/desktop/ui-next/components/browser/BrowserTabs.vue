<template>
  <!-- Tab strip — cuộn NGANG, không bao giờ bóp nhóm nút cạnh nó. Chip gồm:
       favicon (hoặc spinner khi loading, hoặc globe fallback) + tên + nút ×. -->
  <div class="flex min-w-0 flex-auto items-center gap-1 overflow-x-auto">
    <!-- Tab đang chọn = accent-tint (bg-selected + viền), không nền xám đặc. -->
    <Button
      v-for="tab in tabs"
      :key="tab.tabId"
      variant="ghost"
      size="xs"
      class="group max-w-45 flex-none justify-start gap-1.5 border border-transparent px-2 font-normal text-muted-foreground hover:text-foreground [&_svg]:size-3"
      :class="tab.tabId === activeTabId && 'border-selected-border bg-selected text-foreground'"
      :title="tab.url || tabLabel(tab)"
      @click="emit('select-tab', tab.tabId)"
      @contextmenu="emit('tab-menu', { tab, ev: $event })"
    >
      <!-- Loading thì spinner che chỗ favicon — đúng nơi mắt đang nhìn. -->
      <Icon
        v-if="tab.loading"
        name="refresh"
        class="animate-spin text-faint motion-reduce:animate-none"
      />
      <img
        v-else-if="faviconOf(tab)"
        class="size-3 shrink-0 rounded-sm"
        :src="faviconOf(tab)"
        alt=""
        draggable="false"
        @error="onFavError(tab)"
      />
      <Icon v-else name="globe" class="text-faint" />
      <span class="truncate">{{ tabLabel(tab) }}</span>
      <!-- × là span trong nút tab (không lồng nút trong nút): hộp vuông 16px để hover
           không méo theo glyph. Chỉ hiện khi hover/focus tab. -->
      <span
        class="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-sm opacity-0 group-hover:opacity-70 group-focus-visible:opacity-70 hover:bg-muted hover:text-foreground hover:opacity-100!"
        @click.stop="emit('close-tab', tab.tabId)"
      >
        ×
      </span>
    </Button>
    <Button
      variant="ghost"
      size="iconSm"
      class="shrink-0 text-muted-foreground"
      :title="t('sessions.workspace.browser.newTab')"
      :aria-label="t('sessions.workspace.browser.newTab')"
      @click="emit('new-tab')"
    >
      <Icon name="plus" />
    </Button>
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
