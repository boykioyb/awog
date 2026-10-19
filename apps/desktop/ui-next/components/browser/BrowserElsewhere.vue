<template>
  <!-- View native đang hiện Ở CHỖ KHÁC. Một webContents chỉ ở được một rect —
       không tranh giành bounds, chỉ nói rõ đang ở đâu + nút lấy về. `where`
       phân biệt hai trường hợp suy ra được từ cờ chủ sở hữu: popout/cửa sổ khác
       (`shownElsewhere`) hay dock kia trong cùng cửa sổ (`!isOwner`). -->
  <div
    class="mx-auto flex max-h-full max-w-80 flex-col items-center justify-center gap-1.5 overflow-y-auto p-6 text-center"
  >
    <Icon :name="where === 'window' ? 'external' : 'panel'" class="mb-0.5 size-5 text-faint" />
    <div class="text-base text-foreground">
      {{ t(where === 'window' ? 'browser.elsewhere.window' : 'browser.elsewhere.dock') }}
    </div>
    <div class="text-sm text-muted-foreground">{{ t('browser.elsewhere.hint') }}</div>
    <Button variant="outline" size="sm" class="mt-2" @click="emit('takeover')">
      {{ t('sessions.workspace.browser.takeOver') }}
    </Button>
  </div>
</template>

<script setup lang="ts">
// Placeholder "đang hiển thị ở chỗ khác" — dùng chung cho panel và cửa sổ popout.
withDefaults(defineProps<{ where?: 'dock' | 'window' }>(), { where: 'window' })

const emit = defineEmits<{
  // Lấy view về đây — `takeOver` của useEmbeddedBrowser tự nhận `owner` rồi sync.
  takeover: []
}>()

const { t } = useI18n()
</script>
