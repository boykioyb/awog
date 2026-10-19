<template>
  <TooltipProvider :delay-duration="300">
    <div class="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
      <header class="flex h-11 flex-none items-center gap-2 border-b pl-4 pr-3">
        <BrandIcon provider="slack" :size="18" />
        <span class="text-lg font-semibold">{{ t('slack.title') }}</span>
        <span class="flex-1" />
        <Button
          v-if="isWindow && hasSlackBridge"
          variant="ghost"
          size="iconMd"
          :class="{ 'bg-selected text-primary': pinned }"
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
             về mặc định. Vùng bắt 6px đè lên mép (margin âm) để không đội thêm bề rộng; vạch
             accent mảnh chỉ hiện khi hover / đang kéo / focus bàn phím. -->
        <div
          class="relative z-1 -mx-0.75 flex-none basis-1.5 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-0.5 after:w-0.5 after:transition-colors after:content-[''] hover:after:bg-primary focus-visible:after:bg-primary"
          :class="{ 'after:bg-primary': list.dragging.value }"
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
