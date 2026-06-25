<template>
  <LibraryEntityModal
    :open="open"
    :title="t('tasks.dirty.title')"
    :width="460"
    lock-scrim
    @close="emit('close')"
  >
    <div class="dwm">
      <p class="dwm-body">{{ bodyText }}</p>
      <label class="dwm-suppress">
        <input
          type="checkbox"
          :checked="suppress"
          @change="suppress = ($event.target as HTMLInputElement).checked"
        />
        <span>{{ t('tasks.dirty.suppress') }}</span>
      </label>
    </div>

    <template #footer>
      <button class="btn" @click="emit('continue-anyway', suppress)">
        {{ t('tasks.dirty.continueAnyway') }}
      </button>
      <button class="btn" @click="emit('stash-and-continue', suppress)">
        {{ t('tasks.dirty.stashAndContinue') }}
      </button>
      <button class="btn pri" @click="emit('commit-now', suppress)">
        {{ t('tasks.dirty.commitNow') }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Dirty-workspace warning before starting a task — port of the old UI
// DirtyWorkspaceWarnModal in prototype CSS via LibraryEntityModal. NewTaskModal
// probes the selected project's git status, passes the uncommitted `fileCount`,
// and acts on the user's choice (commit / stash / continue) + the "don't ask
// again this session" toggle.
import { computed, ref } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { useI18n } from '~/composables/useI18n'

const props = withDefaults(defineProps<{ open: boolean; fileCount?: number }>(), {
  fileCount: 0,
})

const emit = defineEmits<{
  close: []
  'commit-now': [suppress: boolean]
  'stash-and-continue': [suppress: boolean]
  'continue-anyway': [suppress: boolean]
}>()

const { t } = useI18n()
const suppress = ref(false)

// Prefer the count-aware body when we know how many files are dirty.
const bodyText = computed(() =>
  props.fileCount > 0
    ? t('tasks.dirty.bodyCount', { count: props.fileCount })
    : t('tasks.dirty.body'),
)
</script>

<style scoped>
.dwm {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.dwm-body {
  font-size: 0.9615rem;
  color: var(--textMuted);
  line-height: 1.6;
}
.dwm-suppress {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9231rem;
  color: var(--textMuted);
  cursor: pointer;
}
</style>
