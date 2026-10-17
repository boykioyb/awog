<template>
  <TooltipProvider :delay-duration="300">
    <div class="slk-ws">
      <header class="slk-hd">
        <BrandIcon provider="slack" :size="18" />
        <span class="slk-hdt">{{ t('slack.title') }}</span>
        <span class="flex-1" />
        <Button
          v-if="isWindow && hasSlackBridge"
          variant="ghost"
          size="iconMd"
          :class="{ 'slk-pin-on': pinned }"
          :aria-pressed="pinned"
          :title="pinned ? t('slack.unpin') : t('slack.pin')"
          @click="togglePin"
        >
          <Icon name="pin" />
        </Button>
        <Button
          variant="ghost"
          size="iconMd"
          :title="t('slack.settings.open')"
          @click="settingsOpen = true"
        >
          <Icon name="settings" />
        </Button>
        <Button
          variant="ghost"
          size="iconMd"
          :disabled="refreshing"
          :title="t('slack.refreshAll')"
          @click="refreshAll"
        >
          <Icon name="refresh" />
        </Button>
        <Button
          v-if="!isWindow && hasSlackBridge"
          variant="ghost"
          size="iconMd"
          :title="t('slack.openWindow')"
          @click="openWindow"
        >
          <Icon name="external" />
        </Button>
        <Button
          v-if="!isWindow"
          variant="ghost"
          size="iconMd"
          :title="t('common.close')"
          @click="closeModal"
        >
          <Icon name="x" />
        </Button>
      </header>
      <SlackStatusBanner :status="store.status" :is-window="isWindow" />
      <div ref="bodyRef" class="flex min-h-0 flex-1">
        <SlackThreadList :style="{ flexBasis: `${list.width.value}px` }" />
        <!-- Tay kéo đổi bề rộng cột danh sách. Kéo chuột, ←/→ khi focus (±16px), bấm đúp
             về mặc định. -->
        <div
          class="slk-rsz"
          :class="{ drag: list.dragging.value }"
          role="separator"
          aria-orientation="vertical"
          :aria-label="t('slack.resizeList')"
          :aria-valuemin="list.min"
          :aria-valuemax="list.max.value"
          :aria-valuenow="list.width.value"
          tabindex="0"
          @pointerdown="list.onPointerDown"
          @keydown="list.onKeydown"
          @dblclick="list.reset"
        />
        <SlackThreadView />
      </div>
      <SlackAddThreadDialog />
      <SlackSettingsDialog />
    </div>
  </TooltipProvider>
</template>

<script setup lang="ts">
// Nội dung Slack threads dùng chung cho modal trong cửa sổ chính (SlackModal) và cửa sổ
// Slack riêng (pages/slack.vue?window=1): đầu (nút theo chế độ) + banner trạng thái +
// cây thread + khung thread. Dựng controller (useSlackManager) ở đây nên mount = bề mặt
// đang hiện: modal gỡ component này khi đóng ⇒ poll dừng theo.
import { useTemplateRef } from 'vue'
import { useSlackListResize } from '~/composables/useSlackListResize'
import { useSlackManager, type SlackMode } from '~/composables/useSlackManager'

const props = defineProps<{ mode: SlackMode }>()

const { t } = useI18n()
const {
  store,
  isWindow,
  hasSlackBridge,
  pinned,
  togglePin,
  openWindow,
  closeModal,
  refreshing,
  refreshAll,
  settingsOpen,
} = useSlackManager(props.mode)

const list = useSlackListResize(useTemplateRef<HTMLElement>('bodyRef'))
</script>

<style scoped>
.slk-ws {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: var(--bg);
  color: var(--text);
}
.slk-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  flex: none;
  padding: 0 12px 0 16px;
  box-shadow: inset 0 -1px 0 var(--border);
}
.slk-hdt {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 600;
}
/* Tay kéo: vùng bắt 6px đè lên mép (margin âm) để không đội thêm bề rộng; vạch accent
   mảnh chỉ hiện khi hover / đang kéo / focus bàn phím — mép cột danh sách đã có hairline. */
.slk-rsz {
  position: relative;
  z-index: 1;
  flex: 0 0 6px;
  margin: 0 -3px;
  cursor: col-resize;
  touch-action: none;
  outline: none;
}
.slk-rsz::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 2px;
  background: transparent;
  transition: background 0.12s;
}
.slk-rsz:hover::after,
.slk-rsz.drag::after,
.slk-rsz:focus-visible::after {
  background: var(--accent);
}
.slk-pin-on {
  color: var(--accent);
  background: var(--accentDim);
}
</style>
