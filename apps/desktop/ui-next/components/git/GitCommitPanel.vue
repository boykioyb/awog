<template>
  <div class="flex flex-none flex-col border-t bg-card">
    <div class="flex items-center gap-2 px-3.5 py-2">
      <span class="font-sans text-xs font-semibold text-muted-foreground">
        {{ t('git.commit.header') }}
      </span>
      <span class="flex-1" />
      <Button
        variant="outline"
        size="xs"
        class="border-primary/50 text-primary hover:bg-primary/10 hover:text-primary disabled:text-muted-foreground"
        :disabled="!stagedCount || generating || committing"
        @click="emit('generate')"
      >
        <Icon
          v-if="generating"
          name="refresh"
          class="size-3 animate-spin motion-reduce:animate-none"
        />
        <span v-else aria-hidden="true">✨</span>
        {{ generating ? t('git.commit.generating') : t('git.commit.generate') }}
      </Button>
      <span class="text-xs text-faint tabular-nums">
        {{ t('git.commit.filesStaged', { n: stagedCount }) }}
      </span>
    </div>
    <div class="px-3.5 pb-2">
      <Textarea
        class="max-h-45 min-h-18 resize-y font-mono"
        :model-value="msg"
        :placeholder="t('git.changes.commitPlaceholder')"
        @update:model-value="emit('update-msg', String($event))"
        @keydown.meta.enter="onCommitShortcut"
      />
    </div>
    <div class="flex justify-end gap-2 border-t px-3.5 py-2">
      <Button
        variant="outline"
        size="sm"
        :disabled="!commitsCount || committing || generating"
        @click="emit('amend')"
      >
        {{ t('git.commit.amend') }}
      </Button>
      <Button size="sm" :disabled="commitDisabled" @click="emit('commit')">
        <Icon
          v-if="committing"
          name="refresh"
          class="size-3.5 animate-spin motion-reduce:animate-none"
        />
        <Icon v-else name="check" class="size-3.5" />
        {{
          stagedCount ? t('git.changes.commitCount', { n: stagedCount }) : t('git.changes.commit')
        }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Commit panel — lives in the detail pane below the diff (production layout).
// COMMIT MESSAGE header + Generate (AI) + "N files staged" + textarea + Commit/Amend.
import Button from '~/components/ui/button/Button.vue'
import Textarea from '~/components/ui/textarea/Textarea.vue'

const props = defineProps<{
  msg: string
  stagedCount: number
  commitsCount: number
  // In-flight flags from the git store: disable the buttons + show a spinner so
  // a slow sidecar call can't be fired twice (race condition guard).
  generating?: boolean
  committing?: boolean
}>()

const emit = defineEmits<{
  (e: 'update-msg', value: string): void
  (e: 'commit'): void
  (e: 'amend'): void
  (e: 'generate'): void
}>()

const { t } = useI18n()

const commitDisabled = computed(() => !props.stagedCount || props.committing || props.generating)

// Cmd+Enter mirrors the Commit button — respect the same disabled guard so the
// shortcut can't bypass the in-flight lock.
const onCommitShortcut = () => {
  if (!commitDisabled.value) emit('commit')
}
</script>
