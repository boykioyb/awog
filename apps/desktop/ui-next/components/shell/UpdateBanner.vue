<template>
  <!-- Global auto-update banner (ADR 0028). Single app-lifetime mount in the
       layout, between the top bar and the page body so it pushes content down
       (full width) instead of overlaying it. Renders nothing unless the update
       store says there's something worth surfacing.
       Dải tint accent (không fill xám) cho vòng đời cập nhật; tint destructive khi lỗi. -->
  <div
    v-if="update.bannerVisible"
    class="flex shrink-0 items-center gap-3 border-b px-4 py-2"
    :class="isError ? 'border-destructive bg-destructive/10' : 'border-ring bg-selected'"
  >
    <Icon
      :name="leadIcon"
      class="size-4 shrink-0"
      :class="isError ? 'text-destructive' : 'text-primary'"
    />

    <div class="min-w-0 flex-1">
      <div class="truncate text-foreground">{{ message }}</div>
      <Progress
        v-if="update.status === 'downloading'"
        :model-value="update.progressPercent"
        class="mt-1 h-1 bg-border"
      />
    </div>

    <div class="flex shrink-0 items-center gap-1.5">
      <Button
        v-if="action"
        size="sm"
        class="shrink-0"
        :disabled="update.actionBusy"
        @click="update.runPrimaryAction()"
      >
        <Icon
          :name="action.icon"
          :class="update.actionBusy && 'animate-spin motion-reduce:animate-none'"
        />
        {{ action.label }}
      </Button>
      <Button
        v-if="showDismiss"
        size="sm"
        variant="outline"
        class="shrink-0"
        @click="update.dismiss()"
      >
        {{ dismissLabel }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useUpdateStore } from '~/stores/update'

const { t } = useI18n()
const update = useUpdateStore()
const { action } = useUpdateAction()

const isError = computed(() => update.status === 'error')

const message = computed(() => {
  switch (update.status) {
    case 'available':
      return t('update.banner.available', { version: update.newVersion ?? '' })
    case 'downloading':
      return t('update.banner.downloading', { percent: update.progressPercent })
    case 'downloaded':
      return t('update.banner.downloaded', { version: update.newVersion ?? '' })
    case 'error':
      return t('update.banner.error')
    default:
      return ''
  }
})

const leadIcon = computed(() => {
  if (update.status === 'error') return 'alert'
  if (update.status === 'downloaded') return 'check'
  return 'download'
})

// No dismiss mid-download (no cancel — let it finish).
const showDismiss = computed(() => update.status !== 'downloading')
const dismissLabel = computed(() =>
  update.status === 'downloaded' ? t('update.dismiss.later') : t('update.dismiss.dismiss'),
)
</script>
