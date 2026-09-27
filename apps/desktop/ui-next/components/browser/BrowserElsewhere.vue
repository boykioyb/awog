<template>
  <!-- View native đang hiện Ở CHỖ KHÁC. Một webContents chỉ ở được một rect —
       không tranh giành bounds, chỉ nói rõ đang ở đâu + nút lấy về. `where`
       phân biệt hai trường hợp suy ra được từ cờ chủ sở hữu: popout/cửa sổ khác
       (`shownElsewhere`) hay dock kia trong cùng cửa sổ (`!isOwner`). -->
  <div class="belse">
    <Icon
      :name="where === 'window' ? 'external' : 'panel'"
      class="belse-icn"
      style="width: var(--icon-lg); height: var(--icon-lg)"
    />
    <div class="belse-title">
      {{ t(where === 'window' ? 'browser.elsewhere.window' : 'browser.elsewhere.dock') }}
    </div>
    <div class="belse-hint">{{ t('browser.elsewhere.hint') }}</div>
    <button type="button" class="belse-btn" @click="emit('takeover')">
      {{ t('sessions.workspace.browser.takeOver') }}
    </button>
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

<style scoped>
.belse {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 24px;
  max-width: 320px;
  margin: 0 auto;
  text-align: center;
  max-height: 100%;
  overflow-y: auto;
}
.belse-icn {
  color: var(--textFaint);
  margin-bottom: 2px;
}
.belse-title {
  color: var(--text);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
.belse-hint {
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.belse-btn {
  margin-top: 8px;
  padding: 4px 12px;
  border-radius: var(--r-btn);
  background: transparent;
  border: 1px solid var(--border);
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
}
.belse-btn:hover {
  border-color: var(--accentBorder);
  color: var(--text);
}
.belse-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
</style>
