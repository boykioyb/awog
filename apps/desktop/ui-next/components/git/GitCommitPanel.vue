<template>
  <div class="gcommitpanel">
    <div class="gcph">
      <span class="gcplbl">{{ t('git.commit.header') }}</span>
      <span style="flex: 1" />
      <button
        class="gcpgen"
        :disabled="!stagedCount || generating || committing"
        @click="emit('generate')"
      >
        <Icon v-if="generating" name="refresh" class="gcpspin" style="width: 13px; height: 13px" />
        <span v-else aria-hidden="true">✨</span>
        {{ generating ? t('git.commit.generating') : t('git.commit.generate') }}
      </button>
      <span class="gcpcount">{{ t('git.commit.filesStaged', { n: stagedCount }) }}</span>
    </div>
    <div class="gcpbody">
      <textarea
        class="ci gcpta"
        :value="msg"
        :placeholder="t('git.changes.commitPlaceholder')"
        @input="emit('update-msg', ($event.target as HTMLTextAreaElement).value)"
        @keydown.meta.enter="onCommitShortcut"
      />
    </div>
    <div class="gcpfoot">
      <button
        class="btn pri gcpcommit"
        :disabled="commitDisabled"
        :style="commitDisabled ? 'opacity:.45;pointer-events:none' : undefined"
        @click="emit('commit')"
      >
        <Icon v-if="committing" name="refresh" class="gcpspin" style="width: 14px; height: 14px" />
        <Icon v-else name="check" style="width: 14px; height: 14px" />
        {{
          stagedCount ? t('git.changes.commitCount', { n: stagedCount }) : t('git.changes.commit')
        }}
      </button>
      <button
        class="btn"
        :disabled="!commitsCount || committing || generating"
        @click="emit('amend')"
      >
        {{ t('git.commit.amend') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Commit panel — lives in the detail pane below the diff (production layout).
// COMMIT MESSAGE header + Generate (AI) + "N files staged" + textarea + Commit/Amend.
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
