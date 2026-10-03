<template>
  <div class="gcommitpanel">
    <div class="gcph">
      <span class="gcplbl">{{ t('git.commit.header') }}</span>
      <span style="flex: 1" />
      <Button
        variant="outline"
        size="xs"
        class="gcpgen"
        :disabled="!stagedCount || generating || committing"
        @click="emit('generate')"
      >
        <Icon v-if="generating" name="refresh" class="gcpspin size-3" />
        <span v-else aria-hidden="true">✨</span>
        {{ generating ? t('git.commit.generating') : t('git.commit.generate') }}
      </Button>
      <span class="gcpcount">{{ t('git.commit.filesStaged', { n: stagedCount }) }}</span>
    </div>
    <div class="gcpbody">
      <Textarea
        class="gcpta font-mono"
        :model-value="msg"
        :placeholder="t('git.changes.commitPlaceholder')"
        @update:model-value="emit('update-msg', String($event))"
        @keydown.meta.enter="onCommitShortcut"
      />
    </div>
    <div class="gcpfoot">
      <Button
        variant="outline"
        size="sm"
        :disabled="!commitsCount || committing || generating"
        @click="emit('amend')"
      >
        {{ t('git.commit.amend') }}
      </Button>
      <Button size="sm" :disabled="commitDisabled" @click="emit('commit')">
        <Icon v-if="committing" name="refresh" class="gcpspin size-3.5" />
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

<style scoped>
/* Spinner for the in-flight generate/commit buttons (no rotate keyframe in the
   shared prototype.css). Disabled under reduced-motion. */
.gcpspin {
  animation: gcpspin 0.8s linear infinite;
}
@keyframes gcpspin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .gcpspin {
    animation: none;
  }
}
</style>
