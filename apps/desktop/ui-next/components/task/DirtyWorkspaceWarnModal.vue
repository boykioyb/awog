<template>
  <LibraryEntityModal
    :open="open"
    :title="t('tasks.dirty.title')"
    :width="460"
    lock-scrim
    @close="emit('close')"
  >
    <div class="flex flex-col gap-3">
      <p class="text-sm text-muted-foreground">{{ bodyText }}</p>
      <label class="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <Checkbox :model-value="suppress" @update:model-value="suppress = $event === true" />
        <span>{{ t('tasks.dirty.suppress') }}</span>
      </label>
    </div>

    <template #footer>
      <Button variant="outline" @click="emit('continue-anyway', suppress)">
        {{ t('tasks.dirty.continueAnyway') }}
      </Button>
      <Button variant="outline" @click="emit('stash-and-continue', suppress)">
        {{ t('tasks.dirty.stashAndContinue') }}
      </Button>
      <Button variant="default" @click="emit('commit-now', suppress)">
        {{ t('tasks.dirty.commitNow') }}
      </Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Dirty-workspace warning before starting a task, built on LibraryEntityModal.
// NewTaskModal probes the selected project's git status, passes the uncommitted `fileCount`,
// and acts on the user's choice (commit / stash / continue) + the "don't ask
// again this session" toggle.
import { computed, ref } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { useI18n } from '~/composables/useI18n'
import Button from '~/components/ui/button/Button.vue'

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
